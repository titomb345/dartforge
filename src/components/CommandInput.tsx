import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  KeyboardEvent,
  forwardRef,
} from 'react';
import { cn } from '../lib/cn';
import { formatCountdown } from '../lib/panelUtils';
import { TimerIcon, AlignmentIcon, WhoIcon } from './icons';
import { StatusBadge } from './StatusBadge';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { useCommandInputContext } from '../contexts/CommandInputContext';
import { useSpotlight } from '../contexts/SpotlightContext';

interface CommandInputProps {
  onSend: (command: string) => void;
  onReconnect: () => void;
}

const LINE_HEIGHT = 20;
const MAX_LINES = 8;
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES;

/** Numpad key → MUD direction command */
const NUMPAD_DIRECTIONS: Record<string, string> = {
  Numpad7: 'nw',
  Numpad8: 'n',
  Numpad9: 'ne',
  Numpad4: 'w',
  Numpad5: 'd',
  Numpad6: 'e',
  Numpad1: 'sw',
  Numpad2: 's',
  Numpad3: 'se',
  Numpad0: 'u',
  NumpadAdd: 'back',
  NumpadDivide: '/counter info',
  NumpadMultiply: '/counter toggle',
  NumpadSubtract: '/movemode',
  NumpadDecimal: 'survey',
};

interface TabState {
  prefix: string;
  wordStart: number;
  matches: string[];
  matchIndex: number;
}

/** Find words in recent output lines matching a prefix (case-insensitive, most-recent first). */
function findTabMatches(lines: string[], prefix: string): string[] {
  const lowerPrefix = prefix.toLowerCase();
  const seen = new Set<string>();
  const matches: string[] = [];

  for (const line of lines) {
    const words = line.match(/\S+/g) || [];
    for (const raw of words) {
      const word = raw.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
      if (!word) continue;
      const lower = word.toLowerCase();
      if (lower.startsWith(lowerPrefix) && lower !== lowerPrefix && !seen.has(lower)) {
        seen.add(lower);
        matches.push(word);
      }
    }
  }

  return matches;
}

