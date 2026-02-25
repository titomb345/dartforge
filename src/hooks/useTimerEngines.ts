import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLatestRef } from './useLatestRef';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { Timer } from '../types/timer';
import type { TimerState } from '../contexts/TimerContext';
import type { Alias } from '../types/alias';
import type { OutputFilter } from '../lib/outputFilter';
import type { CommandRunner } from '../lib/commandUtils';
import { expandInput } from '../lib/aliasEngine';
import { executeCommands } from '../lib/commandUtils';
import { smartWrite } from '../lib/terminalUtils';
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
  terminalRef: React.RefObject<XTerm | null>;
  outputFilterRef: React.RefObject<OutputFilter | null>;
  mergedAliasesRef: React.RefObject<Alias[]>;
  enableSpeedwalkRef: React.RefObject<boolean>;
  activeCharacterRef: React.RefObject<string | null>;
  triggerRunnerRef: React.RefObject<CommandRunner>;
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
  terminalRef,
  outputFilterRef,
  mergedAliasesRef,
  enableSpeedwalkRef,
  activeCharacterRef,
  triggerRunnerRef,
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
        if (terminalRef.current) {
          smartWrite(terminalRef.current, `\x1b[90m[anti-idle: ${cmd}]\x1b[0m\r\n`);
        }
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
        if (terminalRef.current && !outputFilterRef.current?.filterFlags.alignment) {
          smartWrite(terminalRef.current, `\x1b[90m[alignment sync]\x1b[0m\r\n`);
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
        if (terminalRef.current) {
          smartWrite(terminalRef.current, `\x1b[90m[babel: ${lang}] ${phrase}\x1b[0m\r\n`);
        }
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

  // Custom timer engine — manages per-timer setIntervals, only fires when connected + logged in
  const timerIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const clearTimerIntervals = useCallback(() => {
    for (const id of timerIntervalsRef.current.values()) clearInterval(id);
    timerIntervalsRef.current.clear();
  }, []);
  const mergedTimersRef = useLatestRef(mergedTimers);
  const [timerNextFires, setTimerNextFires] = useState<Record<string, number>>({});

  useEffect(() => {
    clearTimerIntervals();

    if (!connected || !loggedIn) {
      setTimerNextFires({});
      return;
    }

    const enabledTimers = mergedTimersRef.current.filter((t) => t.enabled);
    const nextFires: Record<string, number> = {};

    for (const timer of enabledTimers) {
      const ms = timer.intervalSeconds * 1000;
      nextFires[timer.id] = Date.now() + ms;

      const intervalId = setInterval(() => {
        if (!sendCommandRef.current) return;

        if (terminalRef.current) {
          smartWrite(terminalRef.current, `\x1b[90m[timer: ${timer.name}]\x1b[0m\r\n`);
        }

        // Expand body through alias engine, then execute via the shared runner
        const result = expandInput(timer.body, mergedAliasesRef.current, {
          enableSpeedwalk: enableSpeedwalkRef.current,
          activeCharacter: activeCharacterRef.current,
        });
        executeCommands(result.commands, triggerRunnerRef.current);

        setTimerNextFires((prev) => ({ ...prev, [timer.id]: Date.now() + ms }));
      }, ms);

      timerIntervalsRef.current.set(timer.id, intervalId);
    }

    setTimerNextFires(nextFires);

    return () => {
      clearTimerIntervals();
      setTimerNextFires({});
    };
  }, [connected, loggedIn, mergedTimers]);

  // Active timer badges for CommandInput (sorted by soonest-to-fire first)
  const activeTimerBadges = useMemo(
    () =>
      mergedTimers
        .filter((t) => t.enabled && timerNextFires[t.id])
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
