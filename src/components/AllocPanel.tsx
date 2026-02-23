import { useState, useRef, useEffect } from 'react';
import { useAllocContext } from '../contexts/AllocContext';
import type { PinnablePanelProps } from '../types';
import type { AllocView, AllocTab, LimbAllocation, MagicAllocation } from '../types/alloc';
import { ALLOC_SLOTS, POINTS_PER_LIMB, SLOT_SHORT, MAGIC_SLOTS, MAGIC_POINTS, MAGIC_SLOT_SHORT } from '../types/alloc';
import { calcNull, calcArcane } from '../lib/allocPatterns';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';
import { ChevronLeftIcon, ChevronRightSmallIcon, PlusIcon, TrashIcon, CopyIcon, CheckIcon, AllocIcon } from './icons';
import { cn } from '../lib/cn';

type AllocPanelProps = PinnablePanelProps;

const ACCENT = '#e06c75';
const MAGIC_ACCENT = '#bd93f9';

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

/** Compact inline-editable text field. */
function InlineField({
  value,
  placeholder,
  onSave,
  className,
  accent,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  className?: string;
  accent?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        className={cn(
          'text-[11px] truncate cursor-pointer transition-colors duration-100',
          value ? 'text-text-heading hover:text-text-primary' : 'text-text-dim hover:text-text-label italic',
          className,
        )}
        title="Click to edit"
      >
        {value || placeholder}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed !== value) onSave(trimmed);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      className={cn(
        'bg-bg-canvas border border-border rounded px-1 py-0 text-[11px] text-text-primary outline-none',
        className,
      )}
      style={accent ? { borderColor: `${accent}60` } : undefined}
      placeholder={placeholder}
    />
  );
}

/** Editable numeric cell. Click to type exact value, or use +/- on hover. */
function AllocCell({
  value,
  readOnly,
  onChange,
  onDelta,
}: {
  value: number;
  readOnly?: boolean;
  onChange?: (v: number) => void;
  onDelta?: (delta: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleClick = () => {
    if (readOnly) return;
    if (!editing) {
      setDraft(String(value));
      setEditing(true);
    }
  };

  const handleDelta = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    const mult = e.shiftKey ? 5 : 1;
    onDelta?.(delta * mult);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => {
          const num = parseInt(draft, 10);
          if (!isNaN(num) && num !== value) onChange?.(num);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); }
        }}
        className="w-[36px] bg-bg-canvas border border-border rounded text-center text-[11px] text-text-primary outline-none px-0 py-0 font-mono"
      />
    );
  }

  return (
    <div
      className={cn(
        'group/cell relative flex items-center justify-center w-[36px] h-[20px] rounded text-[11px] font-mono select-none',
        readOnly
          ? 'text-text-dim bg-transparent'
          : 'text-text-primary bg-bg-canvas/50 cursor-pointer hover:bg-bg-secondary transition-colors duration-100',
      )}
      onClick={handleClick}
    >
      {!readOnly && (
        <button
          onClick={(e) => handleDelta(e, -1)}
          className="absolute left-[-1px] top-0 bottom-0 w-[12px] flex items-center justify-center opacity-0 group-hover/cell:opacity-100 text-[8px] text-text-dim hover:text-red transition-all duration-100 cursor-pointer"
          title="- 1 (shift: - 5)"
        >
          -
        </button>
      )}
      <span>{value}</span>
      {!readOnly && (
        <button
          onClick={(e) => handleDelta(e, 1)}
          className="absolute right-[-1px] top-0 bottom-0 w-[12px] flex items-center justify-center opacity-0 group-hover/cell:opacity-100 text-[8px] text-text-dim hover:text-green transition-all duration-100 cursor-pointer"
          title="+ 1 (shift: + 5)"
        >
          +
        </button>
      )}
    </div>
  );
}

/** Thin colored bar showing point distribution per limb. */
function PointBar({ alloc }: { alloc: LimbAllocation }) {
  const n = calcNull(alloc);
  const segments: { slot: string; value: number; color: string }[] = [
    { slot: 'b', value: alloc.bonus, color: '#bd93f9' },
    { slot: 'd', value: alloc.daring, color: '#ff79c6' },
    { slot: 's', value: alloc.speed, color: '#50fa7b' },
    { slot: 'a', value: alloc.aiming, color: '#f1fa8c' },
    { slot: 'p', value: alloc.parry, color: '#8be9fd' },
    { slot: 'c', value: alloc.control, color: '#ffb86c' },
    { slot: 'n', value: n, color: '#44475a' },
  ];

  return (
    <div className="flex h-[3px] rounded-full overflow-hidden bg-bg-canvas/50">
      {segments.map(({ slot, value, color }) =>
        value > 0 ? (
          <div
            key={slot}
            style={{
              width: `${(value / POINTS_PER_LIMB) * 100}%`,
              backgroundColor: color,
            }}
          />
        ) : null,
      )}
    </div>
  );
}

