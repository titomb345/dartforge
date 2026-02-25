import { useState, useEffect, useRef } from 'react';
import type { PinnablePanelProps } from '../types';
import type { ThemeColorKey } from '../lib/defaultTheme';
import type { WhoPlayer } from '../lib/whoPatterns';
import type { WhoTitleMapping } from '../types/whoTitleMap';
import { panelRootClass } from '../lib/panelUtils';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';
import { WhoIcon, RotateCcwIcon } from './icons';
import { MudInput } from './shared';
import { useWhoContext } from '../contexts/WhoContext';
import { useWhoTitleContext } from '../contexts/WhoTitleContext';
import { useTerminalTheme } from '../contexts/TerminalThemeContext';

interface GuildStyle {
  color: ThemeColorKey;
  bg?: ThemeColorKey;
  bracketColor?: ThemeColorKey;
}

const GUILD_STYLES: Record<string, GuildStyle> = {
  BH: { color: 'brightYellow', bracketColor: 'magenta' },
  DG: { color: 'brightYellow', bracketColor: 'brightBlue' },
  DK: { color: 'white', bg: 'blue', bracketColor: 'white' },
  HG: { color: 'black', bg: 'white', bracketColor: 'black' },
  MG: { color: 'brightCyan', bracketColor: 'white' },
  RoE: { color: 'white', bg: 'red', bracketColor: 'white' },
  SR: { color: 'brightGreen', bracketColor: 'white' },
};

function GuildTag({ guild }: { guild: string }) {
  const theme = useTerminalTheme();
  const style = GUILD_STYLES[guild];
  if (!style) return <span style={{ color: '#999' }}>[{guild}]</span>;

  const color = theme[style.color];
  const bg = style.bg ? theme[style.bg] : undefined;
  const hasBg = !!bg;
  const wrapStyle: React.CSSProperties = {
    backgroundColor: bg,
    padding: hasBg ? '0 1px' : undefined,
    borderRadius: hasBg ? 2 : undefined,
  };

  if (style.bracketColor) {
    const bracket = theme[style.bracketColor];
    return (
      <span className="text-[8px] font-mono font-bold" style={wrapStyle}>
        <span style={{ color: bracket }}>[</span>
        <span style={{ color }}>{guild}</span>
        <span style={{ color: bracket }}>]</span>
      </span>
    );
  }

  return (
    <span className="text-[8px] font-mono font-bold" style={{ color, ...wrapStyle }}>
      [{guild}]
    </span>
  );
}

const STATE_THEME_COLORS: Record<string, ThemeColorKey> = {
  online: 'brightGreen',
  away: 'brightYellow',
  busy: 'brightRed',
  walkup: 'brightBlue',
};

const STATE_LABELS: Record<string, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  walkup: 'Walkup',
};

