import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLatestRef } from './useLatestRef';
import type { Timer } from '../types/timer';
import type { TimerState } from '../contexts/TimerContext';
import type { Alias } from '../types/alias';
import type { OutputFilter } from '../lib/outputFilter';
import type { CommandRunner } from '../lib/commandUtils';
import { expandInput } from '../lib/aliasEngine';
import { executeCommands } from '../lib/commandUtils';
import { executeTimerScript } from '../lib/scriptEngine';
import { DEFAULT_BABEL_PHRASES } from '../lib/babelPhrases';

/** Shared hook for the recurring guard → setInterval → cleanup pattern. */
function usePollingTimer(
  active: boolean,
  intervalMs: number,
  onTick: () => void,
): number | null {
  const onTickRef = useLatestRef(onTick);
  const [nextAt, setNextAt] = useState<number | null>(null);
  useEffect(() => {
    if (!active) {
      setNextAt(null);
      return;
    }
    setNextAt(Date.now() + intervalMs);
    const id = setInterval(() => {
      onTickRef.current();
      setNextAt(Date.now() + intervalMs);
    }, intervalMs);
    return () => {
      clearInterval(id);
      setNextAt(null);
    };
  }, [active, intervalMs]);
  return nextAt;
}

export interface ActiveTimerBadge {
  id: string;
  name: string;
  nextAt: number;
}

interface TimerEnginesDeps {
  connected: boolean;
  loggedIn: boolean;
  antiIdleEnabled: boolean;
  antiIdleCommand: string;
  antiIdleMinutes: number;
  alignmentTrackingEnabled: boolean;
  alignmentTrackingMinutes: number;
  whoAutoRefreshEnabled: boolean;
  whoRefreshMinutes: number;
  babelEnabled: boolean;
  babelLanguage: string;
  babelIntervalSeconds: number;
  babelPhrases: string[];
  mergedTimers: Timer[];
  timerState: TimerState;
  sendCommandRef: React.RefObject<((cmd: string) => Promise<void>) | null>;
  writeToTermRef: React.RefObject<(text: string) => void>;
  outputFilterRef: React.RefObject<OutputFilter | null>;
  mergedAliasesRef: React.RefObject<Alias[]>;
  enableSpeedwalkRef: React.RefObject<boolean>;
  activeCharacterRef: React.RefObject<string | null>;
  triggerRunnerRef: React.RefObject<CommandRunner>;
  globalScriptRef: React.RefObject<string>;
  commandSeparatorRef: React.RefObject<string>;
}

