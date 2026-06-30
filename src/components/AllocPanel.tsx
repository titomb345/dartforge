import { useState, useRef, useEffect } from 'react';
import { useAllocContext } from '../contexts/AllocContext';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import type { PinnablePanelProps } from '../types';
import type {
  AllocView,
  AllocTab,
  AllocSlot,
  MagicSlot,
  LimbAllocation,
  MagicAllocation,
} from '../types/alloc';
import {
  ALLOC_SLOTS,
  POINTS_PER_LIMB,
  SLOT_SHORT,
  EMPTY_LIMB,
  MAGIC_SLOTS,
  MAGIC_POINTS,
  MAGIC_SLOT_SHORT,
} from '../types/alloc';
import { calcNull, calcArcane } from '../lib/allocPatterns';
import { PanelHeader } from './PanelHeader';
import { FontSizeControl } from './FontSizeControl';
import {
  ChevronLeftIcon,
  PlusIcon,
  CopyIcon,
  CheckIcon,
  AllocIcon,
  ChevronDownSmallIcon,
} from './icons';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { cn } from '../lib/cn';

/* ------------------------------------------------------------------ */
/*  Slot colors & metadata                                            */
/* ------------------------------------------------------------------ */

/**
 * Per-slot accent colors, shared by the header chips, steppers, and the
 * distribution bar. Grouped by intent so the panel reads at a glance:
 * offensive slots (bonus/daring/speed/aiming) use a hot red→gold ramp,
 * defensive slots (parry/control) use cool blues.
 */
const SLOT_COLORS: Record<AllocSlot, string> = {
  // Offense — warm
  bonus: '#ff5555',
  daring: '#ff8042',
  speed: '#ffb13d',
  aiming: '#ffd633',
  // Defense — cool
  parry: '#38bdf8',
  control: '#5b7cfa',
};

/**
 * Per-element colors for the magic tab — each evokes its element so the
 * chips, steppers, and distribution bar read at a glance: airy pale cyan,
 * a fiery orange-red, ocean blue, and an earthy green. All kept bright/
 * saturated enough to stay legible as filled header chips.
 */
const MAGIC_SLOT_COLORS: Record<MagicSlot, string> = {
  air: '#a5f3fc',
  fire: '#ff5e3a',
  water: '#2596e8',
  earth: '#84cc16',
};

const NULL_COLOR = '#44475a';
const UNSPENT_COLOR = '#f1fa8c';
const OVERSPENT_COLOR = '#ff5555';

interface SlotMeta {
  key: string;
  label: string;
  color: string;
}

const COMBAT_SLOT_META: SlotMeta[] = ALLOC_SLOTS.map((s) => ({
  key: s,
  label: SLOT_SHORT[s].toUpperCase(),
  color: SLOT_COLORS[s],
}));

const MAGIC_SLOT_META: SlotMeta[] = MAGIC_SLOTS.map((s) => ({
  key: s,
  label: MAGIC_SLOT_SHORT[s].toUpperCase(),
  color: MAGIC_SLOT_COLORS[s],
}));

const gridStyle = (cols: number) => ({
  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
});

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

/** Dropdown menu for "Save to Profile" action. */
function SaveProfileMenu({
  profiles,
  onNew,
  onUpdate,
}: {
  profiles: { id: string; name: string }[];
  onNew: () => void;
  onUpdate: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border border-border-dim text-text-dim hover:text-text-label hover:border-border"
        title="Save live allocations to a profile"
      >
        Save to Profile <ChevronDownSmallIcon size={8} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 min-w-[140px] max-h-[200px] overflow-auto bg-bg-primary border border-border rounded shadow-lg z-50">
          <button
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex items-center gap-1 w-full px-2 py-1 text-[10px] text-left text-text-label hover:bg-bg-secondary/60 cursor-pointer transition-colors"
          >
            <PlusIcon size={8} /> New Profile
          </button>
          {profiles.length > 0 && <div className="h-px bg-border-dim mx-1" />}
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onUpdate(p.id);
                setOpen(false);
              }}
              className="flex items-center gap-1 w-full px-2 py-1 text-[10px] text-left text-text-label hover:bg-bg-secondary/60 cursor-pointer transition-colors truncate"
              title={`Overwrite "${p.name}" with live values`}
            >
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type AllocPanelProps = PinnablePanelProps;

