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
          if (!connected && value.trim() === '') {
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

    return (
      <div className="flex items-start px-2.5 py-1.5 border-t border-border-subtle transition-[border-color] duration-300 ease-in-out">
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
      </div>
    );
  }
);
