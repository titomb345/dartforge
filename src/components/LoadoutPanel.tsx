/**
 * LoadoutPanel — live view of what each limb holds and what is worn,
 * built from output the game already prints (see lib/loadout.ts).
 *
 * Layout follows the Who panel's conventions: a slim header toolbar with
 * the sync status on the left and borderless icon actions on the right
 * (RotateCcw = re-sync hands via `equip held`, User = full sync via
 * `view me`). Hands render first — item names wrap rather than truncate
 * because DartMUD puts the noun at the END of its long item names
 * ("an eye-piercing … leather heater shield"). Health adjectives from
 * `view me` / `show health` tint each limb's dot.
 */

import { useEffect, useState } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PanelHeader } from './PanelHeader';
import { LoadoutIcon, RotateCcwIcon, UserIcon } from './icons';
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

/** Item names read better in a table without their leading article */
function displayName(name: string): string {
  return name.replace(/^(?:a|an|the) /, '');
}

function ageLabel(ts: number, now: number): string | null {
  if (!ts) return null;
  const mins = Math.floor((now - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function LoadoutPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const { state, refreshHands, refreshFull } = useLoadoutContext();
  const { panelFontSize } = useAppSettingsContext();

  // Keep the "synced Xm ago" label current (Who panel pattern)
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const hands = state.limbs.filter((l) => isHandLimb(l.limb));
  const otherLimbs = state.limbs.filter((l) => !isHandLimb(l.limb));

  // Worn: limb-attributed items (from view me) + loose wear events, deduped
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

  const heldAge = ageLabel(state.heldSyncAt, Date.now());
  const empty = state.limbs.length === 0 && worn.length === 0 && state.unassigned.length === 0;

  const iconBtn =
    'p-1 rounded text-text-dim hover:text-text-muted transition-colors cursor-pointer';

  const limbDot = (l: LimbState) => (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ backgroundColor: healthColor(l.health) }}
      title={l.health ? `${l.limb}: ${l.health}` : `${l.limb}: health unknown`}
    />
  );

  const sectionHeader = (label: string, extra?: string) => (
    <div className="flex items-baseline gap-1.5 px-2 pt-2 pb-1 text-[9px] tracking-[0.12em] text-text-dim select-none">
      {label}
      {extra && <span className="tracking-normal text-text-dim/60">{extra}</span>}
    </div>
  );

  return (
    <div className={panelRootClass(isPinned)}>
      <PanelHeader icon={<LoadoutIcon size={12} />} title="Loadout" panel="loadout" mode={mode}>
        {state.handsStale ? (
          <span
            className="text-[9px] text-amber-300/90 font-mono"
            title="Something moved into a hand the game didn't name. Re-sync to confirm"
          >
            hands unverified
          </span>
        ) : (
          heldAge && (
            <span className="text-[9px] text-text-dim font-mono" title="Last authoritative sync">
              synced {heldAge}
            </span>
          )
        )}
        <div className="flex-1" />
        <button
          onClick={refreshHands}
          title='Re-sync hands (sends "equip held")'
          className={`${iconBtn} ${state.handsStale ? 'text-amber-300 hover:text-amber-200' : ''}`}
        >
          <RotateCcwIcon size={11} />
        </button>
        <button
          onClick={refreshFull}
          title='Full sync: hands, worn, health (sends "view me")'
          className={iconBtn}
        >
          <UserIcon size={11} />
        </button>
      </PanelHeader>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto font-mono pb-2"
        style={{ fontSize: `${panelFontSize}px` }}
      >
        {empty ? (
          <div className="px-3 py-4 text-text-dim leading-relaxed">
            No equipment data yet.
            <br />
            <br />
            Press <UserIcon size={10} /> <span className="text-text-label">Full sync</span> above
            (or type <span className="text-text-label">view me</span>). The panel then follows your
            hold, wear, remove, summon, and stow messages live.
          </div>
        ) : (
          <>
            {/* Hands */}
            {hands.length > 0 && (
              <>
                {sectionHeader('HANDS')}
                {hands.map((l) => (
                  <div key={l.limb} className="flex items-baseline gap-1.5 px-2 py-[3px]">
                    <span className="translate-y-[-1px]">{limbDot(l)}</span>
                    <span className="w-[68px] shrink-0 text-text-dim" title={l.limb}>
                      {handLabel(l.limb)}
                    </span>
                    {l.held.length === 0 ? (
                      <span className="text-text-dim/40">—</span>
                    ) : (
                      <span className="flex-1 min-w-0 text-text-label">
                        {l.held.map((h, i) => (
                          <span key={i} className="block break-words" title={h.name}>
                            {h.summoned && (
                              <span
                                style={{ color: ACCENT }}
                                title="Summoned: vanishes when dismissed or dropped"
                              >
                                ✦{' '}
                              </span>
                            )}
                            {displayName(h.name)}
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
              <div className="flex items-baseline gap-1.5 px-2 py-[3px]">
                <span
                  className="shrink-0 text-[9px] text-amber-300/90"
                  title="The game didn't say which hand caught these. Re-sync to confirm"
                >
                  hand?
                </span>
                <span className="flex-1 min-w-0 text-text-label break-words">
                  {state.unassigned.map(displayName).join(', ')}
                </span>
              </div>
            )}

            {/* Worn */}
            {worn.length > 0 && (
              <>
                {sectionHeader('WORN', `· ${worn.length}`)}
                {worn.map((w, i) => (
                  <div key={i} className="flex items-baseline gap-1.5 px-2 py-[2px] group">
                    <span className="flex-1 min-w-0 text-text-muted truncate" title={w.name}>
                      {displayName(w.name)}
                    </span>
                    {w.limb && (
                      <span className="text-text-dim/50 text-[9px] shrink-0">
                        {w.limb.replace(/\s*hands?$/, ' hand')}
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Non-hand limb health (from view me / show health) */}
            {otherLimbs.some((l) => l.health) && (
              <>
                {sectionHeader('LIMBS')}
                <div className="px-2 pb-1 flex flex-wrap gap-x-3 gap-y-1">
                  {otherLimbs
                    .filter((l) => l.health)
                    .map((l) => (
                      <span
                        key={l.limb}
                        className="flex items-center gap-1 text-[9px] text-text-dim"
                      >
                        {limbDot(l)}
                        {l.limb}
                      </span>
                    ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
