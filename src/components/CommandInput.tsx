import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  KeyboardEvent,
  forwardRef,
} from 'react';

interface CommandInputProps {
  onSend: (command: string) => void;
  onReconnect: () => void;
  disabled: boolean;
  connected: boolean;
  passwordMode: boolean;
  skipHistory: boolean;
}

const MAX_HISTORY = 100;
const LINE_HEIGHT = 20;
const MAX_LINES = 8;
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES;

export const CommandInput = forwardRef<HTMLTextAreaElement, CommandInputProps>(
  ({ onSend, onReconnect, disabled, connected, passwordMode, skipHistory }, ref) => {
    const [value, setValue] = useState('');
    const [history, setHistory] = useState<string[]>([]);
    const [, setHistoryIndex] = useState(-1);
    const internalRef = useRef<HTMLTextAreaElement | null>(null);

    // Merge forwarded ref with internal ref
    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        internalRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      },
      [ref]
    );

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
          setHistory((prev) => [trimmed, ...prev].slice(0, MAX_HISTORY));
        }
      }
      setHistoryIndex(-1);
      setValue('');
    }, [value, onSend, passwordMode]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!connected) {
            onReconnect();
            return;
          }
          submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setValue('');
          setHistoryIndex(-1);
        } else if (e.key === 'ArrowUp' && !e.shiftKey) {
          // Navigate history only when cursor is on the first line
          const el = internalRef.current;
          if (el) {
            const before = value.substring(0, el.selectionStart);
            if (!before.includes('\n')) {
              e.preventDefault();
              setHistoryIndex((prev) => {
                const next = Math.min(prev + 1, history.length - 1);
                if (next >= 0 && history[next]) setValue(history[next]);
                return next;
              });
            }
          }
        } else if (e.key === 'ArrowDown' && !e.shiftKey) {
          // Navigate history only when cursor is on the last line
          const el = internalRef.current;
          if (el) {
            const after = value.substring(el.selectionStart);
            if (!after.includes('\n')) {
              e.preventDefault();
              setHistoryIndex((prev) => {
                const next = prev - 1;
                if (next < 0) {
                  setValue('');
                  return -1;
                }
                if (history[next]) setValue(history[next]);
                return next;
              });
            }
          }
        }
      },
      [submit, history, value]
    );

    const dotColor = connected ? '#22c55e' : '#ef4444';

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          padding: '6px 10px',
          background: '#0d0d0d',
          borderTop: '1px solid #1a1a1a',
          transition: 'border-color 0.3s ease',
        }}
      >
        {/* Prompt / line count */}
        <span
          style={{
            color: disabled ? '#2a2a2a' : '#50fa7b',
            fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            fontSize: '13px',
            padding: '5px 8px 0 4px',
            lineHeight: `${LINE_HEIGHT}px`,
            transition: 'color 0.3s ease',
            minWidth: isMultiLine ? '28px' : 'auto',
            textAlign: 'right',
          }}
        >
          {isMultiLine && <span style={{ color: '#6272a4' }}>{lineCount}</span>}
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
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '5px 0',
            color: '#e0e0e0',
            fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            fontSize: '14px',
            lineHeight: `${LINE_HEIGHT}px`,
            outline: 'none',
            caretColor: passwordMode ? '#a78bfa' : '#8be9fd',
            ...(passwordMode ? { WebkitTextSecurity: 'disc' } : {}),
            resize: 'none',
            overflow: 'hidden',
            minHeight: `${LINE_HEIGHT}px`,
            maxHeight: `${MAX_HEIGHT}px`,
          }}
        />

        {/* Separator + connection dot */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            paddingTop: '7px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: '1px',
              height: '16px',
              background: '#1e1e1e',
            }}
          />
          <div
            title={connected ? 'Connected to DartMUD' : 'Disconnected'}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: dotColor,
              boxShadow: `0 0 4px ${dotColor}88, 0 0 10px ${dotColor}44`,
              transition: 'background 0.4s ease, box-shadow 0.4s ease',
            }}
          />
        </div>
      </div>
    );
  }
);