/** Thin colored bar showing magic point distribution. */
function MagicPointBar({ alloc }: { alloc: MagicAllocation }) {
  const arcane = calcArcane(alloc);
  const segments: { slot: string; value: number; color: string }[] = [
    { slot: 'air', value: alloc.air, color: '#8be9fd' },
    { slot: 'fire', value: alloc.fire, color: '#ff6e6e' },
    { slot: 'water', value: alloc.water, color: '#6272a4' },
    { slot: 'earth', value: alloc.earth, color: '#8b6d4b' },
    { slot: 'arcane', value: arcane, color: '#44475a' },
  ];

  return (
    <div className="flex h-[3px] rounded-full overflow-hidden bg-bg-canvas/50">
      {segments.map(({ slot, value, color }) =>
        value > 0 ? (
          <div
            key={slot}
            style={{
              width: `${(value / MAGIC_POINTS) * 100}%`,
              backgroundColor: color,
            }}
          />
        ) : null,
      )}
    </div>
  );
}

/** Column headers for the combat allocation grid. */
function GridHeaders() {
  return (
    <div className="flex items-center gap-0">
      <div className="flex-1 min-w-0" />
      {ALLOC_SLOTS.map((slot) => (
        <div
          key={slot}
          className="w-[36px] text-center text-[10px] font-bold uppercase tracking-wider text-text-dim"
          title={slot}
        >
          {SLOT_SHORT[slot]}
        </div>
      ))}
      <div
        className="w-[36px] text-center text-[10px] font-bold uppercase tracking-wider text-text-dim/50"
        title="null (auto-calculated)"
      >
        n
      </div>
      <div className="w-[20px]" />
    </div>
  );
}

/** Column headers for the magic allocation grid. */
function MagicGridHeaders() {
  return (
    <div className="flex items-center gap-0">
      <div className="flex-1 min-w-0" />
      {MAGIC_SLOTS.map((slot) => (
        <div
          key={slot}
          className="w-[36px] text-center text-[10px] font-bold uppercase tracking-wider text-text-dim"
          title={slot}
        >
          {MAGIC_SLOT_SHORT[slot]}
        </div>
      ))}
      <div
        className="w-[36px] text-center text-[10px] font-bold uppercase tracking-wider text-text-dim/50"
        title="arcane (auto-calculated)"
      >
        arc
      </div>
      <div className="w-[20px]" />
    </div>
  );
}

/** View toggle pills (Live / Profiles). */
function ViewToggle({ view, onSetView, accent }: { view: AllocView; onSetView: (v: AllocView) => void; accent?: string }) {
  const color = accent ?? ACCENT;
  return (
    <div className="flex rounded overflow-hidden border border-border-dim">
      <button
        onClick={() => onSetView('live')}
        className={cn(
          'px-2 py-[1px] text-[10px] font-semibold cursor-pointer transition-colors duration-100',
          view === 'live'
            ? ''
            : 'text-text-dim hover:text-text-label',
        )}
        style={view === 'live' ? { background: `${color}15`, color } : undefined}
      >
        Live
      </button>
      <button
        onClick={() => onSetView('profiles')}
        className={cn(
          'px-2 py-[1px] text-[10px] font-semibold cursor-pointer transition-colors duration-100 border-l border-border-dim',
          view === 'profiles'
            ? ''
            : 'text-text-dim hover:text-text-label',
        )}
        style={view === 'profiles' ? { background: `${color}15`, color } : undefined}
      >
        Profiles
      </button>
    </div>
  );
}

