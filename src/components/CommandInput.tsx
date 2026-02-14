import { useState, useRef, useCallback, KeyboardEvent } from 'react';

interface CommandInputProps {
  onSend: (command: string) => void;
  disabled: boolean;
}

const MAX_HISTORY = 100;

export function CommandInput({ onSend, disabled }: CommandInputProps) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed === '') {
      // Send empty line (some MUDs use this)
      onSend('');
      return;
    }
    onSend(trimmed);
    setHistory((prev) => {
      const next = [trimmed, ...prev];
      return next.slice(0, MAX_HISTORY);
    });
    setHistoryIndex(-1);
    setValue('');
  }, [value, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHistoryIndex((prev) => {
          const next = Math.min(prev + 1, history.length - 1);
          if (next >= 0 && history[next]) {
            setValue(history[next]);
          }
          return next;
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHistoryIndex((prev) => {
          const next = prev - 1;
          if (next < 0) {
            setValue('');
            return -1;
          }
          if (history[next]) {
            setValue(history[next]);
          }
          return next;
        });
      }
    },
    [submit, history]
  );

  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        padding: '8px 12px',
        background: '#1a1a1a',
        borderTop: '1px solid #333',
      }}
    >
      <span style={{ color: '#555', lineHeight: '32px' }}>&gt;</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoFocus
        placeholder={disabled ? 'Disconnected...' : 'Enter command...'}
        style={{
          flex: 1,
          background: '#0d0d0d',
          border: '1px solid #333',
          borderRadius: '4px',
          padding: '6px 10px',
          color: '#e0e0e0',
          fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          fontSize: '14px',
          outline: 'none',
        }}
      />
      <button
        onClick={submit}
        disabled={disabled}
        style={{
          padding: '6px 16px',
          background: disabled ? '#333' : '#2563eb',
          color: disabled ? '#666' : '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        Send
      </button>
    </div>
  );
}
