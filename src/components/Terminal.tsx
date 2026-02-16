import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { getStartupSplash } from '../lib/splash';

interface TerminalProps {
  terminalRef: React.MutableRefObject<XTerm | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function Terminal({ terminalRef, inputRef }: TerminalProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!innerRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#000000',
        foreground: '#e0e0e0',
        cursor: '#000000',
        cursorAccent: '#000000',
        selectionBackground: '#444',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontSize: 14,
      scrollback: 10000,
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(innerRef.current);

    // Hide cursor but keep helper textarea functional for clipboard
    const style = document.createElement('style');
    style.textContent = `
      .xterm-cursor-layer { display: none !important; }
      .xterm-helper-textarea { opacity: 0; position: absolute; pointer-events: none; }
      .xterm .xterm-cursor { display: none !important; }
      .xterm .xterm-cursor-block { display: none !important; }
      .xterm .xterm-cursor-outline { display: none !important; }
      .xterm .xterm-cursor-bar { display: none !important; }
      .xterm .xterm-cursor-underline { display: none !important; }
    `;
    innerRef.current.appendChild(style);

    // Initial fit + startup splash
    requestAnimationFrame(() => {
      fitAddon.fit();
      term.write(getStartupSplash(term.cols));
    });

    // Ctrl+C to copy terminal selection
    const handleKeyboard = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel);
          term.clearSelection();
        }
        return;
      }
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        term.options.fontSize = Math.min((term.options.fontSize || 14) + 1, 28);
        fitAddon.fit();
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        term.options.fontSize = Math.max((term.options.fontSize || 14) - 1, 8);
        fitAddon.fit();
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        term.options.fontSize = 14;
        fitAddon.fit();
      }
    };
    window.addEventListener('keydown', handleKeyboard);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    observer.observe(innerRef.current);

    return () => {
      window.removeEventListener('keydown', handleKeyboard);
      observer.disconnect();
      term.dispose();
      terminalRef.current = null;
    };
  }, [terminalRef, inputRef]);

  // Click terminal → focus command input (but not if selecting text)
  const handleClick = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    inputRef.current?.focus();
  };

  return (
    <div
      ref={outerRef}
      onClick={handleClick}
      style={{
        flex: 1,
        background: '#000000',
        padding: '12px 16px',
        overflow: 'hidden',
        cursor: 'default',
      }}
    >
      <div
        ref={innerRef}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
