import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PanelHeader } from './PanelHeader';
import { FilterPill } from './FilterPill';
import { LogIcon, SearchIcon, ChevronDownIcon } from './icons';
import { MudInput } from './shared';
import { cn } from '../lib/cn';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';

/* ── Types ──────────────────────────────────────────────────── */

interface SessionLogEntry {
  filename: string;
  size: number;
  modified: string;
}

interface SessionLogPage {
  lines: string[];
  total_lines: number;
  has_more: boolean;
}

interface SearchMatch {
  filename: string;
  line_number: number;
  line: string;
  context_before: string[];
  context_after: string[];
}

interface SearchResult {
  matches: SearchMatch[];
  total_matches: number;
  truncated: boolean;
}

type LineFilter = 'all' | 'commands' | 'output';

/* ── Helpers ────────────────────────────────────────────────── */

const PAGE_SIZE = 500;

const CMD_RE = /^\[.*?\] > /;
const TS_RE = /^\[(.*?)\]/;
const CONTENT_RE = /^\[.*?\]\s*/;

function isCommandLine(line: string): boolean {
  return CMD_RE.test(line);
}

function formatFileDate(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const yesterday = `${yest.getFullYear()}-${yest.getMonth()}-${yest.getDate()}`;
  const dKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (dKey === today) return `Today ${time}`;
  if (dKey === yesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ── Main Panel ─────────────────────────────────────────────── */

interface LogViewerPanelProps {
  onClose: () => void;
}

export function LogViewerPanel({ onClose }: LogViewerPanelProps) {
  const [sessions, setSessions] = useState<SessionLogEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [totalLines, setTotalLines] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const [filter, setFilter] = useState<LineFilter>('all');
  const [open, setOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<SessionLogEntry[]>('list_session_logs').then(setSessions).catch(console.error);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const loadSession = useCallback(async (filename: string, offset = 0) => {
    setLoading(true);
    try {
      const page = await invoke<SessionLogPage>('read_session_log', {
        filename,
        offset,
        limit: PAGE_SIZE,
      });
      setLines((prev) => (offset === 0 ? page.lines : [...prev, ...page.lines]));
      setTotalLines(page.total_lines);
      setHasMore(page.has_more);
    } catch (e) {
      console.error('Failed to load session log:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectSession = useCallback(
    (filename: string) => {
      setSelected(filename);
      setResults(null);
      setQuery('');
      setFilter('all');
      setOpen(false);
      loadSession(filename);
      // Scroll to top on new session
      scrollRef.current?.scrollTo(0, 0);
    },
    [loadSession]
  );

  const loadMore = useCallback(() => {
    if (selected && hasMore && !loading) loadSession(selected, lines.length);
  }, [selected, hasMore, loading, lines.length, loadSession]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const r = await invoke<SearchResult>('search_session_logs', {
        query: q,
        isRegex,
        contextLines: 2,
        maxResults: 200,
      });
      setResults(r);
      setSelected(null);
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [query, isRegex]);

  const clearSearch = useCallback(() => {
    setResults(null);
    setQuery('');
  }, []);

  const deleteSession = useCallback(
    async (filename: string) => {
      try {
        await invoke('delete_session_log', { filename });
        setSessions((prev) => prev.filter((s) => s.filename !== filename));
        if (selected === filename) {
          setSelected(null);
          setLines([]);
        }
      } catch (e) {
        console.error('Failed to delete session log:', e);
      }
    },
    [selected]
  );

  const refreshSessions = useCallback(() => {
    invoke<SessionLogEntry[]>('list_session_logs').then(setSessions).catch(console.error);
  }, []);

  const filteredLines = useMemo(
    () =>
      filter === 'all'
        ? lines
        : lines.filter((l) => (filter === 'commands' ? isCommandLine(l) : !isCommandLine(l))),
    [lines, filter]
  );

  const selectedEntry = useMemo(
    () => sessions.find((s) => s.filename === selected),
    [sessions, selected]
  );

  return (
    <div className="w-[400px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden">
      <PanelHeader icon={<LogIcon />} title="Session Logs" onClose={onClose}>
        <div className="flex items-center gap-1 flex-1">
          <MudInput
            placeholder="Search all logs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            size="sm"
            className="flex-1 min-w-0"
          />
          <button
            onClick={() => setIsRegex(!isRegex)}
            title="Regex mode"
            className={cn(
              'px-1 py-px text-[9px] font-mono rounded border cursor-pointer transition-colors duration-150 leading-tight',
              isRegex
                ? 'bg-cyan/15 border-cyan/40 text-cyan'
                : 'bg-transparent border-border-dim text-text-dim hover:text-text-label'
            )}
          >
            .*
          </button>
          <button
            onClick={runSearch}
            disabled={searching || !query.trim()}
            title="Search"
            className="flex items-center justify-center w-[18px] h-[18px] rounded cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150 disabled:opacity-30 disabled:cursor-default"
          >
            <SearchIcon />
          </button>
        </div>
      </PanelHeader>

      {/* Session selector + filters */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border-subtle shrink-0">
        <div className="relative flex-1 min-w-0" ref={ddRef}>
          <button
            onClick={() => {
              if (!open) refreshSessions();
              setOpen(!open);
            }}
            className="w-full flex items-center justify-between gap-1 px-1.5 py-[3px] text-[10px] font-mono bg-bg-input border border-border-dim rounded text-text-primary cursor-pointer hover:border-border-subtle transition-colors duration-150 leading-tight"
          >
            <span className="truncate">
              {selectedEntry ? formatFileDate(selectedEntry.modified) : 'Select session...'}
            </span>
            <ChevronDownIcon size={7} />
          </button>
          {open && (
            <div className="absolute top-full left-0 right-0 mt-px bg-bg-secondary border border-border-subtle rounded shadow-lg z-50 max-h-[260px] overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="px-2 py-2 text-[10px] text-text-dim text-center">
                  No session logs found
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.filename}
                    className={cn(
                      'group flex items-center gap-1 px-1.5 py-1 cursor-pointer transition-colors duration-100',
                      s.filename === selected
                        ? 'bg-cyan/8 text-cyan'
                        : 'hover:bg-bg-secondary text-text-primary'
                    )}
                  >
                    <button
                      onClick={() => selectSession(s.filename)}
                      className="flex-1 text-left min-w-0 cursor-pointer bg-transparent border-none p-0"
                    >
                      <span className="text-[10px] font-mono block truncate">
                        {formatFileDate(s.modified)}
                      </span>
                      <span className="text-[8px] text-text-dim block">
                        {formatFileSize(s.size)}
                      </span>
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <ConfirmDeleteButton
                        onDelete={() => deleteSession(s.filename)}
                        title="Delete log"
                        size={8}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <FilterPill label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterPill
          label="Cmds"
          active={filter === 'commands'}
          accent="purple"
          onClick={() => setFilter('commands')}
        />
        <FilterPill
          label="Out"
          active={filter === 'output'}
          accent="green"
          onClick={() => setFilter('output')}
        />
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Searching state */}
        {searching && (
          <div className="flex items-center justify-center py-8 text-[10px] text-text-dim">
            Searching...
          </div>
        )}

        {/* Search results */}
        {!searching && results && (
          <div className="px-1 py-1">
            <div className="flex items-center justify-between px-1 py-0.5 mb-1">
              <span className="text-[9px] text-text-dim font-mono">
                {results.total_matches} match{results.total_matches !== 1 && 'es'}
                {results.truncated && ` (showing ${results.matches.length})`}
              </span>
              <button
                onClick={clearSearch}
                className="text-[9px] text-text-dim hover:text-text-label cursor-pointer bg-transparent border-none transition-colors duration-150"
              >
                clear
              </button>
            </div>
            {results.matches.length === 0 ? (
              <div className="text-center py-6 text-[10px] text-text-dim">No matches</div>
            ) : (
              <div className="space-y-px">
                {results.matches.map((m, i) => (
                  <MatchCard
                    key={`${m.filename}-${m.line_number}-${i}`}
                    match={m}
                    query={query}
                    isRegex={isRegex}
                    onOpen={(f) => selectSession(f)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Session view */}
        {!searching && !results && selected && (
          <>
            {filteredLines.length === 0 && !loading && (
              <div className="text-center py-6 text-[10px] text-text-dim">
                {filter !== 'all' ? 'No matching lines' : 'Empty session'}
              </div>
            )}
            {filteredLines.map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
            {hasMore && filter === 'all' && (
              <button
                onClick={loadMore}
                disabled={loading}
                className="w-full py-1.5 text-[10px] text-cyan/70 hover:text-cyan cursor-pointer bg-transparent border-none transition-colors duration-150 disabled:opacity-30 disabled:cursor-default"
              >
                {loading ? 'Loading...' : `Load more (${totalLines - lines.length})`}
              </button>
            )}
            {!hasMore && lines.length > 0 && (
              <div className="text-center py-1 text-[8px] text-text-dim font-mono">
                {totalLines} lines
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!searching && !results && !selected && (
          <div className="flex flex-col items-center justify-center h-full text-text-dim gap-1.5 opacity-40">
            <LogIcon size={20} />
            <span className="text-[10px]">Select a session or search</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Log Line ───────────────────────────────────────────────── */

function LogLine({ line }: { line: string }) {
  const isCmd = isCommandLine(line);
  const tsMatch = line.match(TS_RE);
  const ts = tsMatch ? tsMatch[1] : '';
  const content = line.replace(CONTENT_RE, '');

  return (
    <div
      className={cn(
        'flex gap-1 px-2 py-px font-mono text-[10px] leading-[16px] min-w-0',
        isCmd && 'bg-cyan/4'
      )}
    >
      {ts && (
        <span className="text-text-dim shrink-0 select-none text-[9px] tabular-nums w-[120px]">
          {ts}
        </span>
      )}
      <span className={cn('min-w-0 break-words', isCmd ? 'text-cyan' : 'text-text-primary')}>
        {content}
      </span>
    </div>
  );
}

/* ── Search Match Card ──────────────────────────────────────── */

function MatchCard({
  match: m,
  query,
  isRegex,
  onOpen,
}: {
  match: SearchMatch;
  query: string;
  isRegex: boolean;
  onOpen: (filename: string) => void;
}) {
  // Parse session date from filename: session_2026-03-05T14-30-00-000.log
  const label = m.filename
    .replace('session_', '')
    .replace('.log', '')
    .replace(/T(\d{2})-(\d{2}).*/, ' $1:$2');

  return (
    <div className="rounded border border-border-dim overflow-hidden hover:border-border-subtle transition-colors duration-150">
      <button
        onClick={() => onOpen(m.filename)}
        className="w-full flex items-center justify-between px-1.5 py-[2px] text-[9px] font-mono text-text-dim hover:text-cyan cursor-pointer bg-bg-secondary/40 border-none border-b border-b-border-dim transition-colors duration-100"
      >
        <span className="truncate">{label}</span>
        <span className="text-[8px] shrink-0 ml-1 tabular-nums">:{m.line_number}</span>
      </button>
      <div className="px-1.5 py-0.5 font-mono text-[10px] leading-[15px]">
        {m.context_before.map((l, i) => (
          <div key={`b${i}`} className="text-text-dim/60 truncate">
            {l}
          </div>
        ))}
        <div className={cn('truncate', isCommandLine(m.line) ? 'text-cyan' : 'text-text-primary')}>
          <Highlight line={m.line} query={query} isRegex={isRegex} />
        </div>
        {m.context_after.map((l, i) => (
          <div key={`a${i}`} className="text-text-dim/60 truncate">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Text Highlight ─────────────────────────────────────────── */

function Highlight({
  line,
  query,
  isRegex,
}: {
  line: string;
  query: string;
  isRegex: boolean;
}) {
  if (!query) return <>{line}</>;
  try {
    const pat = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const splitRe = new RegExp(`(${pat})`, 'gi');
    const testRe = new RegExp(`^${pat}$`, 'i');
    const parts = line.split(splitRe);
    return (
      <>
        {parts.map((p, i) =>
          testRe.test(p) ? (
            <span key={i} className="bg-amber/25 text-amber">
              {p}
            </span>
          ) : (
            <span key={i}>{p}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{line}</>;
  }
}