export function useTimerEngines({
  connected,
  loggedIn,
  antiIdleEnabled,
  antiIdleCommand,
  antiIdleMinutes,
  alignmentTrackingEnabled,
  alignmentTrackingMinutes,
  whoAutoRefreshEnabled,
  whoRefreshMinutes,
  babelEnabled,
  babelLanguage,
  babelIntervalSeconds,
  babelPhrases,
  mergedTimers,
  timerState,
  sendCommandRef,
  writeToTermRef,
  outputFilterRef,
  mergedAliasesRef,
  enableSpeedwalkRef,
  activeCharacterRef,
  triggerRunnerRef,
  globalScriptRef,
  commandSeparatorRef,
}: TimerEnginesDeps) {
  // Anti-idle timer — sends command at interval when connected + logged in + enabled
  const antiIdleEnabledRef = useLatestRef(antiIdleEnabled);
  const antiIdleCommandRef = useLatestRef(antiIdleCommand);

  const antiIdleNextAt = usePollingTimer(
    connected && loggedIn && antiIdleEnabled,
    antiIdleMinutes * 60_000,
    () => {
      const cmd = antiIdleCommandRef.current;
      if (sendCommandRef.current && antiIdleEnabledRef.current) {
        writeToTermRef.current?.(`\x1b[90m[anti-idle: ${cmd}]\x1b[0m\r\n`);
        sendCommandRef.current(cmd);
      }
    },
  );

  // Alignment tracking timer — polls "show alignment" at interval when enabled
  const alignmentTrackingEnabledRef = useLatestRef(alignmentTrackingEnabled);

  const alignmentNextAt = usePollingTimer(
    connected && loggedIn && alignmentTrackingEnabled,
    alignmentTrackingMinutes * 60_000,
    () => {
      if (sendCommandRef.current && alignmentTrackingEnabledRef.current) {
        if (!outputFilterRef.current?.filterFlags.alignment) {
          writeToTermRef.current?.(`\x1b[90m[alignment sync]\x1b[0m\r\n`);
        }
        sendCommandRef.current('show alignment');
      }
    },
  );

  // Shared who refresh: gag output via sync, then send `who`
  const refreshWho = useCallback(() => {
    if (sendCommandRef.current && outputFilterRef.current) {
      outputFilterRef.current.startWhoSync();
      sendCommandRef.current('who');
    }
  }, []);

  // Who list auto-refresh — sends `who` at interval, gagged via OutputFilter
  const whoNextAt = usePollingTimer(
    connected && loggedIn && whoAutoRefreshEnabled,
    whoRefreshMinutes * 60_000,
    refreshWho,
  );

  // Babel language trainer — sends a random phrase in a target language at interval
  const babelEnabledRef = useLatestRef(babelEnabled);
  const babelLanguageRef = useLatestRef(babelLanguage);
  const babelPhrasesRef = useLatestRef(babelPhrases);
  const [babelNextAt, setBabelNextAt] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !loggedIn || !babelEnabled || !babelLanguage) {
      setBabelNextAt(null);
      return;
    }
    const fire = () => {
      const custom = babelPhrasesRef.current;
      const phrases = custom.length > 0 ? custom : DEFAULT_BABEL_PHRASES;
      const lang = babelLanguageRef.current;
      if (sendCommandRef.current && babelEnabledRef.current && lang) {
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        writeToTermRef.current?.(`\x1b[90m[babel: ${lang}] ${phrase}\x1b[0m\r\n`);
        sendCommandRef.current(`say (lang=${lang}) ${phrase}`);
      }
    };
    // Fire immediately on start
    fire();
    const ms = babelIntervalSeconds * 1000;
    setBabelNextAt(Date.now() + ms);
    const id = setInterval(() => {
      fire();
      setBabelNextAt(Date.now() + ms);
    }, ms);
    return () => {
      clearInterval(id);
      setBabelNextAt(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- babelPhrasesRef used inside callback; no restart needed on phrase edits
  }, [connected, loggedIn, babelEnabled, babelLanguage, babelIntervalSeconds]);

  // Custom timer engine — manages per-timer setIntervals, only fires when connected + logged in.
  // Reconciles incrementally: toggling, editing, adding, or deleting one timer must not restart
  // the countdowns of the others. Only timers that were added, removed, or had their interval
  // changed are touched; every other running timer keeps ticking undisturbed.
  const timerIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // id -> interval (ms) the running setInterval was created with, so we can detect interval changes
  const timerIntervalMsRef = useRef<Map<string, number>>(new Map());
  const clearTimerIntervals = useCallback(() => {
    for (const id of timerIntervalsRef.current.values()) clearInterval(id);
    timerIntervalsRef.current.clear();
    timerIntervalMsRef.current.clear();
  }, []);
  const mergedTimersRef = useLatestRef(mergedTimers);
  const [timerNextFires, setTimerNextFires] = useState<Record<string, number>>({});

  useEffect(() => {
    // Not connected / not logged in: everything stops.
    if (!connected || !loggedIn) {
      clearTimerIntervals();
      setTimerNextFires((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const desired = new Map<string, Timer>();
    for (const t of mergedTimers) {
      if (t.enabled) desired.set(t.id, t);
    }

    const running = timerIntervalsRef.current;
    const runningMs = timerIntervalMsRef.current;
    const removedIds: string[] = [];
    const addedFires: Record<string, number> = {};

    // Stop timers that are no longer enabled, were deleted, or whose interval changed.
    // (Interval changes are re-added below with a fresh countdown, which is the desired behavior.)
    for (const [id, handle] of running) {
      const want = desired.get(id);
      const newMs = want ? want.intervalSeconds * 1000 : undefined;
      if (!want || newMs !== runningMs.get(id)) {
        clearInterval(handle);
        running.delete(id);
        runningMs.delete(id);
        removedIds.push(id);
      }
    }

    // Start timers that should be running but aren't (newly added, re-enabled, or interval-changed).
    // Timers already running with an unchanged interval are left alone — their countdown continues.
    for (const [id, timer] of desired) {
      if (running.has(id)) continue;
      const ms = timer.intervalSeconds * 1000;

      const intervalId = setInterval(() => {
        if (!sendCommandRef.current) return;
        // Read the timer fresh so body/bodyMode edits take effect without restarting the countdown.
        const current = mergedTimersRef.current.find((t) => t.id === id);
        if (!current || !current.enabled) return;

        if (current.bodyMode === 'script') {
          // Execute JavaScript body via script engine
          executeTimerScript(
            current.body,
            activeCharacterRef.current,
            triggerRunnerRef.current,
            globalScriptRef.current
          );
        } else {
          // Expand body through alias engine, then execute via the shared runner
          const result = expandInput(current.body, mergedAliasesRef.current, {
            enableSpeedwalk: enableSpeedwalkRef.current,
            activeCharacter: activeCharacterRef.current,
            separator: commandSeparatorRef.current,
          });
          executeCommands(result.commands, triggerRunnerRef.current);
        }

        setTimerNextFires((prev) => ({ ...prev, [id]: Date.now() + ms }));
      }, ms);

      running.set(id, intervalId);
      runningMs.set(id, ms);
      addedFires[id] = Date.now() + ms;
    }

    // Apply next-fire changes without disturbing the timers that kept running.
    if (removedIds.length || Object.keys(addedFires).length) {
      setTimerNextFires((prev) => {
        const next = { ...prev };
        for (const id of removedIds) delete next[id];
        Object.assign(next, addedFires);
        return next;
      });
    }
  }, [connected, loggedIn, mergedTimers, clearTimerIntervals]);

  // Tear everything down on unmount (the reconcile effect intentionally has no per-run cleanup).
  useEffect(() => clearTimerIntervals, [clearTimerIntervals]);

  // Active timer badges for CommandInput (sorted by soonest-to-fire first)
  const activeTimerBadges = useMemo(
    () =>
      mergedTimers
        .filter((t) => t.enabled && timerNextFires[t.id] && t.showInStatusBar !== false)
        .map((t) => ({ id: t.id, name: t.name, nextAt: timerNextFires[t.id] }))
        .sort((a, b) => a.nextAt - b.nextAt),
    [mergedTimers, timerNextFires]
  );

  // Toggle a timer on/off from the command input badge (double-click or stop button)
  const handleToggleTimer = useCallback(
    (id: string) => {
      const scope = id in timerState.characterTimers ? 'character' : 'global';
      timerState.toggleTimer(id, scope);
    },
    [timerState]
  );

  return {
    antiIdleNextAt,
    alignmentNextAt,
    whoNextAt,
    babelNextAt,
    activeTimerBadges,
    handleToggleTimer,
    refreshWho,
  };
}
