import { useEffect, useRef } from 'react';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { getStartupSplash } from '../lib/splash';
import type { DisplaySettings } from '../hooks/useThemeColors';

interface TerminalProps {
  terminalRef: React.MutableRefObject<XTerm | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  theme: ITheme;
  display: DisplaySettings;
  onUpdateDisplay: <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => void;
}

export function Terminal({ terminalRef, inputRef, theme, display, onUpdateDisplay }: TerminalProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!innerRef.current) return;

    const term = new XTerm({
      theme,
      fontFamily: `'${display.fontFamily}', monospace`,
      fontSize: display.fontSize,
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
        const next = Math.min((term.options.fontSize || 14) + 1, 28);
        term.options.fontSize = next;
        onUpdateDisplay('fontSize', next);
        fitAddon.fit();
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        const next = Math.max((term.options.fontSize || 14) - 1, 8);
        term.options.fontSize = next;
        onUpdateDisplay('fontSize', next);
        fitAddon.fit();
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        term.options.fontSize = 14;
        onUpdateDisplay('fontSize', 14);
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

  // Apply theme changes live
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme;
    }
  }, [theme, terminalRef]);

  // Apply display setting changes live
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = `'${display.fontFamily}', monospace`;
    term.options.fontSize = display.fontSize;
    fitAddonRef.current?.fit();
  }, [display.fontFamily, display.fontSize, terminalRef]);

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
      className="flex-1 bg-black px-4 py-3 overflow-hidden cursor-default"
    >
      <div ref={innerRef} className="w-full h-full overflow-hidden" />
    </div>
  );
}
