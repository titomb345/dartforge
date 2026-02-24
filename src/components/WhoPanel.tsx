import { useState, useEffect } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';
import { WhoIcon, RotateCcwIcon } from './icons';
import { useWhoContext } from '../contexts/WhoContext';

const GUILD_COLORS: Record<string, string> = {
  MG: '#bd93f9',
  HG: '#ff79c6',
  AG: '#8be9fd',
  SG: '#50fa7b',
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

export function WhoPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const { snapshot, refresh } = useWhoContext();
  const [, setTick] = useState(0);

  // Update "X ago" display every 30 seconds
  useEffect(() => {
    if (!snapshot) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [snapshot]);

  const playerCount = snapshot?.players.length ?? 0;

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
                <div
                  key={`${player.name}-${i}`}
                  className="flex items-center gap-1.5 px-3 py-[3px] hover:bg-bg-hover/50 transition-colors"
                >
                  {/* Guild tag */}
                  {player.guild ? (
                    <span
                      className="text-[8px] font-mono font-bold w-[22px] text-center shrink-0"
                      style={{ color: GUILD_COLORS[player.guild] ?? '#999' }}
                    >
                      {player.guild}
                    </span>
                  ) : (
                    <span className="w-[22px] shrink-0" />
                  )}

                  {/* Name */}
                  <span className="text-[11px] font-mono text-text-primary truncate flex-1">
                    {player.name}
                  </span>

                  {/* State */}
                  {player.state === 'online' ? (
                    <span
                      className="w-[5px] h-[5px] rounded-full bg-[#50fa7b] shrink-0"
                      title="Online"
                    />
                  ) : (
                    <span
                      className="text-[9px] font-mono text-[#f59e0b] shrink-0"
                      title={`Idle ${player.idleTime}`}
                    >
                      {player.idleTime}
                    </span>
                  )}
                </div>
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
