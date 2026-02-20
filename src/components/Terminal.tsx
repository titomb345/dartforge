import { useEffect, useRef, useState } from 'react';
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
  const [isScrolledUp, setIsScrolledUp] = useState(false);

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

    // Preserve terminal selection text when data arrives (writes can clear it)
    let lastSelection = '';
    const selDisposable = term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) lastSelection = sel;
    });

    // Ctrl+C to copy terminal selection
    const handleKeyboard = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c') {
        const sel = term.getSelection() || lastSelection;
        if (sel) {
          navigator.clipboard.writeText(sel);
          term.clearSelection();
          lastSelection = '';
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

    // Track whether user has scrolled up from the bottom
    const checkScrollPosition = () => {
      const buffer = term.buffer.active;
      setIsScrolledUp(buffer.baseY - buffer.viewportY > 0);
    };
    const scrollDisposable = term.onScroll(checkScrollPosition);
    const writeDisposable = term.onWriteParsed(checkScrollPosition);

    return () => {
      window.removeEventListener('keydown', handleKeyboard);
      observer.disconnect();
      selDisposable.dispose();
      scrollDisposable.dispose();
      writeDisposable.dispose();
      term.dispose();
      terminalRef.current = null;
    };
  }, [terminalRef]); // eslint-disable-line react-hooks/exhaustive-deps

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
      className="relative flex-1 bg-black px-4 py-3 overflow-hidden cursor-default"
    >
      <div ref={innerRef} className="w-full h-full overflow-hidden" />

      {/* Scroll-to-bottom indicator */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          terminalRef.current?.scrollToBottom();
        }}
        className={`absolute bottom-4 right-8 z-10 flex items-center justify-center
          w-8 h-8 rounded-full
          bg-zinc-700/70 backdrop-blur-sm border border-zinc-600/40
          text-zinc-400 hover:text-zinc-100 hover:bg-zinc-600/80
          transition-all duration-200 ease-out cursor-pointer
          ${isScrolledUp ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
        title="Scroll to bottom"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}
