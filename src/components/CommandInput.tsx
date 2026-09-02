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
import { TimerIcon, AlignmentIcon, WhoIcon, LoadoutIcon } from './icons';
import { StatusBadge } from './StatusBadge';
import { CHIP_ACCENT } from '../lib/accents';
import { PopoverMenu } from './PopoverMenu';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { useCommandInputContext } from '../contexts/CommandInputContext';
import { usePanelContext } from '../contexts/PanelLayoutContext';
import { useSpotlight } from '../contexts/SpotlightContext';

interface CommandInputProps {
  onSend: (command: string) => void;
  onReconnect: () => void;
  promptChar?: string;
  promptColor?: string;
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
  ({ onSend, onReconnect, promptChar = '>', promptColor = '#00ff00' }, ref) => {
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
      equipAutoRefreshEnabled,
      equipRefreshMinutes,
      equipNextAt,
      onToggleEquipAutoRefresh,
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
    const { activePanel, closePanel } = usePanelContext();
    const activePanelRef = useRef(activePanel);
    activePanelRef.current = activePanel;
    const closePanelRef = useRef(closePanel);
    closePanelRef.current = closePanel;
    const numpadRef = useRef(numpadMappings);
    numpadRef.current = numpadMappings;
    const onHistoryChangeRef = useRef(onHistoryChange);
    onHistoryChangeRef.current = onHistoryChange;
    const [value, setValue] = useState('');
    const [history, setHistory] = useState<string[]>(initialHistory ?? []);
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

    // Sync history from parent (persisted load + companion commands)
    useEffect(() => {
      if (initialHistory) {
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
      if (!antiIdleNextAt && !alignmentNextAt && !whoNextAt && !equipNextAt && !hasActiveTimers)
        return;
      const id = setInterval(() => setCountdownTick((t) => t + 1), 1000);
      return () => clearInterval(id);
    }, [antiIdleNextAt, alignmentNextAt, whoNextAt, equipNextAt, hasActiveTimers]);

    // Timer overflow dropdown state
    const [timerMenu, setTimerMenu] = useState<{ x: number; y: number } | null>(null);

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
          // A slide-out that is open takes the Escape; the input keeps its text.
          if (activePanelRef.current) {
            closePanelRef.current();
            return;
          }
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
            disabled ? 'text-text-disabled' : '',
            isMultiLine ? 'min-w-[28px]' : 'min-w-0'
          )}
          style={disabled ? undefined : { color: promptColor }}
        >
          {isMultiLine && <span className="text-comment">{lineCount}</span>}
          {promptChar}
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

        {/* Status chips. Two families, one rule: anything you can stop has
            the same × on it. Running (filled, glowing dot) = things you
            started. Scheduled (outlined) = refreshers and timers on a clock. */}

        {actionBlocked && (
          <StatusBadge
            color={CHIP_ACCENT.blocked}
            title={`Blocked: ${actionBlockLabel ?? 'action'}. ${actionQueueLength} command(s) queued. /unblock to release`}
          >
            <span>{actionBlockLabel ?? 'Blocked'}</span>
            {actionQueueLength > 0 && <span className="opacity-70">+{actionQueueLength}</span>}
          </StatusBadge>
        )}

        {movementMode !== 'normal' && (
          <StatusBadge
            color={CHIP_ACCENT.movement}
            title={`Movement mode: ${movementMode}. Click to cycle (Numpad / or /movemode)`}
            onClick={onToggleMovementMode}
            animate
          >
            <span>{movementMode.charAt(0).toUpperCase() + movementMode.slice(1)}</span>
          </StatusBadge>
        )}

        {babelEnabled && babelLanguage && (
          <StatusBadge
            color={CHIP_ACCENT.babel}
            title={`Babel: training ${babelLanguage}`}
            onStop={onToggleBabel}
            stopTitle="Stop Babel"
            animate
          >
            <span>Babel</span>
            {babelNextAt && (
              <span className="opacity-70">{formatCountdown(babelNextAt - Date.now())}</span>
            )}
          </StatusBadge>
        )}

        {inscriberActive && (
          <StatusBadge
            color={CHIP_ACCENT.inscriber}
            title={`Autoinscribe: ${inscriberSpell ?? '?'}`}
            onStop={onStopInscriber}
            stopTitle="Stop autoinscribe"
            animate
          >
            <span>Autoinscribe</span>
            {inscriberCycleCount > 0 && <span className="opacity-70">x{inscriberCycleCount}</span>}
          </StatusBadge>
        )}

        {casterActive && (
          <StatusBadge
            color={casterWeightMode ? CHIP_ACCENT.casterWeight : CHIP_ACCENT.caster}
            title={
              casterWeightMode
                ? `Autocast: ${casterSpell ?? '?'} @${casterPower ?? '?'}, carrying ${casterCarriedWeight} ${casterWeightItem}`
                : `Autocast: ${casterSpell ?? '?'} @${casterPower ?? '?'}`
            }
            onStop={onStopCaster}
            stopTitle="Stop autocast"
            animate
          >
            <span>{casterWeightMode ? 'Autocast+Wt' : 'Autocast'}</span>
            {casterCycleCount > 0 && <span className="opacity-70">x{casterCycleCount}</span>}
          </StatusBadge>
        )}

        {concActive && (
          <StatusBadge
            color={CHIP_ACCENT.conc}
            title={`Autoconc: ${concAction ?? '?'}`}
            onStop={onStopConc}
            stopTitle="Stop autoconc"
            animate
          >
            <span>Autoconc</span>
            {concCycleCount > 0 && <span className="opacity-70">x{concCycleCount}</span>}
          </StatusBadge>
        )}

