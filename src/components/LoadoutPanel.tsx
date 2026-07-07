/**
 * LoadoutPanel — live view of what each limb holds and what is worn,
 * built from output the game already prints (see lib/loadout.ts).
 *
 * Hands at the top (one row per hand limb, summoned items badged, empty
 * hands loud), an "in hand, limb unknown" bucket when a take/remove left
 * the exact hand ambiguous, and the worn list below. Health adjectives
 * from `x me` / `show health` tint each limb's dot.
 */

import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PanelHeader } from './PanelHeader';
import { LoadoutIcon } from './icons';
import { useLoadoutContext } from '../contexts/LoadoutContext';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { canonItem, isHandLimb, type LimbState } from '../lib/loadout';

const ACCENT = '#bd93f9';

function healthColor(health: string | null): string {
  if (!health) return '#4b5563';
  if (/perfect/.test(health)) return '#50fa7b';
  if (/very healthy/.test(health)) return '#a3e635';
  if (/fairly|somewhat/.test(health)) return '#fbbf24';
  if (/healthy/.test(health)) return '#d9f99d';
  return '#ef4444';
}

/** "upper left hand" → "upper left" (the section is already hands-only) */
function handLabel(limb: string): string {
  return limb.replace(/\s*hands?$/, '') || limb;
}

function ageLabel(ts: number, now: number): string | null {
  if (!ts) return null;
  const mins = Math.floor((now - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export function LoadoutPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const { state, refreshHands, refreshFull } = useLoadoutContext();
  const { panelFontSize } = useAppSettingsContext();

  const hands = state.limbs.filter((l) => isHandLimb(l.limb));
  const otherLimbs = state.limbs.filter((l) => !isHandLimb(l.limb));

  // Worn: limb-attributed items (from x me) + loose wear events, deduped
  const worn: { name: string; limb: string | null }[] = [];
  const seen = new Set<string>();
  for (const limb of state.limbs) {
    for (const name of limb.worn) {
      const key = canonItem(name);
      if (seen.has(key)) continue;
      seen.add(key);
      worn.push({ name, limb: limb.limb });
    }
  }
  for (const name of state.wornLoose) {
    const key = canonItem(name);
    if (seen.has(key)) continue;
    seen.add(key);
    worn.push({ name, limb: null });
  }

  const now = Date.now();
  const heldAge = ageLabel(state.heldSyncAt, now);
  const empty = state.limbs.length === 0 && worn.length === 0 && state.unassigned.length === 0;

  const syncBtn =
    'px-1.5 py-0.5 rounded border border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle transition-colors cursor-pointer text-[10px]';

  const limbDot = (l: LimbState) => (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ backgroundColor: healthColor(l.health) }}
      title={l.health ? `${l.limb}: ${l.health}` : `${l.limb}: health unknown`}
    />
  );

  return (
    <div className={panelRootClass(isPinned)}>
      <PanelHeader icon={<LoadoutIcon size={12} />} title="Loadout" panel="loadout" mode={mode} />

      {/* Sync toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border-subtle shrink-0 text-[10px]">
        <button
          onClick={refreshHands}
          className={syncBtn}
          title='Re-sync held items (sends "equip held")'
        >
          ⟳ hands
        </button>
        <button
          onClick={refreshFull}
          className={syncBtn}
          title='Full re-sync: hands, worn, and limb health (sends "view me")'
        >
          ⟳ full
        </button>
        <div className="flex-1" />
        {state.handsStale ? (
          <span
            className="px-1.5 py-0.5 rounded border border-amber-400/40 text-amber-300 text-[9px]"
            title="Something moved into a hand the game didn't name — press ⟳ hands to re-sync"
          >
            ≈ approx
          </span>
        ) : (
          heldAge && (
            <span className="text-text-dim text-[9px]" title="Last authoritative hands sync">
              synced {heldAge}
            </span>
          )
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto font-mono" style={{ fontSize: `${panelFontSize}px` }}>
        {empty ? (
          <div className="px-3 py-4 text-text-dim leading-relaxed">
            No equipment data yet.
            <br />
            <br />
            Press <span className="text-text-label">⟳ full</span> (or type{' '}
            <span className="text-text-label">view me</span>) for a complete snapshot — the panel
            then follows your hold, wear, remove, summon, and stow messages live.
          </div>
        ) : (
          <>
            {/* Hands */}
            {hands.length > 0 && (
              <>
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] tracking-wider text-text-dim">
                  HANDS
                </div>
                {hands.map((l) => (
                  <div
                    key={l.limb}
                    className="flex items-center gap-1.5 px-2 py-[3px] border-b border-border-dim/30"
                  >
                    {limbDot(l)}
                    <span className="w-[72px] shrink-0 text-text-dim truncate" title={l.limb}>
                      {handLabel(l.limb)}
                    </span>
                    {l.held.length === 0 ? (
                      <span className="text-text-dim/50 italic">empty</span>
                    ) : (
                      <span className="flex-1 min-w-0 text-text-label">
                        {l.held.map((h, i) => (
                          <span key={i} className="block truncate" title={h.name}>
                            {h.summoned && (
                              <span
                                style={{ color: ACCENT }}
                                title="Summoned — vanishes when dismissed or dropped"
                              >
                                ✦{' '}
                              </span>
                            )}
                            {h.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Taken into an unnamed hand */}
            {state.unassigned.length > 0 && (
              <div className="px-2 py-1 border-b border-border-dim/30">
                <span className="text-amber-300/90 text-[9px]">IN HAND, LIMB UNKNOWN: </span>
                <span className="text-text-label">{state.unassigned.join(', ')}</span>
              </div>
            )}

            {/* Worn */}
            {worn.length > 0 && (
              <>
                <div className="px-2 pt-2 pb-0.5 text-[9px] tracking-wider text-text-dim">WORN</div>
                {worn.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-baseline gap-1.5 px-2 py-[2px] border-b border-border-dim/20"
                  >
                    <span className="flex-1 min-w-0 text-text-label truncate" title={w.name}>
                      {w.name}
                    </span>
                    {w.limb && (
                      <span className="text-text-dim/60 text-[9px] shrink-0">{w.limb}</span>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Non-hand limb health (from x me / show health) */}
            {otherLimbs.some((l) => l.health) && (
              <div className="px-2 pt-2 pb-2 flex flex-wrap gap-x-2.5 gap-y-1">
                {otherLimbs
                  .filter((l) => l.health)
                  .map((l) => (
                    <span key={l.limb} className="flex items-center gap-1 text-[9px] text-text-dim">
                      {limbDot(l)}
                      {l.limb}
                    </span>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