const ACCENT = '#e06c75';
const MAGIC_ACCENT = '#bd93f9';

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
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={cn(
          'text-[11px] truncate cursor-pointer transition-colors duration-100',
          value
            ? 'text-text-heading hover:text-text-primary'
            : 'text-text-dim hover:text-text-label italic',
          className
        )}
        title={value || placeholder}
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
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn(
        'bg-bg-canvas border border-border rounded px-1 py-0 text-[11px] text-text-primary outline-none',
        className
      )}
      style={accent ? { borderColor: `${accent}60` } : undefined}
      placeholder={placeholder}
    />
  );
}

/** Profile name with dropdown switcher. Click name to rename, chevron to switch. */
function ProfileSelector({
  profiles,
  currentIndex,
  onSelect,
  onRename,
  accent,
}: {
  profiles: { id: string; name: string }[];
  currentIndex: number;
  onSelect: (idx: number) => void;
  onRename: (id: string, name: string) => void;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = profiles[currentIndex] ?? null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!current) {
    return <span className="flex-1 text-[11px] text-text-dim italic min-w-0">no profiles</span>;
  }

  return (
    <div className="relative flex items-center flex-1 min-w-0 gap-0" ref={menuRef}>
      <InlineField
        value={current.name}
        placeholder="name"
        onSave={(v) => onRename(current.id, v)}
        className="flex-1 min-w-0 font-semibold"
        accent={accent}
      />
      {profiles.length > 1 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center justify-center w-[16px] h-[16px] rounded shrink-0 cursor-pointer transition-colors',
            open ? 'text-text-primary' : 'text-text-dim hover:text-text-primary'
          )}
          title={`Switch profile (${profiles.length})`}
        >
          <ChevronDownSmallIcon size={10} />
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[160px] max-h-[240px] overflow-auto bg-bg-primary border border-border rounded shadow-lg z-50">
          {profiles.map((p, idx) => (
            <button
              key={p.id}
              onClick={() => {
                onSelect(idx);
                setOpen(false);
              }}
              className={cn(
                'flex items-center w-full px-2 py-1 text-[10px] text-left cursor-pointer transition-colors truncate',
                idx === currentIndex
                  ? 'font-semibold'
                  : 'text-text-label hover:bg-bg-secondary/60'
              )}
              style={
                idx === currentIndex
                  ? { color: accent, background: `${accent}10` }
                  : undefined
              }
            >
              <span className="truncate">{p.name || 'unnamed'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One slot's value control: −/value/+ in a compact box.
 * Click the value to type an exact number; −/+ step by 1 (shift = ×5).
 * The box's bottom border is tinted with the slot color so columns stay
 * identifiable under the sticky letter header.
 */
function ValueStepper({
  value,
  color,
  readOnly,
  onChange,
  onDelta,
}: {
  value: number;
  color: string;
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

  const handleDelta = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    const mult = e.shiftKey ? 5 : 1;
    onDelta?.(delta * mult);
  };

  return (
    <div
      className="flex items-stretch h-[28px] rounded border border-border-dim bg-bg-canvas/40 overflow-hidden"
      style={{ borderBottomColor: color, borderBottomWidth: 2 }}
    >
      {!readOnly && (
        <button
          onClick={(e) => handleDelta(e, -1)}
          className="w-[12px] shrink-0 flex items-center justify-center text-[12px] leading-none text-text-dim hover:text-red hover:bg-bg-secondary cursor-pointer transition-colors"
          title="− 1 (shift: − 5)"
        >
          −
        </button>
      )}
      {editing ? (
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
            if (e.key === 'Escape') {
              setDraft(String(value));
              setEditing(false);
            }
          }}
          className="flex-1 min-w-0 w-full text-center text-[9px] font-mono tabular-nums tracking-tight bg-bg-canvas text-text-primary outline-none px-0 border-x border-border"
        />
      ) : (
        <button
          onClick={() => {
            if (readOnly) return;
            setDraft(String(value));
            setEditing(true);
          }}
          className={cn(
            'flex-1 min-w-0 text-center text-[9px] font-mono tabular-nums tracking-tight px-0 truncate',
            readOnly
              ? 'text-text-dim cursor-default'
              : 'text-text-primary hover:bg-bg-secondary cursor-text transition-colors'
          )}
          title={readOnly ? undefined : 'Click to type an exact value'}
        >
          {value}
        </button>
      )}
      {!readOnly && (
        <button
          onClick={(e) => handleDelta(e, 1)}
          className="w-[12px] shrink-0 flex items-center justify-center text-[12px] leading-none text-text-dim hover:text-green hover:bg-bg-secondary cursor-pointer transition-colors"
          title="+ 1 (shift: + 5)"
        >
          +
        </button>
      )}
    </div>
  );
}

/**
 * Sticky column header: the slot letters (which label every limb row below),
 * with optional bulk −/+ buttons that adjust that slot across all limbs at once.
 */
function SlotHeaderRow({
  cols,
  slots,
  onSlotDelta,
}: {
  cols: number;
  slots: SlotMeta[];
  onSlotDelta?: (key: string, delta: number) => void;
}) {
  const handleDelta = (e: React.MouseEvent, key: string, delta: number) => {
    e.stopPropagation();
    const mult = e.shiftKey ? 5 : 1;
    onSlotDelta?.(key, delta * mult);
  };

  return (
    <div className="shrink-0 px-2 pt-1.5 pb-1 border-b border-border-dim">
      {onSlotDelta && (
        <div className="text-[8px] uppercase tracking-wider text-text-dim mb-0.5">
          Adjust all limbs
        </div>
      )}
      <div className="grid gap-x-[3px]" style={gridStyle(cols)}>
        {slots.map((s) => (
          <div key={s.key} className="flex flex-col items-center gap-0.5 min-w-0">
            <span
              className="w-full text-center text-[9px] font-bold uppercase leading-none rounded-sm px-1 py-[3px]"
              style={{ background: s.color, color: '#040404' }}
              title={s.key}
            >
              {s.label}
            </span>
            {onSlotDelta && (
              <div className="flex w-full rounded border border-border-dim overflow-hidden">
                <button
                  onClick={(e) => handleDelta(e, s.key, -1)}
                  className="flex-1 h-[16px] flex items-center justify-center text-[11px] leading-none text-text-dim hover:text-red hover:bg-bg-secondary cursor-pointer transition-colors"
                  title="All limbs − 1 (shift: − 5)"
                >
                  −
                </button>
                <div className="w-px bg-border-dim" />
                <button
                  onClick={(e) => handleDelta(e, s.key, 1)}
                  className="flex-1 h-[16px] flex items-center justify-center text-[11px] leading-none text-text-dim hover:text-green hover:bg-bg-secondary cursor-pointer transition-colors"
                  title="All limbs + 1 (shift: + 5)"
                >
                  +
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One limb (or the magic "elemental" set): name + unspent + Apply on a title
 * line, then a single full-width row of value steppers, then the distribution
 * bar. Columns align with the sticky SlotHeaderRow above.
 */
function LimbRow({
  name,
  cols,
  slots,
  getValue,
  unspent,
  unspentLabel,
  bar,
  readOnly,
  onApply,
  onSlotChange,
  onSlotDelta,
}: {
  name: string;
  cols: number;
  slots: SlotMeta[];
  getValue: (key: string) => number;
  unspent: number;
  unspentLabel: string;
  bar: React.ReactNode;
  readOnly?: boolean;
  onApply?: () => void;
  onSlotChange?: (key: string, v: number) => void;
  onSlotDelta?: (key: string, delta: number) => void;
}) {
  return (
    <div className="py-1.5 border-b border-border-dim/40 last:border-b-0">
      <div className="flex items-center gap-1.5 mb-1 px-0.5">
        <span
          className="flex-1 min-w-0 text-[10px] font-semibold text-text-heading truncate"
          title={name}
        >
          {name}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[9px] text-text-dim">
          {unspentLabel}{' '}
          <span
            className="font-mono"
            style={{
              color: unspent < 0 ? OVERSPENT_COLOR : unspent > 0 ? UNSPENT_COLOR : undefined,
            }}
          >
            {unspent}
          </span>
        </span>
        {onApply && (
          <button
            onClick={onApply}
            className="shrink-0 flex items-center justify-center w-[22px] h-[18px] rounded text-text-dim hover:text-green hover:bg-green/10 cursor-pointer transition-colors"
            title={`Apply ${name}`}
          >
            <CheckIcon size={11} />
          </button>
        )}
      </div>
      <div className="grid gap-x-[3px]" style={gridStyle(cols)}>
        {slots.map((s) => (
          <ValueStepper
            key={s.key}
            value={getValue(s.key)}
            color={s.color}
            readOnly={readOnly}
            onChange={(v) => onSlotChange?.(s.key, v)}
            onDelta={(d) => onSlotDelta?.(s.key, d)}
          />
        ))}
      </div>
      <div className="mt-1">{bar}</div>
    </div>
  );
}

/** Thin colored bar showing point distribution per limb. */
function PointBar({ alloc }: { alloc: LimbAllocation }) {
  const n = calcNull(alloc);
  const segments: { slot: string; value: number; color: string }[] = [
    ...ALLOC_SLOTS.map((s) => ({ slot: s, value: alloc[s], color: SLOT_COLORS[s] })),
    { slot: 'n', value: n, color: NULL_COLOR },
  ];

  return (
    <div className="flex h-[3px] rounded-full overflow-hidden bg-bg-canvas/50">
      {segments.map(({ slot, value, color }) =>
        value > 0 ? (
          <div
            key={slot}
            style={{ width: `${(value / POINTS_PER_LIMB) * 100}%`, backgroundColor: color }}
          />
        ) : null
      )}
    </div>
  );
}

/** Thin colored bar showing magic point distribution. */
function MagicPointBar({ alloc }: { alloc: MagicAllocation }) {
  const arcane = calcArcane(alloc);
  const segments: { slot: string; value: number; color: string }[] = [
    ...MAGIC_SLOTS.map((s) => ({ slot: s, value: alloc[s], color: MAGIC_SLOT_COLORS[s] })),
    { slot: 'arcane', value: arcane, color: NULL_COLOR },
  ];

  return (
    <div className="flex h-[3px] rounded-full overflow-hidden bg-bg-canvas/50">
      {segments.map(({ slot, value, color }) =>
        value > 0 ? (
          <div
            key={slot}
            style={{ width: `${(value / MAGIC_POINTS) * 100}%`, backgroundColor: color }}
          />
        ) : null
      )}
    </div>
  );
}

/** View toggle pills (Live / Profiles). */
function ViewToggle({
  view,
  onSetView,
  accent,
}: {
  view: AllocView;
  onSetView: (v: AllocView) => void;
  accent?: string;
}) {
  const color = accent ?? ACCENT;
  return (
    <div className="flex rounded overflow-hidden border border-border-dim">
      <button
        onClick={() => onSetView('live')}
        className={cn(
          'px-2 py-[1px] text-[10px] font-semibold cursor-pointer transition-colors duration-100',
          view === 'live' ? '' : 'text-text-dim hover:text-text-label'
        )}
        style={view === 'live' ? { background: `${color}15`, color } : undefined}
      >
        Live
      </button>
      <button
        onClick={() => onSetView('profiles')}
        className={cn(
          'px-2 py-[1px] text-[10px] font-semibold cursor-pointer transition-colors duration-100 border-l border-border-dim',
          view === 'profiles' ? '' : 'text-text-dim hover:text-text-label'
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
          tab === 'combat' ? '' : 'text-text-dim hover:text-text-label'
        )}
        style={tab === 'combat' ? { background: `${ACCENT}15`, color: ACCENT } : undefined}
      >
        Combat
      </button>
      <button
        onClick={() => onSetTab('magic')}
        className={cn(
          'px-2 py-[1px] text-[10px] font-semibold cursor-pointer transition-colors duration-100 border-l border-border-dim',
          tab === 'magic' ? '' : 'text-text-dim hover:text-text-label'
        )}
        style={
          tab === 'magic' ? { background: `${MAGIC_ACCENT}15`, color: MAGIC_ACCENT } : undefined
        }
      >
        Magic
      </button>
    </div>
  );
}

/** Sticky bottom action bar. */
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-t border-border-dim bg-bg-primary">
      {children}
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
    setLiveAllLimbsSlotDelta,
    applyLiveLimb,
    applyLiveAll,
    createProfileFromLive,
    updateProfileFromLive,
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
    <div className="flex-1 flex flex-col min-h-0">
      <SlotHeaderRow
        cols={6}
        slots={COMBAT_SLOT_META}
        onSlotDelta={(slot, delta) => setLiveAllLimbsSlotDelta(slot as AllocSlot, delta)}
      />
      <div className="flex-1 overflow-auto px-2">
        {limbNames.map((limb) => {
          const alloc = live[limb] ?? EMPTY_LIMB;
          return (
            <LimbRow
              key={limb}
              name={limb}
              cols={6}
              slots={COMBAT_SLOT_META}
              getValue={(slot) => alloc[slot as AllocSlot]}
              unspent={calcNull(alloc)}
              unspentLabel="unspent"
              bar={<PointBar alloc={alloc} />}
              onApply={() => applyLiveLimb(limb)}
              onSlotChange={(slot, v) => updateLiveLimbSlot(limb, slot as AllocSlot, v)}
              onSlotDelta={(slot, d) => setLiveLimbSlotDelta(limb, slot as AllocSlot, d)}
            />
          );
        })}
      </div>
      <ActionBar>
        <button
          onClick={() => applyLiveAll()}
          className="flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
          style={{ color: ACCENT, borderColor: `${ACCENT}40`, background: `${ACCENT}10` }}
          title="Apply all limbs to MUD"
        >
          Apply All
        </button>
        <div className="ml-auto">
          <SaveProfileMenu
            profiles={data.profiles}
            onNew={() => createProfileFromLive()}
            onUpdate={(id) => updateProfileFromLive(id)}
          />
        </div>
      </ActionBar>
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
    setCurrentProfileIndex,
    createProfile,
    deleteProfile,
    duplicateProfile,
    renameProfile,
    updateLimbSlot,
    setLimbSlotDelta,
    setAllLimbsSlotDelta,
    applyLimb,
    applyAll,
    loadProfileToLive,
  } = useAllocContext();

  // Use detectedLimbs for canonical ordering; fall back to profile keys for limbs not yet detected
  const limbNames =
    data.detectedLimbs.length > 0
      ? data.detectedLimbs
      : currentProfile
        ? Object.keys(currentProfile.limbs)
        : [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Profile navigation row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-dim shrink-0">
        <ProfileSelector
          profiles={data.profiles}
          currentIndex={data.currentProfileIndex}
          onSelect={setCurrentProfileIndex}
          onRename={renameProfile}
          accent={ACCENT}
        />

        <div className="w-px h-3 bg-border-dim mx-0.5" />

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
            <ConfirmDeleteButton
              key={currentProfile.id}
              onDelete={() => deleteProfile(currentProfile.id)}
              size={10}
              variant="fixed"
            />
          </>
        )}
      </div>

      {!currentProfile ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-dim text-[11px] gap-2">
          <p>No allocation profiles yet.</p>
          <button
            onClick={() => createProfile()}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border border-border-dim hover:border-border text-text-label hover:text-text-primary transition-colors"
          >
            <PlusIcon size={10} /> Create Profile
          </button>
        </div>
      ) : (
        <>
          <SlotHeaderRow
            cols={6}
            slots={COMBAT_SLOT_META}
            onSlotDelta={(slot, delta) =>
              setAllLimbsSlotDelta(currentProfile.id, slot as AllocSlot, delta)
            }
          />
          <div className="flex-1 overflow-auto px-2">
            {limbNames.map((limb) => {
              const alloc = currentProfile.limbs[limb];
              if (!alloc) return null;
              return (
                <LimbRow
                  key={limb}
                  name={limb}
                  cols={6}
                  slots={COMBAT_SLOT_META}
                  getValue={(slot) => alloc[slot as AllocSlot]}
                  unspent={calcNull(alloc)}
                  unspentLabel="unspent"
                  bar={<PointBar alloc={alloc} />}
                  onApply={() => applyLimb(currentProfile.id, limb)}
                  onSlotChange={(slot, v) =>
                    updateLimbSlot(currentProfile.id, limb, slot as AllocSlot, v)
                  }
                  onSlotDelta={(slot, d) =>
                    setLimbSlotDelta(currentProfile.id, limb, slot as AllocSlot, d)
                  }
                />
              );
            })}
          </div>
          <ActionBar>
            {currentProfile.isActive && (
              <span
                className="flex items-center gap-1 text-[10px] font-semibold"
                style={{ color: '#50fa7b' }}
              >
                <CheckIcon size={9} /> Active
              </span>
            )}
            <button
              onClick={() => applyAll(currentProfile.id)}
              className="ml-auto flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
              style={{ color: ACCENT, borderColor: `${ACCENT}40`, background: `${ACCENT}10` }}
              title="Apply all limbs"
            >
              Apply All
            </button>
          </ActionBar>
        </>
      )}
    </div>
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
    updateMagicProfileFromLive,
  } = useAllocContext();

  const alloc = magicData.liveAllocation;
  const hasValues = MAGIC_SLOTS.some((s) => alloc[s] > 0) || calcArcane(alloc) > 0;

  if (!hasValues) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-[11px] px-4 text-center">
        No magic allocations detected yet. Connect and log in to detect your elemental affinity.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <SlotHeaderRow cols={4} slots={MAGIC_SLOT_META} />
      <div className="flex-1 overflow-auto px-2">
        <LimbRow
          name="elemental"
          cols={4}
          slots={MAGIC_SLOT_META}
          getValue={(slot) => alloc[slot as MagicSlot]}
          unspent={calcArcane(alloc)}
          unspentLabel="arcane"
          bar={<MagicPointBar alloc={alloc} />}
          onApply={() => applyMagicLive()}
          onSlotChange={(slot, v) => updateMagicLiveSlot(slot as MagicSlot, v)}
          onSlotDelta={(slot, d) => setMagicLiveSlotDelta(slot as MagicSlot, d)}
        />
      </div>
      <ActionBar>
        <button
          onClick={() => applyMagicLive()}
          className="flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
          style={{
            color: MAGIC_ACCENT,
            borderColor: `${MAGIC_ACCENT}40`,
            background: `${MAGIC_ACCENT}10`,
          }}
          title="Apply magic allocation to MUD"
        >
          Apply
        </button>
        <div className="ml-auto">
          <SaveProfileMenu
            profiles={magicData.profiles}
            onNew={() => createMagicProfileFromLive()}
            onUpdate={(id) => updateMagicProfileFromLive(id)}
          />
        </div>
      </ActionBar>
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
    setCurrentMagicProfileIndex,
    createMagicProfile,
    deleteMagicProfile,
    duplicateMagicProfile,
    renameMagicProfile,
    updateMagicProfileSlot,
    setMagicProfileSlotDelta,
    applyMagic,
    loadMagicProfileToLive,
  } = useAllocContext();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Profile navigation row */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-dim shrink-0">
        <ProfileSelector
          profiles={magicData.profiles}
          currentIndex={magicData.currentProfileIndex}
          onSelect={setCurrentMagicProfileIndex}
          onRename={renameMagicProfile}
          accent={MAGIC_ACCENT}
        />

        <div className="w-px h-3 bg-border-dim mx-0.5" />

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
            <ConfirmDeleteButton
              key={currentMagicProfile.id}
              onDelete={() => deleteMagicProfile(currentMagicProfile.id)}
              size={10}
              variant="fixed"
            />
          </>
        )}
      </div>

      {!currentMagicProfile ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-dim text-[11px] gap-2">
          <p>No magic profiles yet.</p>
          <button
            onClick={() => createMagicProfile()}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border border-border-dim hover:border-border text-text-label hover:text-text-primary transition-colors"
          >
            <PlusIcon size={10} /> Create Profile
          </button>
        </div>
      ) : (
        <>
          <SlotHeaderRow cols={4} slots={MAGIC_SLOT_META} />
          <div className="flex-1 overflow-auto px-2">
            <LimbRow
              name="elemental"
              cols={4}
              slots={MAGIC_SLOT_META}
              getValue={(slot) => currentMagicProfile.alloc[slot as MagicSlot]}
              unspent={calcArcane(currentMagicProfile.alloc)}
              unspentLabel="arcane"
              bar={<MagicPointBar alloc={currentMagicProfile.alloc} />}
              onApply={() => applyMagic(currentMagicProfile.id)}
              onSlotChange={(slot, v) =>
                updateMagicProfileSlot(currentMagicProfile.id, slot as MagicSlot, v)
              }
              onSlotDelta={(slot, d) =>
                setMagicProfileSlotDelta(currentMagicProfile.id, slot as MagicSlot, d)
              }
            />
          </div>
          <ActionBar>
            {currentMagicProfile.isActive && (
              <span
                className="flex items-center gap-1 text-[10px] font-semibold"
                style={{ color: '#50fa7b' }}
              >
                <CheckIcon size={9} /> Active
              </span>
            )}
            <button
              onClick={() => applyMagic(currentMagicProfile.id)}
              className="ml-auto flex items-center gap-0.5 px-1.5 py-[2px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-200 border"
              style={{
                color: MAGIC_ACCENT,
                borderColor: `${MAGIC_ACCENT}40`,
                background: `${MAGIC_ACCENT}10`,
              }}
              title="Apply magic allocation"
            >
              Apply
            </button>
          </ActionBar>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Panel                                                         */
/* ------------------------------------------------------------------ */

export function AllocPanel({ mode = 'slideout' }: AllocPanelProps) {
  const isPinned = mode === 'pinned';
  const { view, setView, allocTab, setAllocTab, magicView, setMagicView } =
    useAllocContext();
  const { panelFontSize, allocFontSize, updateAllocFontSize } = useAppSettingsContext();
  const effectiveAllocFontSize = allocFontSize ?? panelFontSize;

  return (
    <div
      className={
        isPinned
          ? 'panel-content h-full flex flex-col overflow-hidden'
          : 'panel-content w-[420px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden'
      }
      style={{ fontSize: effectiveAllocFontSize + 'px' }}
    >
      <PanelHeader icon={<AllocIcon size={12} />} title="Allocations" panel="alloc" mode={mode}>
        <FontSizeControl
          value={effectiveAllocFontSize}
          onChange={updateAllocFontSize}
          onReset={allocFontSize !== null ? () => updateAllocFontSize(null) : undefined}
          globalValue={panelFontSize}
        />
      </PanelHeader>

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
        view === 'live' ? (
          <LiveView />
        ) : (
          <ProfileView />
        )
      ) : magicView === 'live' ? (
        <MagicLiveView />
      ) : (
        <MagicProfileView />
      )}
    </div>
  );
}