        {announceMode !== 'off' && (
          <StatusBadge
            color={CHIP_ACCENT.announce}
            title={`Announcing: ${announceMode}`}
            onStop={onStopAnnounce}
            stopTitle="Stop announcing"
          >
            <span>Announce {announceMode}</span>
          </StatusBadge>
        )}

        {showTimerBadges && alignmentTrackingEnabled && (
          <StatusBadge
            kind="scheduled"
            color={CHIP_ACCENT.alignment}
            title={`Alignment check every ${alignmentTrackingMinutes}m`}
            onStop={onToggleAlignmentTracking}
            stopTitle="Stop alignment checks"
          >
            <AlignmentIcon size={9} />
            <span>align</span>
            <span className="opacity-80">
              {alignmentNextAt
                ? formatCountdown(alignmentNextAt - Date.now())
                : `${alignmentTrackingMinutes}m`}
            </span>
          </StatusBadge>
        )}

        {showTimerBadges && whoAutoRefreshEnabled && (
          <StatusBadge
            kind="scheduled"
            color={CHIP_ACCENT.who}
            title={`Who list refresh every ${whoRefreshMinutes}m`}
            onStop={onToggleWhoAutoRefresh}
            stopTitle="Stop who refresh"
          >
            <WhoIcon size={9} />
            <span>who</span>
            <span className="opacity-80">
              {whoNextAt ? formatCountdown(whoNextAt - Date.now()) : `${whoRefreshMinutes}m`}
            </span>
          </StatusBadge>
        )}

        {showTimerBadges && equipAutoRefreshEnabled && (
          <StatusBadge
            kind="scheduled"
            color={CHIP_ACCENT.equip}
            title={`Held equipment re-sync every ${equipRefreshMinutes}m`}
            onStop={onToggleEquipAutoRefresh}
            stopTitle="Stop equipment re-sync"
          >
            <LoadoutIcon size={9} />
            <span>equip</span>
            <span className="opacity-80">
              {equipNextAt ? formatCountdown(equipNextAt - Date.now()) : `${equipRefreshMinutes}m`}
            </span>
          </StatusBadge>
        )}

        {showTimerBadges && antiIdleEnabled && !alignmentTrackingEnabled && (
          <StatusBadge
            kind="scheduled"
            color={CHIP_ACCENT.antiIdle}
            title={`Anti-idle: "${antiIdleCommand}" every ${antiIdleMinutes}m`}
            onStop={onToggleAntiIdle}
            stopTitle="Stop anti-idle"
          >
            <TimerIcon size={9} />
            <span>idle</span>
            <span className="opacity-80">
              {antiIdleNextAt
                ? formatCountdown(antiIdleNextAt - Date.now())
                : `${antiIdleMinutes}m`}
            </span>
          </StatusBadge>
        )}

        {/* Custom timer countdown chips (soonest first); the rest fold into +N */}
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
                    kind="scheduled"
                    color={CHIP_ACCENT.timer}
                    title={`Timer: ${t.name}`}
                    onStop={() => onToggleTimer?.(t.id)}
                    stopTitle={`Stop timer "${t.name}"`}
                  >
                    <TimerIcon size={8} />
                    <span className="max-w-[60px] truncate">{t.name}</span>
                    <span className="opacity-80">{formatCountdown(t.nextAt - Date.now())}</span>
                  </StatusBadge>
                ))}
                {overflow.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={(e: React.MouseEvent) =>
                        setTimerMenu(timerMenu ? null : { x: e.clientX, y: e.clientY })
                      }
                      title={`${overflow.length} more timer${overflow.length === 1 ? '' : 's'}`}
                      className="self-center shrink-0 ml-1 px-1.5 py-[3px] rounded border text-[10px] font-mono cursor-pointer transition-colors duration-150 hover:bg-[color-mix(in_srgb,currentColor_15%,transparent)]"
                      style={{ color: CHIP_ACCENT.timer, borderColor: `${CHIP_ACCENT.timer}4d` }}
                    >
                      +{overflow.length}
                    </button>
                    {timerMenu && (
                      <PopoverMenu
                        x={timerMenu.x}
                        y={timerMenu.y}
                        onClose={() => setTimerMenu(null)}
                        className="bg-bg-primary border rounded-lg shadow-lg py-1 min-w-[180px]"
                        style={{ borderColor: `${CHIP_ACCENT.timer}4d` }}
                      >
                        {overflow.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono"
                            style={{ color: CHIP_ACCENT.timer }}
                          >
                            <TimerIcon size={8} />
                            <span className="flex-1 truncate">{t.name}</span>
                            <span className="shrink-0 opacity-80">
                              {formatCountdown(t.nextAt - Date.now())}
                            </span>
                            <button
                              type="button"
                              onClick={() => onToggleTimer?.(t.id)}
                              title={`Stop timer "${t.name}"`}
                              aria-label={`Stop timer "${t.name}"`}
                              className="chip-stop"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </PopoverMenu>
                    )}
                  </>
                )}
              </>
            );
          })()}

        {/* Demo chip when the guide spotlight is on the input but nothing real is running */}
        {spotlightActive?.helpId === 'command-input' &&
          (!showTimerBadges ||
            (!hasActiveTimers &&
              !antiIdleEnabled &&
              !alignmentTrackingEnabled &&
              !whoAutoRefreshEnabled)) && (
            <StatusBadge kind="scheduled" color={CHIP_ACCENT.timer} title="Example timer chip">
              <TimerIcon size={8} />
              <span>heal</span>
              <span className="opacity-80">0:25</span>
            </StatusBadge>
          )}
      </div>
    );
  }
);
