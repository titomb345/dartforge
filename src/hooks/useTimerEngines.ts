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
  const [antiIdleNextAt, setAntiIdleNextAt] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !loggedIn || !antiIdleEnabled) {
      setAntiIdleNextAt(null);
      return;
    }
    const ms = antiIdleMinutes * 60_000;
    setAntiIdleNextAt(Date.now() + ms);
    const id = setInterval(() => {
      const cmd = antiIdleCommandRef.current;
      if (sendCommandRef.current && antiIdleEnabledRef.current) {
        if (terminalRef.current) {
          smartWrite(terminalRef.current, `\x1b[90m[anti-idle: ${cmd}]\x1b[0m\r\n`);
        }
        sendCommandRef.current(cmd);
      }
      setAntiIdleNextAt(Date.now() + ms);
    }, ms);
    return () => {
      clearInterval(id);
      setAntiIdleNextAt(null);
    };
  }, [connected, loggedIn, antiIdleEnabled, antiIdleMinutes]);

  // Alignment tracking timer — polls "show alignment" at interval when enabled
  const alignmentTrackingEnabledRef = useLatestRef(alignmentTrackingEnabled);
  const [alignmentNextAt, setAlignmentNextAt] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !loggedIn || !alignmentTrackingEnabled) {
      setAlignmentNextAt(null);
      return;
    }
    const ms = alignmentTrackingMinutes * 60_000;
    setAlignmentNextAt(Date.now() + ms);
    const id = setInterval(() => {
      if (sendCommandRef.current && alignmentTrackingEnabledRef.current) {
        if (terminalRef.current && !outputFilterRef.current?.filterFlags.alignment) {
          smartWrite(terminalRef.current, `\x1b[90m[alignment sync]\x1b[0m\r\n`);
        }
        sendCommandRef.current('show alignment');
      }
      setAlignmentNextAt(Date.now() + ms);
    }, ms);
    return () => {
      clearInterval(id);
      setAlignmentNextAt(null);
    };
  }, [connected, loggedIn, alignmentTrackingEnabled, alignmentTrackingMinutes]);

  // Who list auto-refresh — sends `who` at interval, gagged via OutputFilter
  const [whoNextAt, setWhoNextAt] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !loggedIn || !whoAutoRefreshEnabled) {
      setWhoNextAt(null);
      return;
    }
    const ms = whoRefreshMinutes * 60_000;
    setWhoNextAt(Date.now() + ms);
    const id = setInterval(() => {
      if (sendCommandRef.current && outputFilterRef.current) {
        outputFilterRef.current.startWhoSync();
        sendCommandRef.current('who');
      }
      setWhoNextAt(Date.now() + ms);
    }, ms);
    return () => {
      clearInterval(id);
      setWhoNextAt(null);
    };
  }, [connected, loggedIn, whoAutoRefreshEnabled, whoRefreshMinutes]);

  // Custom timer engine — manages per-timer setIntervals, only fires when connected + logged in
  const timerIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const mergedTimersRef = useLatestRef(mergedTimers);
  const [timerNextFires, setTimerNextFires] = useState<Record<string, number>>({});

  useEffect(() => {
    // Clear all existing intervals
    for (const id of timerIntervalsRef.current.values()) clearInterval(id);
    timerIntervalsRef.current.clear();

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
      for (const id of timerIntervalsRef.current.values()) clearInterval(id);
      timerIntervalsRef.current.clear();
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

  // Manual who refresh — trigger from the panel's refresh button
  const refreshWho = useCallback(() => {
    if (sendCommandRef.current && outputFilterRef.current) {
      outputFilterRef.current.startWhoSync();
      sendCommandRef.current('who');
    }
  }, []);

  return {
    antiIdleNextAt,
    alignmentNextAt,
    whoNextAt,
    activeTimerBadges,
    handleToggleTimer,
    refreshWho,
  };
}