function StateDot({ state }: { state: string }) {
  const theme = useTerminalTheme();
  const colorKey = STATE_THEME_COLORS[state] ?? 'white';
  return (
    <span
      className="w-[5px] h-[5px] rounded-full shrink-0"
      style={{ backgroundColor: theme[colorKey] }}
      title={STATE_LABELS[state] ?? state}
    />
  );
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

// ---------------------------------------------------------------------------
// Inline title mapping form
// ---------------------------------------------------------------------------

function TitleMappingForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { playerName: string; confirmed: boolean };
  onSave: (playerName: string, confirmed: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.playerName ?? '');
  const [confirmed, setConfirmed] = useState(initial?.confirmed ?? false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (name.trim()) onSave(name.trim(), confirmed);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 bg-[#8be9fd]/5 border-y border-[#8be9fd]/10">
      <MudInput
        ref={inputRef}
        accent="cyan"
        size="lg"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Player name"
        className="flex-1 min-w-0 text-[10px]! py-0.5!"
      />
      <button
        onClick={() => setConfirmed((c) => !c)}
        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
          confirmed
            ? 'text-[#50fa7b] border-[#50fa7b]/30 bg-[#50fa7b]/10'
            : 'text-[#ccc] border-[#ccc]/30 bg-[#ccc]/10'
        }`}
        title={confirmed ? 'Confirmed — click to mark suspected' : 'Suspected — click to confirm'}
      >
        {confirmed ? '\u2713' : '?'}
      </button>
      <button
        onClick={() => name.trim() && onSave(name.trim(), confirmed)}
        disabled={!name.trim()}
        className="text-[9px] font-mono text-[#8be9fd] hover:text-[#8be9fd]/80 cursor-pointer shrink-0 disabled:opacity-25 disabled:cursor-default"
        title="Save"
      >
        Save
      </button>
      <button
        onClick={onCancel}
        className="text-[11px] font-mono text-text-dim hover:text-red cursor-pointer shrink-0"
        title="Cancel"
      >
        &times;
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title annotation (inline display for mapped titles)
// ---------------------------------------------------------------------------

function TitleAnnotation({
  mapping,
  onEdit,
  onToggle,
  onDelete,
}: {
  mapping: WhoTitleMapping;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="group/title inline-flex items-center gap-0.5 ml-1">
      <button
        onClick={onEdit}
        onContextMenu={(e) => {
          e.preventDefault();
          onToggle();
        }}
        className={`text-[11px] font-mono cursor-pointer transition-colors ${
          mapping.confirmed
            ? 'text-[#50fa7b]/70 hover:text-[#50fa7b]'
            : 'text-[#ccc]/70 hover:text-[#ccc]'
        }`}
        title={`${mapping.confirmed ? 'Confirmed' : 'Suspected'}: ${mapping.playerName} — click to edit, right-click to toggle`}
      >
        ({mapping.playerName} {mapping.confirmed ? '\u2713' : '?'})
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="text-[10px] font-mono text-text-dim hover:text-red cursor-pointer opacity-0 group-hover/title:opacity-100 transition-all duration-150"
        title="Remove mapping"
      >
        &times;
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Player row
// ---------------------------------------------------------------------------

function PlayerRow({
  player,
  mapping,
  editingTitle,
  onStartEdit,
  onSave,
  onCancel,
  onToggle,
  onDelete,
}: {
  player: WhoPlayer;
  mapping: WhoTitleMapping | null;
  editingTitle: string | null;
  onStartEdit: (whoTitle: string) => void;
  onSave: (whoTitle: string, playerName: string, confirmed: boolean) => void;
  onCancel: () => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const theme = useTerminalTheme();
  const isEditing = editingTitle === player.name;

  return (
    <>
      <div className="group/row flex items-center gap-1.5 px-3 py-[3px] hover:bg-bg-hover/50 transition-colors">
        {/* Guild tag — fixed-width column so names always align */}
        <span className="w-[28px] shrink-0 inline-flex items-center justify-end">
          {player.guild && <GuildTag guild={player.guild} />}
        </span>

        {/* Name — colored with ANSI color from MUD output if available */}
        <span
          className="text-[12px] font-mono truncate flex-1 inline-flex items-center"
          style={{
            color: player.nameColor ? theme[player.nameColor] : undefined,
          }}
        >
          {player.name}
          {/* Title annotation or add button */}
          {player.isTitle && mapping && (
            <TitleAnnotation
              mapping={mapping}
              onEdit={() => onStartEdit(player.name)}
              onToggle={() => onToggle(mapping.id)}
              onDelete={() => onDelete(mapping.id)}
            />
          )}
          {player.isTitle && !mapping && (
            <button
              onClick={() => onStartEdit(player.name)}
              className="text-[10px] font-mono text-[#f59e0b] ml-1.5 px-1 rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 hover:bg-[#f59e0b]/20 cursor-pointer opacity-0 group-hover/row:opacity-100 transition-all duration-150 shrink-0"
              title="Add player name mapping for this who title"
            >
              ?
            </button>
          )}
        </span>

        {/* State */}
        {player.state === 'idle' ? (
          <span
            className="text-[9px] font-mono text-white shrink-0"
            title={`Idle ${player.idleTime}`}
          >
            {player.idleTime}
          </span>
        ) : (
          <StateDot state={player.state} />
        )}
      </div>

      {/* Inline edit form */}
      {isEditing && (
        <TitleMappingForm
          initial={
            mapping ? { playerName: mapping.playerName, confirmed: mapping.confirmed } : undefined
          }
          onSave={(playerName, confirmed) => onSave(player.name, playerName, confirmed)}
          onCancel={onCancel}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function WhoPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const { snapshot, refresh } = useWhoContext();
  const { mappings, resolveTitle, createMapping, updateMapping, deleteMapping } =
    useWhoTitleContext();
  const [, setTick] = useState(0);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  // Update "X ago" display every 30 seconds
  useEffect(() => {
    if (!snapshot) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [snapshot]);

  const playerCount = snapshot?.players.length ?? 0;

  const handleSave = (whoTitle: string, playerName: string, confirmed: boolean) => {
    const existing = resolveTitle(whoTitle);
    if (existing) {
      updateMapping(existing.id, { playerName, confirmed });
    } else {
      createMapping(whoTitle, playerName, confirmed);
    }
    setEditingTitle(null);
  };

  return (
    <div className={panelRootClass(isPinned)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5">
            <WhoIcon size={12} /> Who
          </span>
          {playerCount > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#8be9fd]/10 text-[#8be9fd] border border-[#8be9fd]/20">
              {playerCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={refresh}
            title="Refresh who list"
            className="p-1 rounded text-text-dim hover:text-text-muted transition-colors cursor-pointer"
          >
            <RotateCcwIcon size={11} />
          </button>
          {isPinned ? <PinnedControls /> : <PinMenuButton panel="who" />}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!snapshot ? (
          <div className="flex items-center justify-center h-full text-[10px] text-text-dim font-mono">
            Not connected
          </div>
        ) : (
          <>
            {/* Player list */}
            <div className="py-1">
              {snapshot.players.map((player, i) => (
                <PlayerRow
                  key={`${player.name}-${i}`}
                  player={player}
                  mapping={player.isTitle ? resolveTitle(player.name) : null}
                  editingTitle={editingTitle}
                  onStartEdit={setEditingTitle}
                  onSave={handleSave}
                  onCancel={() => setEditingTitle(null)}
                  onToggle={(id) => {
                    const m = Object.values(mappings).find((x) => x.id === id);
                    if (m) updateMapping(id, { confirmed: !m.confirmed });
                  }}
                  onDelete={(id) => {
                    deleteMapping(id);
                    setEditingTitle(null);
                  }}
                />
              ))}
            </div>

            {/* Footer stats */}
            <div className="border-t border-border-subtle px-3 py-2 space-y-0.5">
              {snapshot.totalEstimated != null && (
                <div className="text-[9px] font-mono text-text-dim">
                  {snapshot.totalEstimated} estimated online
                  {snapshot.censusReturned != null && (
                    <span className="text-text-dim/60"> ({snapshot.censusReturned} visible)</span>
                  )}
                </div>
              )}
              {snapshot.activeThisMonth != null && (
                <div className="text-[9px] font-mono text-text-dim">
                  {snapshot.activeThisMonth} this month, {snapshot.activeToday} today
                </div>
              )}
              {snapshot.renewedAgo && (
                <div className="text-[9px] font-mono text-text-dim">
                  Renewed {snapshot.renewedAgo} ago
                </div>
              )}
              <div className="text-[8px] font-mono text-text-dim/50 mt-1">
                Updated {timeAgo(snapshot.timestamp)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
