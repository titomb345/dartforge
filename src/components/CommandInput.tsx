import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  KeyboardEvent,
  forwardRef,
} from 'react';
import { cn } from '../lib/cn';
import { TimerIcon, AlignmentIcon } from './icons';
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

/** Format remaining ms as "M:SS" countdown string. */
function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '0:00';
  const totalSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export const CommandInput = forwardRef<HTMLTextAreaElement, CommandInputProps>(
  ({ onSend, onReconnect }, ref) => {
    const {
      connected, disabled, passwordMode, skipHistory, recentLinesRef,
      onToggleCounter, antiIdleEnabled, antiIdleCommand, antiIdleMinutes,
      antiIdleNextAt, onToggleAntiIdle, alignmentTrackingEnabled,
      alignmentTrackingMinutes, alignmentNextAt, onToggleAlignmentTracking,
      activeTimers, onToggleTimer, initialHistory, onHistoryChange,
    } = useCommandInputContext();
    const { commandHistorySize, numpadMappings, showTimerBadges } = useAppSettingsContext();
    const { active: spotlightActive } = useSpotlight();
    const numpadRef = useRef(numpadMappings);
    numpadRef.current = numpadMappings;
    const toggleCounterRef = useRef(onToggleCounter);
    toggleCounterRef.current = onToggleCounter;
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
      if (!antiIdleNextAt && !alignmentNextAt && !hasActiveTimers) return;
      const id = setInterval(() => setCountdownTick((t) => t + 1), 1000);
      return () => clearInterval(id);
    }, [antiIdleNextAt, alignmentNextAt, hasActiveTimers]);

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
        internalRef.current.selectionStart = internalRef.current.selectionEnd = pendingCursorRef.current;
        pendingCursorRef.current = null;
      }
    }, [value]);

    const lineCount = value.split('\n').length;
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
            const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, commandHistorySize);
            onHistoryChangeRef.current?.(next);
            return next;
          });
        }
      }
      historyIndexRef.current = -1;
      searchPrefixRef.current = '';
      tabStateRef.current = null;
      setValue('');
    }, [value, onSend, passwordMode, skipHistory, commandHistorySize]);

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

        // Numpad * — toggle active improve counter
        if (e.code === 'NumpadMultiply' && toggleCounterRef.current) {
          e.preventDefault();
          toggleCounterRef.current();
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
        } else if (e.key === 'ArrowUp' && !e.shiftKey || e.key === 'ArrowDown' && !e.shiftKey) {
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
          const filtered = prefix
            ? history.filter((h) => h.startsWith(prefix))
            : history;

          const idx = historyIndexRef.current === -1
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
      <div data-help-id="command-input" className="flex items-start px-2.5 py-1.5 border-t border-border-subtle transition-[border-color] duration-300 ease-in-out">
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

        {/* Alignment tracking badge (only when active) */}
        {showTimerBadges && alignmentTrackingEnabled && (
          <span
            title={`Alignment tracking: every ${alignmentTrackingMinutes}m (double-click to stop)`}
            onDoubleClick={onToggleAlignmentTracking}
            className="flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] font-mono self-center shrink-0 ml-1 text-[#80e080] border-[#80e080]/30 bg-[#80e080]/8 cursor-pointer select-none"
            style={{ filter: 'drop-shadow(0 0 3px rgba(128, 224, 128, 0.25))' }}
          >
            <AlignmentIcon size={9} />
            <span>{alignmentNextAt
              ? formatCountdown(alignmentNextAt - Date.now())
              : `${alignmentTrackingMinutes}m`}</span>
          </span>
        )}

        {/* Anti-idle badge (only when active, hidden when alignment tracking supersedes) */}
        {showTimerBadges && antiIdleEnabled && !alignmentTrackingEnabled && (
          <span
            title={`Anti-idle: "${antiIdleCommand}" every ${antiIdleMinutes}m (double-click to stop)`}
            onDoubleClick={onToggleAntiIdle}
            className="flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] font-mono self-center shrink-0 ml-1 text-[#bd93f9] border-[#bd93f9]/30 bg-[#bd93f9]/8 cursor-pointer select-none"
            style={{ filter: 'drop-shadow(0 0 3px rgba(189, 147, 249, 0.25))' }}
          >
            <TimerIcon size={9} />
            <span>{antiIdleNextAt
              ? formatCountdown(antiIdleNextAt - Date.now())
              : `${antiIdleMinutes}m`}</span>
          </span>
        )}

        {/* Custom timer countdown badges (sorted soonest-first) */}
        {showTimerBadges && activeTimers && activeTimers.length > 0 && (() => {
          const MAX_VISIBLE = 2;
          const visible = activeTimers.slice(0, MAX_VISIBLE);
          const overflow = activeTimers.slice(MAX_VISIBLE);

          return (
            <>
              {visible.map((t) => (
                <span
                  key={t.id}
                  title={`Timer: ${t.name} (double-click to stop)`}
                  onDoubleClick={() => onToggleTimer?.(t.id)}
                  className="flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] font-mono self-center shrink-0 ml-1 text-[#f97316] border-[#f97316]/30 bg-[#f97316]/8 cursor-pointer select-none"
                  style={{ filter: 'drop-shadow(0 0 3px rgba(249, 115, 22, 0.25))' }}
                >
                  <TimerIcon size={8} />
                  <span className="max-w-[50px] truncate">{t.name}</span>
                  <span>{formatCountdown(t.nextAt - Date.now())}</span>
                </span>
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
                          <span className="shrink-0">{formatCountdown(t.nextAt - Date.now())}</span>
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
        {spotlightActive?.helpId === 'command-input' && (!showTimerBadges || (!hasActiveTimers && !antiIdleEnabled && !alignmentTrackingEnabled)) && (
          <span
            className="flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] font-mono self-center shrink-0 ml-1 text-[#f97316] border-[#f97316]/30 bg-[#f97316]/8 opacity-75"
            style={{ filter: 'drop-shadow(0 0 3px rgba(249, 115, 22, 0.25))' }}
          >
            <TimerIcon size={8} />
            <span>heal</span>
            <span>0:25</span>
          </span>
        )}
      </div>
    );
  }
);