export const CommandInput = forwardRef<HTMLTextAreaElement, CommandInputProps>(
  ({ onSend, onReconnect }, ref) => {
    const {
      connected,
      disabled,
      passwordMode,
      skipHistory,
      recentLinesRef,
      antiIdleEnabled,
      antiIdleCommand,
      antiIdleMinutes,
      antiIdleNextAt,
      onToggleAntiIdle,
      alignmentTrackingEnabled,
      alignmentTrackingMinutes,
      alignmentNextAt,
      onToggleAlignmentTracking,
      whoAutoRefreshEnabled,
      whoRefreshMinutes,
      whoNextAt,
      onToggleWhoAutoRefresh,
      activeTimers,
      onToggleTimer,
      initialHistory,
      onHistoryChange,
      actionBlocked,
      actionBlockLabel,
      actionQueueLength,
      movementMode,
      onToggleMovementMode,
      babelEnabled,
      babelLanguage,
      babelNextAt,
      onToggleBabel,
      inscriberActive,
      inscriberSpell,
      inscriberCycleCount,
      onStopInscriber,
      casterActive,
      casterSpell,
      casterPower,
      casterCycleCount,
      casterWeightMode,
      casterCarriedWeight,
      casterWeightItem,
      onStopCaster,
      concActive,
      concAction,
      concCycleCount,
      onStopConc,
      announceMode,
      onStopAnnounce,
    } = useCommandInputContext();
    const { commandHistorySize, numpadMappings, showTimerBadges, selectOnSend } =
      useAppSettingsContext();
    const { active: spotlightActive } = useSpotlight();
    const numpadRef = useRef(numpadMappings);
    numpadRef.current = numpadMappings;
    const onHistoryChangeRef = useRef(onHistoryChange);
    onHistoryChangeRef.current = onHistoryChange;
    const [value, setValue] = useState('');
    const [history, setHistory] = useState<string[]>(initialHistory ?? []);
    const historyLoadedRef = useRef(false);
    const historyIndexRef = useRef(-1);
    const searchPrefixRef = useRef('');
    const internalRef = useRef<HTMLTextAreaElement | null>(null);
    const tabStateRef = useRef<TabState | null>(null);
    const pendingCursorRef = useRef<number | null>(null);

    // Merge forwarded ref with internal ref
    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        internalRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      },
      [ref]
    );

    // Sync persisted history when it arrives from async load
    useEffect(() => {
      if (!historyLoadedRef.current && initialHistory && initialHistory.length > 0) {
        historyLoadedRef.current = true;
        setHistory(initialHistory);
      }
    }, [initialHistory]);

    // Clear input when password mode is turned off (e.g. disconnect) to avoid revealing the password
    const prevPasswordMode = useRef(passwordMode);
    useEffect(() => {
      if (prevPasswordMode.current && !passwordMode) setValue('');
      prevPasswordMode.current = passwordMode;
    }, [passwordMode]);

    // Anti-idle / alignment / custom timer countdown tick
    const hasActiveTimers = activeTimers && activeTimers.length > 0;
    const [, setCountdownTick] = useState(0);
    useEffect(() => {
      if (!antiIdleNextAt && !alignmentNextAt && !whoNextAt && !hasActiveTimers) return;
      const id = setInterval(() => setCountdownTick((t) => t + 1), 1000);
      return () => clearInterval(id);
    }, [antiIdleNextAt, alignmentNextAt, whoNextAt, hasActiveTimers]);

    // Timer overflow dropdown state
    const [timerOverflowOpen, setTimerOverflowOpen] = useState(false);

    // Re-focus when window regains focus
    useEffect(() => {
      const handleFocus = () => internalRef.current?.focus();
      window.addEventListener('focus', handleFocus);
      return () => window.removeEventListener('focus', handleFocus);
    }, []);

    // Auto-resize textarea to fit content (useLayoutEffect avoids flicker)
    useLayoutEffect(() => {
      const el = internalRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
    }, [value]);

    // Set cursor position after value changes (for tab completion)
    useLayoutEffect(() => {
      if (pendingCursorRef.current !== null && internalRef.current) {
        internalRef.current.selectionStart = internalRef.current.selectionEnd =
          pendingCursorRef.current;
        pendingCursorRef.current = null;
      }
    }, [value]);

    const lineCount = useMemo(() => value.split('\n').length, [value]);
    const isMultiLine = lineCount > 1;

    const submit = useCallback(() => {
      const lines = value.split('\n');
      for (const line of lines) {
        onSend(line);
      }
      if (!passwordMode && !skipHistory) {
        const trimmed = value.trim();
        if (trimmed) {
          setHistory((prev) => {
            const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(
              0,
              commandHistorySize
            );
            onHistoryChangeRef.current?.(next);
            return next;
          });
        }
      }
      historyIndexRef.current = -1;
      searchPrefixRef.current = '';
      tabStateRef.current = null;
      if (selectOnSend && !passwordMode && !skipHistory) {
        // Keep text but select it all — typing replaces, Enter resends
        requestAnimationFrame(() => internalRef.current?.select());
      } else {
        setValue('');
      }
    }, [value, onSend, passwordMode, skipHistory, commandHistorySize, selectOnSend]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Reset tab state on non-Tab keys
        if (e.key !== 'Tab') {
          tabStateRef.current = null;
        }

        // Numpad movement — send direction immediately regardless of input state
        const numpadDir = numpadRef.current[e.code] ?? NUMPAD_DIRECTIONS[e.code];
        if (numpadDir) {
          e.preventDefault();
          onSend(numpadDir);
          return;
        }

        // Tab completion from recent MUD output
        if (e.key === 'Tab' && !e.shiftKey && recentLinesRef?.current) {
          const el = internalRef.current;
          if (!el) return;
          e.preventDefault();

          const cursorPos = el.selectionStart;

          // Check if cycling through existing completions
          const ts = tabStateRef.current;
          if (ts && ts.matches.length > 0) {
            const currentMatch = ts.matches[ts.matchIndex];
            const expectedCursor = ts.wordStart + currentMatch.length;
            if (cursorPos === expectedCursor) {
              const nextIndex = (ts.matchIndex + 1) % ts.matches.length;
              const nextMatch = ts.matches[nextIndex];
              const before = value.substring(0, ts.wordStart);
              const after = value.substring(expectedCursor);
              setValue(before + nextMatch + after);
              ts.matchIndex = nextIndex;
              pendingCursorRef.current = ts.wordStart + nextMatch.length;
              return;
            }
          }

          // Fresh tab completion
          const textBeforeCursor = value.substring(0, cursorPos);
          const wordMatch = textBeforeCursor.match(/(\S+)$/);
          if (!wordMatch) {
            tabStateRef.current = null;
            return;
          }

          const prefix = wordMatch[1];
          const wordStart = cursorPos - prefix.length;
          const matches = findTabMatches(recentLinesRef.current, prefix);

          if (matches.length === 0) {
            tabStateRef.current = null;
            return;
          }

          const match = matches[0];
          const before = value.substring(0, wordStart);
          const after = value.substring(cursorPos);
          setValue(before + match + after);
          tabStateRef.current = { prefix, wordStart, matches, matchIndex: 0 };
          pendingCursorRef.current = wordStart + match.length;
          return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!connected && value.trim() === '') {
            onReconnect();
            return;
          }
          // Don't send empty lines during login prompts (Name:/Password:)
          if (skipHistory && value.trim() === '') return;
          submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setValue('');
          historyIndexRef.current = -1;
          searchPrefixRef.current = '';
        } else if ((e.key === 'ArrowUp' && !e.shiftKey) || (e.key === 'ArrowDown' && !e.shiftKey)) {
          const el = internalRef.current;
          if (!el) return;
          // ArrowUp: only when cursor is on the first line
          // ArrowDown: only when cursor is on the last line
          const isUp = e.key === 'ArrowUp';
          const surrounding = isUp
            ? value.substring(0, el.selectionStart)
            : value.substring(el.selectionStart);
          if (surrounding.includes('\n')) return;

          e.preventDefault();

          // On first navigation, save the typed prefix
          if (historyIndexRef.current === -1 && isUp) {
            searchPrefixRef.current = value;
          }

          // Filter history by the saved prefix
          const prefix = searchPrefixRef.current;
          const filtered = prefix ? history.filter((h) => h.startsWith(prefix)) : history;

          const idx =
            historyIndexRef.current === -1
              ? -1
              : filtered.indexOf(history[historyIndexRef.current]);
          const next = isUp ? idx + 1 : idx - 1;

          if (next >= 0 && next < filtered.length) {
            setValue(filtered[next]);
            historyIndexRef.current = history.indexOf(filtered[next]);
          } else if (!isUp) {
            // Past newest match — restore typed prefix
            setValue(searchPrefixRef.current);
            historyIndexRef.current = -1;
          }
        }
      },
      [submit, history, value, connected, onReconnect, skipHistory, recentLinesRef]
    );

    return (
      <div
        data-help-id="command-input"
        className="flex items-start px-2.5 py-1.5 border-t border-border-subtle transition-[border-color] duration-300 ease-in-out"
      >
        {/* Prompt / line count */}
        <span
          className={cn(
            'font-mono text-[13px] pt-[5px] pr-2 pl-1 leading-[20px] transition-colors duration-300 ease-in-out text-right',
            disabled ? 'text-text-disabled' : 'text-green',
            isMultiLine ? 'min-w-[28px]' : 'min-w-0'
          )}
        >
          {isMultiLine && <span className="text-comment">{lineCount}</span>}
          {'>'}
        </span>

        <textarea
          ref={setRefs}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={disabled}
          autoFocus
          rows={1}
          placeholder={disabled ? 'disconnected' : ''}
          spellCheck={false}
          className={cn(
            'flex-1 bg-transparent border-none py-[5px] px-0 text-text-primary font-mono text-sm',
            'leading-[20px] outline-none resize-none overflow-hidden',
            'min-h-[20px] max-h-[160px]',
            passwordMode ? 'caret-purple password-mask' : 'caret-cyan'
          )}
        />

        {/* Action blocking badge */}
        {actionBlocked && (
          <StatusBadge
            color="#f59e0b"
            title={`Blocked: ${actionBlockLabel ?? 'action'} — ${actionQueueLength} command(s) queued. /unblock to release`}
          >
            <span>{actionBlockLabel ?? 'BLOCKED'}</span>
            {actionQueueLength > 0 && <span>({actionQueueLength})</span>}
          </StatusBadge>
        )}

        {/* Movement mode badge (only when not normal) */}
        {movementMode !== 'normal' && (
          <StatusBadge
            color="#2dd4bf"
            title={`Movement mode: ${movementMode} — Numpad / or /movemode to cycle`}
            onClick={onToggleMovementMode}
            animate
          >
            <span>{movementMode.charAt(0).toUpperCase() + movementMode.slice(1)}</span>
          </StatusBadge>
        )}

        {/* Babel language trainer badge */}
        {babelEnabled && babelLanguage && (
          <StatusBadge
            color="#e879f9"
            title={`Babel: training ${babelLanguage} — click to stop`}
            onClick={onToggleBabel}
            animate
          >
            <span>Babel</span>
            {babelNextAt && (
              <span className="opacity-70">{formatCountdown(babelNextAt - Date.now())}</span>
            )}
          </StatusBadge>
        )}

        {/* Auto-inscriber badge */}
        {inscriberActive && (
          <StatusBadge
            color="#60a5fa"
            title={`Autoinscribe: ${inscriberSpell ?? '?'} — click to stop`}
            onClick={onStopInscriber}
            animate
          >
            <span>Autoinscribe</span>
            {inscriberCycleCount > 0 && (
              <span className="opacity-70">x{inscriberCycleCount}</span>
            )}
          </StatusBadge>
        )}

        {/* Auto-caster badge */}
        {casterActive && (
          <StatusBadge
            color={casterWeightMode ? '#fbbf24' : '#34d399'}
            title={
              casterWeightMode
                ? `Autocast: ${casterSpell ?? '?'} @${casterPower ?? '?'} — carrying ${casterCarriedWeight} ${casterWeightItem} — click to stop`
                : `Autocast: ${casterSpell ?? '?'} @${casterPower ?? '?'} — click to stop`
            }
            onClick={onStopCaster}
            animate
          >
            <span>{casterWeightMode ? 'Autocast+Wt' : 'Autocast'}</span>
            {casterCycleCount > 0 && (
              <span className="opacity-70">x{casterCycleCount}</span>
            )}
          </StatusBadge>
        )}

        {/* Auto-conc badge */}
        {concActive && (
          <StatusBadge
            color="#c084fc"
            title={`Autoconc: ${concAction ?? '?'} — click to stop`}
            onClick={onStopConc}
            animate
          >
            <span>Autoconc</span>
            {concCycleCount > 0 && (
              <span className="opacity-70">x{concCycleCount}</span>
            )}
          </StatusBadge>
        )}

        {/* Announce badge */}
        {announceMode !== 'off' && (
          <StatusBadge
            color="#fb923c"
            title={`Announce: ${announceMode} — click to stop`}
            onClick={onStopAnnounce}
          >
            <span>Announce: {announceMode}</span>
          </StatusBadge>
        )}

        {/* Alignment tracking badge (only when active) */}
        {showTimerBadges && alignmentTrackingEnabled && (
          <StatusBadge
            color="#80e080"
            title={`Alignment tracking: every ${alignmentTrackingMinutes}m (double-click to stop)`}
            onDoubleClick={onToggleAlignmentTracking}
          >
            <AlignmentIcon size={9} />
            <span>
              {alignmentNextAt
                ? formatCountdown(alignmentNextAt - Date.now())
                : `${alignmentTrackingMinutes}m`}
            </span>
          </StatusBadge>
        )}

        {/* Who auto-refresh badge (only when active) */}
        {showTimerBadges && whoAutoRefreshEnabled && (
          <StatusBadge
            color="#61afef"
            title={`Who auto-refresh: every ${whoRefreshMinutes}m (double-click to stop)`}
            onDoubleClick={onToggleWhoAutoRefresh}
          >
            <WhoIcon size={9} />
            <span>
              {whoNextAt ? formatCountdown(whoNextAt - Date.now()) : `${whoRefreshMinutes}m`}
            </span>
          </StatusBadge>
        )}

        {/* Anti-idle badge (only when active, hidden when alignment tracking supersedes) */}
        {showTimerBadges && antiIdleEnabled && !alignmentTrackingEnabled && (
          <StatusBadge
            color="#bd93f9"
            title={`Anti-idle: "${antiIdleCommand}" every ${antiIdleMinutes}m (double-click to stop)`}
            onDoubleClick={onToggleAntiIdle}
          >
            <TimerIcon size={9} />
            <span>
              {antiIdleNextAt
                ? formatCountdown(antiIdleNextAt - Date.now())
                : `${antiIdleMinutes}m`}
            </span>
          </StatusBadge>
        )}

        {/* Custom timer countdown badges (sorted soonest-first) */}
        {showTimerBadges &&
          activeTimers &&
          activeTimers.length > 0 &&
          (() => {
            const MAX_VISIBLE = 2;
            const visible = activeTimers.slice(0, MAX_VISIBLE);
            const overflow = activeTimers.slice(MAX_VISIBLE);

            return (
              <>
                {visible.map((t) => (
                  <StatusBadge
                    key={t.id}
                    color="#f97316"
                    title={`Timer: ${t.name} (double-click to stop)`}
                    onDoubleClick={() => onToggleTimer?.(t.id)}
                  >
                    <TimerIcon size={8} />
                    <span className="max-w-[50px] truncate">{t.name}</span>
                    <span>{formatCountdown(t.nextAt - Date.now())}</span>
                  </StatusBadge>
                ))}
                {overflow.length > 0 && (
                  <div className="relative self-center shrink-0 ml-1">
                    <button
                      onClick={() => setTimerOverflowOpen((v) => !v)}
                      onBlur={() => setTimeout(() => setTimerOverflowOpen(false), 150)}
                      className="flex items-center gap-0.5 px-1.5 py-1 rounded border text-[9px] font-mono cursor-pointer text-[#f97316] border-[#f97316]/30 bg-[#f97316]/8 hover:bg-[#f97316]/15 transition-colors duration-150"
                      style={{ filter: 'drop-shadow(0 0 3px rgba(249, 115, 22, 0.25))' }}
                    >
                      +{overflow.length}
                    </button>
                    {timerOverflowOpen && (
                      <div className="absolute bottom-full right-0 mb-1 bg-bg-primary border border-[#f97316]/30 rounded-lg shadow-lg py-1 min-w-[160px] z-50">
                        {overflow.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-mono text-[#f97316]"
                          >
                            <TimerIcon size={8} />
                            <span className="flex-1 truncate">{t.name}</span>
                            <span className="shrink-0">
                              {formatCountdown(t.nextAt - Date.now())}
                            </span>
                            <button
                              onClick={() => onToggleTimer?.(t.id)}
                              title="Stop timer"
                              className="shrink-0 ml-1 px-1 py-0.5 rounded text-[8px] border border-[#f97316]/30 bg-[#f97316]/10 hover:bg-[#f97316]/25 transition-colors cursor-pointer"
                            >
                              stop
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}

        {/* Demo timer badge when spotlight is active but no real badges are visible */}
        {spotlightActive?.helpId === 'command-input' &&
          (!showTimerBadges ||
            (!hasActiveTimers &&
              !antiIdleEnabled &&
              !alignmentTrackingEnabled &&
              !whoAutoRefreshEnabled)) && (
            <StatusBadge color="#f97316" title="Demo timer badge">
              <TimerIcon size={8} />
              <span>heal</span>
              <span>0:25</span>
            </StatusBadge>
          )}
      </div>
    );
  }
);
