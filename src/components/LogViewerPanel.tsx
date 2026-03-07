import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FilterPill } from './FilterPill';
import { LogIcon, SearchIcon } from './icons';
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

// New format: user commands logged as ">> command"
const CMD_RE = /^\[.*?\] >> /;
// Legacy format: old logs used "> " for both commands and server echoes
const LEGACY_CMD_RE = /^\[.*?\] > \S/;
const TS_RE = /^\[(.*?)\]/;
const CONTENT_RE = /^\[.*?\]\s*/;
// Bare server prompts: "[timestamp] > " with nothing after, or "> text" from server echo
const BARE_PROMPT_RE = /^\[.*?\] >\s*$/;

function isCommandLine(line: string): boolean {
  return CMD_RE.test(line);
}

function isLegacyCommandLine(line: string): boolean {
  return LEGACY_CMD_RE.test(line) && !CMD_RE.test(line);
}

function getLineContent(line: string): string {
  const stripped = line.replace(CONTENT_RE, '');
  // Strip the >> or > prefix for display
  if (stripped.startsWith('>> ')) return stripped.slice(3);
  if (stripped.startsWith('> ')) return stripped.slice(2);
  return stripped;
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

function formatFileDateLong(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ── Main Modal ────────────────────────────────────────────── */

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

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<SessionLogEntry[]>('list_session_logs').then(setSessions).catch(console.error);
  }, []);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

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
      loadSession(filename);
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

  const filteredLines = useMemo(
    () =>
      filter === 'all'
        ? lines.filter((l) => !BARE_PROMPT_RE.test(l))
        : lines.filter((l) => {
            if (BARE_PROMPT_RE.test(l)) return false;
            const isCmd = isCommandLine(l);
            return filter === 'commands' ? isCmd : !isCmd;
          }),
    [lines, filter]
  );

  const selectedEntry = useMemo(
    () => sessions.find((s) => s.filename === selected),
    [sessions, selected]
  );

  const commandCount = useMemo(
    () => lines.filter((l) => isCommandLine(l)).length,
    [lines]
  );

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#030305]/90 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal container */}
      <div
        className="relative flex w-[94vw] h-[88vh] max-w-[1400px] rounded-lg overflow-hidden border border-[#1a1a22] shadow-2xl"
        style={{
          background: 'linear-gradient(165deg, #0c0c12 0%, #09090e 50%, #0a0a10 100%)',
        }}
      >
        {/* ── Left sidebar: session list ── */}
        <div className="w-[220px] shrink-0 flex flex-col border-r border-[#141420]">
          {/* Sidebar header */}
          <div className="px-3 py-3 border-b border-[#141420]">
            <div className="flex items-center gap-2 mb-2">
              <LogIcon size={13} />
              <span className="text-[11px] font-semibold tracking-wide text-[#8b8b9e] uppercase">
                Sessions
              </span>
              <span className="ml-auto text-[9px] font-mono text-[#44445a] tabular-nums">
                {sessions.length}
              </span>
            </div>
            {/* Search */}
            <div className="flex items-center gap-1">
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
                  'px-1 py-px text-[9px] font-mono rounded border cursor-pointer transition-colors duration-150 leading-tight shrink-0',
                  isRegex
                    ? 'bg-cyan/15 border-cyan/40 text-cyan'
                    : 'bg-transparent border-[#1e1e2e] text-[#44445a] hover:text-[#66668a]'
                )}
              >
                .*
              </button>
              <button
                onClick={runSearch}
                disabled={searching || !query.trim()}
                title="Search"
                className="flex items-center justify-center w-[18px] h-[18px] rounded cursor-pointer text-[#44445a] hover:text-[#8b8b9e] transition-colors duration-150 disabled:opacity-30 disabled:cursor-default shrink-0"
              >
                <SearchIcon />
              </button>
            </div>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="px-3 py-6 text-[10px] text-[#33334a] text-center">
                No session logs found
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.filename}
                  className={cn(
                    'group flex items-center gap-1.5 px-3 py-[6px] cursor-pointer transition-colors duration-100 border-l-2',
                    s.filename === selected
                      ? 'bg-cyan/5 border-l-cyan text-cyan'
                      : 'border-l-transparent hover:bg-[#0e0e16] text-[#7a7a90]'
                  )}
                >
                  <button
                    onClick={() => selectSession(s.filename)}
                    className="flex-1 text-left min-w-0 cursor-pointer bg-transparent border-none p-0"
                  >
                    <span className="text-[10px] font-mono block truncate">
                      {formatFileDate(s.modified)}
                    </span>
                    <span className="text-[8px] text-[#3a3a50] block font-mono">
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
        </div>

        {/* ── Main content area ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#141420] shrink-0">
            {selectedEntry ? (
              <>
                <span className="text-[11px] font-mono text-[#9090a8]">
                  {formatFileDateLong(selectedEntry.modified)}
                </span>
                <span className="text-[9px] font-mono text-[#33334a]">
                  {formatFileSize(selectedEntry.size)}
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <FilterPill
                    label="All"
                    active={filter === 'all'}
                    onClick={() => setFilter('all')}
                  />
                  <FilterPill
                    label={`Commands${commandCount > 0 ? ` (${commandCount})` : ''}`}
                    active={filter === 'commands'}
                    accent="cyan"
                    onClick={() => setFilter('commands')}
                  />
                  <FilterPill
                    label="Output"
                    active={filter === 'output'}
                    accent="green"
                    onClick={() => setFilter('output')}
                  />
                </div>
              </>
            ) : results ? (
              <>
                <span className="text-[11px] font-mono text-[#9090a8]">
                  {results.total_matches} match{results.total_matches !== 1 && 'es'}
                  {results.truncated && ` (showing ${results.matches.length})`}
                </span>
                <div className="flex-1" />
                <button
                  onClick={clearSearch}
                  className="text-[10px] text-[#44445a] hover:text-[#8b8b9e] cursor-pointer bg-transparent border-none transition-colors duration-150 font-mono"
                >
                  clear
                </button>
              </>
            ) : (
              <div className="flex-1" />
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              className="ml-2 flex items-center justify-center w-6 h-6 rounded cursor-pointer text-[#44445a] hover:text-[#9090a8] hover:bg-[#141420] transition-colors duration-150"
              title="Close (Esc)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Content */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {/* Searching state */}
            {searching && (
              <div className="flex items-center justify-center py-16 text-[11px] text-[#44445a]">
                Searching...
              </div>
            )}

            {/* Search results */}
            {!searching && results && (
              <div className="p-4 space-y-2">
                {results.matches.length === 0 ? (
                  <div className="text-center py-12 text-[11px] text-[#33334a]">
                    No matches found
                  </div>
                ) : (
                  results.matches.map((m, i) => (
                    <MatchCard
                      key={`${m.filename}-${m.line_number}-${i}`}
                      match={m}
                      query={query}
                      isRegex={isRegex}
                      onOpen={(f) => selectSession(f)}
                    />
                  ))
                )}
              </div>
            )}

            {/* Session view */}
            {!searching && !results && selected && (
              <div className="font-mono text-[11px] leading-[18px]">
                {filteredLines.length === 0 && !loading && (
                  <div className="text-center py-12 text-[11px] text-[#33334a]">
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
                    className="w-full py-2 text-[10px] text-cyan/60 hover:text-cyan cursor-pointer bg-transparent border-none transition-colors duration-150 disabled:opacity-30 disabled:cursor-default font-mono"
                  >
                    {loading ? 'Loading...' : `Load more (${totalLines - lines.length} remaining)`}
                  </button>
                )}
                {!hasMore && lines.length > 0 && (
                  <div className="text-center py-2 text-[9px] text-[#2a2a3e] font-mono">
                    {totalLines} lines total
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {!searching && !results && !selected && (
              <div className="flex flex-col items-center justify-center h-full text-[#2a2a3e] gap-3">
                <LogIcon size={28} />
                <span className="text-[11px]">Select a session to view</span>
                <span className="text-[9px] text-[#1e1e30]">
                  or search across all logs
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Log Line ───────────────────────────────────────────────── */

function LogLine({ line }: { line: string }) {
  const isCmd = isCommandLine(line);
  const isLegacy = !isCmd && isLegacyCommandLine(line);
  const tsMatch = line.match(TS_RE);
  const ts = tsMatch ? tsMatch[1] : '';
  const content = getLineContent(line);

  // Skip rendering completely empty content lines
  if (!content.trim() && !isCmd) return null;

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-0 min-w-0 group hover:bg-[#0c0c16]/50',
        isCmd && 'bg-cyan/[0.03]'
      )}
    >
      {/* Timestamp gutter */}
      <span className="text-[#2a2a3e] shrink-0 select-none text-[10px] tabular-nums w-[150px] leading-[18px] group-hover:text-[#3a3a50] transition-colors">
        {ts}
      </span>

      {/* Command indicator */}
      <span className="w-[14px] shrink-0 text-[10px] leading-[18px] select-none">
        {isCmd ? (
          <span className="text-cyan font-bold">&gt;&gt;</span>
        ) : isLegacy ? (
          <span className="text-[#4a4a60]">&gt;</span>
        ) : null}
      </span>

      {/* Content — preserve whitespace */}
      <span
        className={cn(
          'min-w-0 whitespace-pre-wrap leading-[18px]',
          isCmd ? 'text-cyan font-medium' : 'text-[#b0b0c0]'
        )}
      >
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
  const label = m.filename
    .replace('session_', '')
    .replace('.log', '')
    .replace(/T(\d{2})-(\d{2}).*/, ' $1:$2');

  return (
    <div className="rounded border border-[#1a1a24] overflow-hidden hover:border-[#252535] transition-colors duration-150 bg-[#0a0a12]">
      <button
        onClick={() => onOpen(m.filename)}
        className="w-full flex items-center justify-between px-3 py-1 text-[10px] font-mono text-[#55556a] hover:text-cyan cursor-pointer bg-[#0c0c14] border-none border-b border-b-[#1a1a24] transition-colors duration-100"
      >
        <span className="truncate">{label}</span>
        <span className="text-[9px] shrink-0 ml-2 tabular-nums text-[#33334a]">
          line {m.line_number}
        </span>
      </button>
      <div className="px-3 py-1.5 font-mono text-[11px] leading-[17px] whitespace-pre-wrap">
        {m.context_before.map((l, i) => (
          <div key={`b${i}`} className="text-[#33334a]">
            {l}
          </div>
        ))}
        <div className={cn(isCommandLine(m.line) ? 'text-cyan' : 'text-[#b0b0c0]')}>
          <Highlight line={m.line} query={query} isRegex={isRegex} />
        </div>
        {m.context_after.map((l, i) => (
          <div key={`a${i}`} className="text-[#33334a]">
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
            <span key={i} className="bg-amber/20 text-amber rounded-sm px-px">
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
