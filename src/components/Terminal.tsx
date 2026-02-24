import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { getStartupSplash } from '../lib/splash';
import type { DisplaySettings } from '../hooks/useThemeColors';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';

interface TerminalProps {
  terminalRef: React.MutableRefObject<XTerm | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  theme: ITheme;
  display: DisplaySettings;
  onUpdateDisplay: <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => void;
  onAddToTrigger?: (selectedText: string) => void;
  onGagLine?: (selectedText: string) => void;
  onOpenInNotes?: (text: string) => void;
}

interface CtxMenuState {
  x: number;
  y: number;
  selectedText: string;
  /** The line text under the right-click cursor */
  clickedLine: string;
}

function TerminalContextMenu({
  x,
  y,
  selectedText,
  clickedLine,
  onCopy,
  onCopyLine,
  onCopyVisible,
  onCopyAll,
  fontSize,
  onFontSize,
  onScrollToBottom,
  onClearTerminal,
  onSearch,
  onAddToTrigger,
  onGagLine,
  onOpenInNotes,
  onDismiss,
}: {
  x: number;
  y: number;
  selectedText: string;
  clickedLine: string;
  onCopy: () => void;
  onCopyLine: () => void;
  onCopyVisible: () => void;
  onCopyAll: () => void;
  fontSize: number;
  onFontSize: (delta: number) => void;
  onScrollToBottom: () => void;
  onClearTerminal: () => void;
  onSearch: () => void;
  onAddToTrigger?: (text: string) => void;
  onGagLine?: (text: string) => void;
  onOpenInNotes?: (text: string) => void;
  onDismiss: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp to viewport edges after first render
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 4);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 4);
    setPos({ x: Math.max(4, clampedX), y: Math.max(4, clampedY) });
  }, [x, y]);

  // Dismiss on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onDismiss]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  const hasSel = selectedText.length > 0;
  const itemClass = 'w-full px-3 py-1.5 text-[11px] text-left transition-colors cursor-pointer';
  const activeClass = `${itemClass} text-text-label hover:bg-bg-secondary/60`;
  const dimClass = `${itemClass} text-text-dim/40 cursor-default`;

  return (
    <div
      ref={menuRef}
      className="fixed bg-bg-primary border border-border rounded shadow-lg z-[200] py-1 min-w-[160px]"
      style={{ left: pos.x, top: pos.y }}
    >
      <button
        onClick={() => {
          if (hasSel) onCopy();
        }}
        className={hasSel ? activeClass : dimClass}
      >
        Copy Selected
      </button>
      <button
        onClick={() => {
          if (clickedLine) onCopyLine();
        }}
        className={clickedLine ? activeClass : dimClass}
      >
        Copy Line
      </button>
      <button onClick={onCopyVisible} className={activeClass}>
        Copy Visible
      </button>
      <button onClick={onCopyAll} className={activeClass}>
        Copy All
      </button>
      {(clickedLine || onOpenInNotes) && (onAddToTrigger || onGagLine || onOpenInNotes) && (
        <div className="h-px bg-border-dim mx-1.5 my-0.5" />
      )}
      {clickedLine && onAddToTrigger && (
        <button onClick={() => onAddToTrigger(clickedLine)} className={activeClass}>
          Add Line to Trigger
        </button>
      )}
      {clickedLine && onGagLine && (
        <button onClick={() => onGagLine(clickedLine)} className={activeClass}>
          Gag Line
        </button>
      )}
      {onOpenInNotes && (
        <button
          onClick={() => {
            if (hasSel) onOpenInNotes(selectedText);
          }}
          className={hasSel ? activeClass : dimClass}
        >
          Save Selected to Notes
        </button>
      )}
      <div className="h-px bg-border-dim mx-1.5 my-0.5" />
      <button onClick={onSearch} className={activeClass}>
        Search
      </button>
      <button onClick={onScrollToBottom} className={activeClass}>
        Scroll to Bottom
      </button>
      <button onClick={onClearTerminal} className={activeClass}>
        Clear Terminal
      </button>
      <div className="h-px bg-border-dim mx-1.5 my-0.5" />
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[11px] text-text-dim">Font</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onFontSize(-1)}
            disabled={fontSize <= 8}
            className="w-[20px] h-[20px] flex items-center justify-center rounded text-[11px] font-mono text-text-label hover:bg-bg-secondary/60 cursor-pointer disabled:text-text-dim/30 disabled:cursor-default transition-colors"
            title="Decrease font size (Ctrl+-)"
          >
            -
          </button>
          <span className="text-[11px] font-mono text-text-label w-[20px] text-center tabular-nums">
            {fontSize}
          </span>
          <button
            onClick={() => onFontSize(1)}
            disabled={fontSize >= 28}
            className="w-[20px] h-[20px] flex items-center justify-center rounded text-[11px] font-mono text-text-label hover:bg-bg-secondary/60 cursor-pointer disabled:text-text-dim/30 disabled:cursor-default transition-colors"
            title="Increase font size (Ctrl++)"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export function Terminal({
  terminalRef,
  inputRef,
  theme,
  display,
  onUpdateDisplay,
  onAddToTrigger,
  onGagLine,
  onOpenInNotes,
}: TerminalProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { terminalScrollback } = useAppSettingsContext();

  useEffect(() => {
    if (!innerRef.current) return;

    const term = new XTerm({
      theme,
      fontFamily: `'${display.fontFamily}', monospace`,
      fontSize: display.fontSize,
      scrollback: terminalScrollback,
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
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
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setSearchOpen((prev) => {
          if (prev) {
            setSearchQuery('');
            searchAddonRef.current?.clearDecorations();
            inputRef.current?.focus();
            return false;
          }
          return true;
        });
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
    searchAddonRef.current = searchAddon;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    observer.observe(innerRef.current);

    // Right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const sel = term.getSelection();
      // Determine which terminal row was clicked
      let clickedLine = '';
      const screenEl = (term.element ?? innerRef.current)?.querySelector(
        '.xterm-screen'
      ) as HTMLElement | null;
      if (screenEl) {
        const rect = screenEl.getBoundingClientRect();
        const cellHeight = rect.height / term.rows;
        const row = Math.max(
          0,
          Math.min(term.rows - 1, Math.floor((e.clientY - rect.top) / cellHeight))
        );
        const buf = term.buffer.active;
        const line = buf.getLine(buf.viewportY + row);
        if (line) clickedLine = line.translateToString(true).trimEnd();
      }
      setCtxMenu({ x: e.clientX, y: e.clientY, selectedText: sel, clickedLine });
    };
    innerRef.current.addEventListener('contextmenu', handleContextMenu);

    // Track whether user has scrolled up from the bottom
    const checkScrollPosition = () => {
      const buffer = term.buffer.active;
      setIsScrolledUp(buffer.baseY - buffer.viewportY > 0);
    };
    const scrollDisposable = term.onScroll(checkScrollPosition);
    const writeDisposable = term.onWriteParsed(checkScrollPosition);

    const innerEl = innerRef.current;
    return () => {
      window.removeEventListener('keydown', handleKeyboard);
      innerEl?.removeEventListener('contextmenu', handleContextMenu);
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

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    searchAddonRef.current?.clearDecorations();
    inputRef.current?.focus();
  }, [inputRef]);

  const searchNext = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findNext(searchQuery);
  }, [searchQuery]);

  const searchPrev = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findPrevious(searchQuery);
  }, [searchQuery]);

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

      {/* Search bar */}
      {searchOpen && (
        <div className="absolute top-2 right-4 z-20 flex items-center gap-1 bg-bg-primary border border-border rounded shadow-lg px-2 py-1">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) searchAddonRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) searchPrev();
                else searchNext();
              }
              if (e.key === 'Escape') closeSearch();
            }}
            placeholder="Search..."
            className="bg-transparent border-none outline-none text-[11px] text-text-primary w-[160px] placeholder:text-text-dim/50"
          />
          <button
            onClick={searchPrev}
            className="w-[20px] h-[20px] flex items-center justify-center rounded text-text-dim hover:text-text-label hover:bg-bg-secondary/60 cursor-pointer transition-colors text-[10px]"
            title="Previous (Shift+Enter)"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            onClick={searchNext}
            className="w-[20px] h-[20px] flex items-center justify-center rounded text-text-dim hover:text-text-label hover:bg-bg-secondary/60 cursor-pointer transition-colors text-[10px]"
            title="Next (Enter)"
          >
            <svg
              width="10"
              height="10"
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
          <button
            onClick={closeSearch}
            className="w-[20px] h-[20px] flex items-center justify-center rounded text-text-dim hover:text-text-label hover:bg-bg-secondary/60 cursor-pointer transition-colors text-[11px]"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <TerminalContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          selectedText={ctxMenu.selectedText}
          clickedLine={ctxMenu.clickedLine}
          onCopy={() => {
            if (ctxMenu.selectedText) {
              navigator.clipboard.writeText(ctxMenu.selectedText);
            }
            setCtxMenu(null);
          }}
          onCopyLine={() => {
            if (ctxMenu.clickedLine) {
              navigator.clipboard.writeText(ctxMenu.clickedLine);
            }
            setCtxMenu(null);
          }}
          onCopyVisible={() => {
            const term = terminalRef.current;
            if (term) {
              const buf = term.buffer.active;
              const lines: string[] = [];
              for (let i = 0; i < term.rows; i++) {
                const line = buf.getLine(buf.viewportY + i);
                if (line) lines.push(line.translateToString(true));
              }
              while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
              navigator.clipboard.writeText(lines.join('\n'));
            }
            setCtxMenu(null);
          }}
          onCopyAll={() => {
            const term = terminalRef.current;
            if (term) {
              const buf = term.buffer.active;
              const totalRows = buf.baseY + term.rows;
              const lines: string[] = [];
              for (let i = 0; i < totalRows; i++) {
                const line = buf.getLine(i);
                if (line) lines.push(line.translateToString(true));
              }
              while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
              navigator.clipboard.writeText(lines.join('\n'));
            }
            setCtxMenu(null);
          }}
          onAddToTrigger={
            onAddToTrigger
              ? (text) => {
                  onAddToTrigger(text);
                  setCtxMenu(null);
                }
              : undefined
          }
          onGagLine={
            onGagLine
              ? (text) => {
                  onGagLine(text);
                  setCtxMenu(null);
                }
              : undefined
          }
          onOpenInNotes={
            onOpenInNotes
              ? (text) => {
                  onOpenInNotes(text);
                  setCtxMenu(null);
                }
              : undefined
          }
          onScrollToBottom={() => {
            terminalRef.current?.scrollToBottom();
            setCtxMenu(null);
          }}
          onClearTerminal={() => {
            terminalRef.current?.clear();
            setCtxMenu(null);
          }}
          onSearch={() => {
            setCtxMenu(null);
            setSearchOpen(true);
          }}
          fontSize={display.fontSize}
          onFontSize={(delta) => {
            const term = terminalRef.current;
            if (!term) return;
            const next = Math.max(8, Math.min(28, (term.options.fontSize || 14) + delta));
            term.options.fontSize = next;
            onUpdateDisplay('fontSize', next);
            fitAddonRef.current?.fit();
          }}
          onDismiss={() => setCtxMenu(null)}
        />
      )}

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