/** Top-level Combat / Magic tab toggle. */
function TabToggle({ tab, onSetTab }: { tab: AllocTab; onSetTab: (t: AllocTab) => void }) {
  return (
    <div className="flex rounded overflow-hidden border border-border-dim">
      <button
        onClick={() => onSetTab('combat')}
        className={cn(
          'px-2 py-[1px] text-[10px] font-semibold cursor-pointer transition-colors duration-100',
          tab === 'combat'
            ? ''
            : 'text-text-dim hover:text-text-label',
        )}
        style={tab === 'combat' ? { background: `${ACCENT}15`, color: ACCENT } : undefined}
      >
        Combat
      </button>
      <button
        onClick={() => onSetTab('magic')}
        className={cn(
          'px-2 py-[1px] text-[10px] font-semibold cursor-pointer transition-colors duration-100 border-l border-border-dim',
          tab === 'magic'
            ? ''
            : 'text-text-dim hover:text-text-label',
        )}
        style={tab === 'magic' ? { background: `${MAGIC_ACCENT}15`, color: MAGIC_ACCENT } : undefined}
      >
        Magic
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Combat: Live View                                                   */
/* ------------------------------------------------------------------ */

function LiveView() {
  const {
    data,
    updateLiveLimbSlot,
    setLiveLimbSlotDelta,
    applyLiveLimb,
    applyLiveAll,
    createProfileFromLive,
  } = useAllocContext();

  const limbNames = data.detectedLimbs;
  const live = data.liveAllocations;

  if (limbNames.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-[11px] px-4 text-center">
        No limbs detected yet. Connect and log in to detect your allocations.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-2 py-1">
      <div className="flex flex-col gap-0.5">
        <GridHeaders />
        {limbNames.map((limb) => {
          const alloc = live[limb] ?? { bonus: 0, daring: 0, speed: 0, aiming: 0, parry: 0, control: 0 };
          const nullVal = calcNull(alloc);
          return (
            <div key={limb} className="flex flex-col gap-0">
              <div className="flex items-center gap-0">
                <div className="flex-1 min-w-0 text-[10px] text-text-label truncate pr-1" title={limb}>
                  {limb}
                </div>
                {ALLOC_SLOTS.map((slot) => (
                  <AllocCell
                    key={slot}
                    value={alloc[slot]}
                    onChange={(v) => updateLiveLimbSlot(limb, slot, v)}
                    onDelta={(d) => setLiveLimbSlotDelta(limb, slot, d)}
                  />
                ))}
                <AllocCell value={nullVal} readOnly />
                <button
                  onClick={() => applyLiveLimb(limb)}
                  className="flex items-center justify-center w-[20px] h-[20px] rounded text-text-dim hover:text-green cursor-pointer transition-colors"
                  title={`Apply ${limb}`}
                >
                  <CheckIcon size={10} />
                </button>
              </div>
              <div className="ml-auto" style={{ width: `${(ALLOC_SLOTS.length + 1) * 36 + 20}px` }}>
                <PointBar alloc={alloc} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Live view actions */}
      <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-border-dim">
        <button
          onClick={() => applyLiveAll()}
          className="flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
          style={{ color: ACCENT, borderColor: `${ACCENT}40`, background: `${ACCENT}10` }}
          title="Apply all limbs to MUD"
        >
          Apply All
        </button>
        <button
          onClick={() => createProfileFromLive()}
          className="flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border border-border-dim text-text-dim hover:text-text-label hover:border-border"
          title="Save current live allocations as a profile"
        >
          <PlusIcon size={9} /> Save as Profile
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Combat: Profile View                                                */
/* ------------------------------------------------------------------ */

function ProfileView() {
  const {
    data,
    currentProfile,
    navigateProfile,
    createProfile,
    deleteProfile,
    duplicateProfile,
    renameProfile,
    updateLimbSlot,
    setLimbSlotDelta,
    applyLimb,
    applyAll,
    loadProfileToLive,
  } = useAllocContext();

  const [confirmDelete, setConfirmDelete] = useState(false);

  const profileNum = data.profiles.length > 0 ? data.currentProfileIndex + 1 : 0;
  const profileTotal = data.profiles.length;
  // Use detectedLimbs for canonical ordering; fall back to profile keys for limbs not yet detected
  const limbNames = data.detectedLimbs.length > 0
    ? data.detectedLimbs
    : currentProfile ? Object.keys(currentProfile.limbs) : [];

  return (
    <>
      {/* Profile navigation row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-dim shrink-0">
        <button
          onClick={() => navigateProfile('prev')}
          disabled={profileTotal === 0}
          className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
          title="Previous profile"
        >
          <ChevronLeftIcon size={10} />
        </button>
        <span className="text-[11px] font-mono text-text-label w-[40px] text-center tabular-nums">
          {profileTotal > 0 ? `${String(profileNum).padStart(2, '0')}/${String(profileTotal).padStart(2, '0')}` : '--/--'}
        </span>
        <button
          onClick={() => navigateProfile('next')}
          disabled={profileTotal === 0}
          className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
          title="Next profile"
        >
          <ChevronRightSmallIcon size={10} />
        </button>

        <div className="w-px h-3 bg-border-dim mx-0.5" />

        {currentProfile ? (
          <InlineField
            value={currentProfile.name}
            placeholder="name"
            onSave={(v) => renameProfile(currentProfile.id, v)}
            className="flex-1 min-w-0 font-semibold"
          />
        ) : (
          <span className="flex-1 text-[11px] text-text-dim italic">no profiles</span>
        )}

        <div className="w-px h-3 bg-border-dim mx-0.5" />

        {currentProfile && (
          <button
            onClick={() => applyAll(currentProfile.id)}
            className="flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
            style={{ color: ACCENT, borderColor: `${ACCENT}40`, background: `${ACCENT}10` }}
            title="Apply all limbs"
          >
            Apply
          </button>
        )}

        <button
          onClick={() => createProfile()}
          className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-green cursor-pointer transition-colors"
          title="New profile"
        >
          <PlusIcon size={10} />
        </button>
        {currentProfile && (
          <>
            <button
              onClick={() => duplicateProfile(currentProfile.id)}
              className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-cyan cursor-pointer transition-colors"
              title="Duplicate profile"
            >
              <CopyIcon size={10} />
            </button>
            <button
              onClick={() => loadProfileToLive(currentProfile.id)}
              className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-amber cursor-pointer transition-colors"
              title="Load into Live view"
            >
              <ChevronLeftIcon size={10} />
            </button>
            {confirmDelete ? (
              <button
                onClick={() => { deleteProfile(currentProfile.id); setConfirmDelete(false); }}
                onBlur={() => setConfirmDelete(false)}
                className="text-[8px] font-mono text-red border border-red/40 rounded px-1 py-px cursor-pointer hover:bg-red/10 transition-colors duration-150"
              >
                Del?
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-red cursor-pointer transition-colors"
                title="Delete profile"
              >
                <TrashIcon size={10} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Profile allocation grid */}
      <div className="flex-1 overflow-auto px-2 py-1">
        {!currentProfile ? (
          <div className="flex flex-col items-center justify-center h-full text-text-dim text-[11px] gap-2">
            <p>No allocation profiles yet.</p>
            <button
              onClick={() => createProfile()}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border border-border-dim hover:border-border text-text-label hover:text-text-primary transition-colors"
            >
              <PlusIcon size={10} /> Create Profile
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <GridHeaders />
            {limbNames.map((limb) => {
              const alloc = currentProfile.limbs[limb];
              if (!alloc) return null;
              const nullVal = calcNull(alloc);
              return (
                <div key={limb} className="flex flex-col gap-0">
                  <div className="flex items-center gap-0">
                    <div className="flex-1 min-w-0 text-[10px] text-text-label truncate pr-1" title={limb}>
                      {limb}
                    </div>
                    {ALLOC_SLOTS.map((slot) => (
                      <AllocCell
                        key={slot}
                        value={alloc[slot]}
                        onChange={(v) => updateLimbSlot(currentProfile.id, limb, slot, v)}
                        onDelta={(d) => setLimbSlotDelta(currentProfile.id, limb, slot, d)}
                      />
                    ))}
                    <AllocCell value={nullVal} readOnly />
                    <button
                      onClick={() => applyLimb(currentProfile.id, limb)}
                      className="flex items-center justify-center w-[20px] h-[20px] rounded text-text-dim hover:text-green cursor-pointer transition-colors"
                      title={`Apply ${limb}`}
                    >
                      <CheckIcon size={10} />
                    </button>
                  </div>
                  <div className="ml-auto" style={{ width: `${(ALLOC_SLOTS.length + 1) * 36 + 20}px` }}>
                    <PointBar alloc={alloc} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {currentProfile?.isActive && (
        <div
          className="flex items-center justify-center gap-1 px-2 py-0.5 border-t border-border-dim text-[10px] font-semibold"
          style={{ color: '#50fa7b', background: 'rgba(80, 250, 123, 0.05)' }}
        >
          <CheckIcon size={9} /> Active
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Magic: Live View                                                    */
/* ------------------------------------------------------------------ */

function MagicLiveView() {
  const {
    magicData,
    updateMagicLiveSlot,
    setMagicLiveSlotDelta,
    applyMagicLive,
    createMagicProfileFromLive,
  } = useAllocContext();

  const alloc = magicData.liveAllocation;
  const arcane = calcArcane(alloc);
  const hasValues = MAGIC_SLOTS.some((s) => alloc[s] > 0) || arcane > 0;

  if (!hasValues) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-[11px] px-4 text-center">
        No magic allocations detected yet. Connect and log in to detect your elemental affinity.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-2 py-1">
      <div className="flex flex-col gap-0.5">
        <MagicGridHeaders />
        <div className="flex flex-col gap-0">
          <div className="flex items-center gap-0">
            <div className="flex-1 min-w-0 text-[10px] text-text-label truncate pr-1" title="elemental">
              elemental
            </div>
            {MAGIC_SLOTS.map((slot) => (
              <AllocCell
                key={slot}
                value={alloc[slot]}
                onChange={(v) => updateMagicLiveSlot(slot, v)}
                onDelta={(d) => setMagicLiveSlotDelta(slot, d)}
              />
            ))}
            <AllocCell value={arcane} readOnly />
            <button
              onClick={() => applyMagicLive()}
              className="flex items-center justify-center w-[20px] h-[20px] rounded text-text-dim hover:text-green cursor-pointer transition-colors"
              title="Apply magic allocation"
            >
              <CheckIcon size={10} />
            </button>
          </div>
          <div className="ml-auto" style={{ width: `${(MAGIC_SLOTS.length + 1) * 36 + 20}px` }}>
            <MagicPointBar alloc={alloc} />
          </div>
        </div>
      </div>

      {/* Live view actions */}
      <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-border-dim">
        <button
          onClick={() => applyMagicLive()}
          className="flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
          style={{ color: MAGIC_ACCENT, borderColor: `${MAGIC_ACCENT}40`, background: `${MAGIC_ACCENT}10` }}
          title="Apply magic allocation to MUD"
        >
          Apply
        </button>
        <button
          onClick={() => createMagicProfileFromLive()}
          className="flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border border-border-dim text-text-dim hover:text-text-label hover:border-border"
          title="Save current magic allocation as a profile"
        >
          <PlusIcon size={9} /> Save as Profile
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Magic: Profile View                                                 */
/* ------------------------------------------------------------------ */

function MagicProfileView() {
  const {
    magicData,
    currentMagicProfile,
    navigateMagicProfile,
    createMagicProfile,
    deleteMagicProfile,
    duplicateMagicProfile,
    renameMagicProfile,
    updateMagicProfileSlot,
    setMagicProfileSlotDelta,
    applyMagic,
    loadMagicProfileToLive,
  } = useAllocContext();

  const [confirmDelete, setConfirmDelete] = useState(false);

  const profileNum = magicData.profiles.length > 0 ? magicData.currentProfileIndex + 1 : 0;
  const profileTotal = magicData.profiles.length;

  return (
    <>
      {/* Profile navigation row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-dim shrink-0">
        <button
          onClick={() => navigateMagicProfile('prev')}
          disabled={profileTotal === 0}
          className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
          title="Previous profile"
        >
          <ChevronLeftIcon size={10} />
        </button>
        <span className="text-[11px] font-mono text-text-label w-[40px] text-center tabular-nums">
          {profileTotal > 0 ? `${String(profileNum).padStart(2, '0')}/${String(profileTotal).padStart(2, '0')}` : '--/--'}
        </span>
        <button
          onClick={() => navigateMagicProfile('next')}
          disabled={profileTotal === 0}
          className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
          title="Next profile"
        >
          <ChevronRightSmallIcon size={10} />
        </button>

        <div className="w-px h-3 bg-border-dim mx-0.5" />

        {currentMagicProfile ? (
          <InlineField
            value={currentMagicProfile.name}
            placeholder="name"
            onSave={(v) => renameMagicProfile(currentMagicProfile.id, v)}
            className="flex-1 min-w-0 font-semibold"
            accent={MAGIC_ACCENT}
          />
        ) : (
          <span className="flex-1 text-[11px] text-text-dim italic">no profiles</span>
        )}

        <div className="w-px h-3 bg-border-dim mx-0.5" />

        {currentMagicProfile && (
          <button
            onClick={() => applyMagic(currentMagicProfile.id)}
            className="flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
            style={{ color: MAGIC_ACCENT, borderColor: `${MAGIC_ACCENT}40`, background: `${MAGIC_ACCENT}10` }}
            title="Apply magic allocation"
          >
            Apply
          </button>
        )}

        <button
          onClick={() => createMagicProfile()}
          className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-green cursor-pointer transition-colors"
          title="New magic profile"
        >
          <PlusIcon size={10} />
        </button>
        {currentMagicProfile && (
          <>
            <button
              onClick={() => duplicateMagicProfile(currentMagicProfile.id)}
              className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-cyan cursor-pointer transition-colors"
              title="Duplicate profile"
            >
              <CopyIcon size={10} />
            </button>
            <button
              onClick={() => loadMagicProfileToLive(currentMagicProfile.id)}
              className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-amber cursor-pointer transition-colors"
              title="Load into Live view"
            >
              <ChevronLeftIcon size={10} />
            </button>
            {confirmDelete ? (
              <button
                onClick={() => { deleteMagicProfile(currentMagicProfile.id); setConfirmDelete(false); }}
                onBlur={() => setConfirmDelete(false)}
                className="flex items-center gap-0.5 px-1 py-[1px] rounded text-[9px] font-semibold cursor-pointer transition-all duration-200 border border-red/40 bg-red/10 text-red"
                autoFocus
              >
                confirm?
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-red cursor-pointer transition-colors"
                title="Delete profile"
              >
                <TrashIcon size={10} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Profile allocation grid */}
      <div className="flex-1 overflow-auto px-2 py-1">
        {!currentMagicProfile ? (
          <div className="flex flex-col items-center justify-center h-full text-text-dim text-[11px] gap-2">
            <p>No magic profiles yet.</p>
            <button
              onClick={() => createMagicProfile()}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border border-border-dim hover:border-border text-text-label hover:text-text-primary transition-colors"
            >
              <PlusIcon size={10} /> Create Profile
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <MagicGridHeaders />
            <div className="flex flex-col gap-0">
              <div className="flex items-center gap-0">
                <div className="flex-1 min-w-0 text-[10px] text-text-label truncate pr-1" title="elemental">
                  elemental
                </div>
                {MAGIC_SLOTS.map((slot) => (
                  <AllocCell
                    key={slot}
                    value={currentMagicProfile.alloc[slot]}
                    onChange={(v) => updateMagicProfileSlot(currentMagicProfile.id, slot, v)}
                    onDelta={(d) => setMagicProfileSlotDelta(currentMagicProfile.id, slot, d)}
                  />
                ))}
                <AllocCell value={calcArcane(currentMagicProfile.alloc)} readOnly />
                <button
                  onClick={() => applyMagic(currentMagicProfile.id)}
                  className="flex items-center justify-center w-[20px] h-[20px] rounded text-text-dim hover:text-green cursor-pointer transition-colors"
                  title="Apply magic allocation"
                >
                  <CheckIcon size={10} />
                </button>
              </div>
              <div className="ml-auto" style={{ width: `${(MAGIC_SLOTS.length + 1) * 36 + 20}px` }}>
                <MagicPointBar alloc={currentMagicProfile.alloc} />
              </div>
            </div>
          </div>
        )}
      </div>

      {currentMagicProfile?.isActive && (
        <div
          className="flex items-center justify-center gap-1 px-2 py-0.5 border-t border-border-dim text-[10px] font-semibold"
          style={{ color: '#50fa7b', background: 'rgba(80, 250, 123, 0.05)' }}
        >
          <CheckIcon size={9} /> Active
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Panel                                                         */
/* ------------------------------------------------------------------ */

export function AllocPanel({ mode = 'slideout' }: AllocPanelProps) {
  const isPinned = mode === 'pinned';
  const { view, setView, allocTab, setAllocTab, magicView, setMagicView } = useAllocContext();

  return (
    <div className={isPinned
        ? 'h-full flex flex-col overflow-hidden'
        : 'w-[420px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden'
      }>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5"><AllocIcon size={12} /> Allocations</span>
        <div className="flex items-center gap-1.5">
          {isPinned ? <PinnedControls /> : <PinMenuButton panel="alloc" />}
        </div>
      </div>
      {/* Tabs & view toggle */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle shrink-0">
        <TabToggle tab={allocTab} onSetTab={setAllocTab} />
        {allocTab === 'combat' ? (
          <ViewToggle view={view} onSetView={setView} accent={ACCENT} />
        ) : (
          <ViewToggle view={magicView} onSetView={setMagicView} accent={MAGIC_ACCENT} />
        )}
      </div>

      {allocTab === 'combat' ? (
        view === 'live' ? <LiveView /> : <ProfileView />
      ) : (
        magicView === 'live' ? <MagicLiveView /> : <MagicProfileView />
      )}
    </div>
  );
}
