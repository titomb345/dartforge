import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useImproveCounterContext } from '../contexts/ImproveCounterContext';
import type { ImproveCounter } from '../types/counter';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  PlusIcon,
  RotateCcwIcon,
  CounterIcon,
  ArchiveIcon,
  UnarchiveIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from './icons';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { PanelHeader } from './PanelHeader';
import { FontSizeControl } from './FontSizeControl';

type CounterPanelProps = PinnablePanelProps;

function formatCompactDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatusDot({ status }: { status: ImproveCounter['status'] }) {
  const color =
    status === 'running' ? 'bg-green' : status === 'paused' ? 'bg-amber' : 'bg-text-dim';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} shrink-0`} />;
}

function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="text-[11px] font-semibold text-text-heading truncate cursor-pointer hover:text-text-primary transition-colors duration-100"
        title="Click to rename"
      >
        {value}
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
        if (trimmed && trimmed !== value) onSave(trimmed);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="text-[11px] font-semibold text-text-heading bg-bg-secondary border border-border-dim rounded px-1 py-px outline-none w-full"
    />
  );
}

/* ── Sortable counter pill ──────────────────────────────────── */

function SortableCounterPill({
  counter,
  isActive,
  onClick,
  isAnyDragging,
}: {
  counter: ImproveCounter;
  isActive: boolean;
  onClick: () => void;
  isAnyDragging: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSelfDragging,
  } = useSortable({ id: counter.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition,
    zIndex: isSelfDragging ? 50 : undefined,
    opacity: isSelfDragging ? 0.8 : 1,
    cursor: isAnyDragging ? 'grabbing' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <button
        onClick={onClick}
        className={`flex items-center gap-1 px-1.5 py-px text-[9px] font-mono rounded-full border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
          isActive
            ? 'bg-amber/15 border-amber/40 text-amber'
            : 'bg-transparent border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle'
        }`}
      >
        <StatusDot status={counter.status} />
        {counter.name}
      </button>
    </div>
  );
}

export function CounterPanel({ mode = 'slideout' }: CounterPanelProps) {
  const {
    counters,
    activeCounterId,
    periodLengthMinutes,
    setActiveCounterId,
    createCounter,
    deleteCounter,
    renameCounter,
    startCounter,
    pauseCounter,
    resumeCounter,
    stopCounter,
    clearCounter,
    archiveCounter,
    unarchiveCounter,
    reorderCounters,
    setPeriodLength,
    getElapsedMs,
    getPerMinuteRate,
    getPerPeriodRate,
    getPerHourRate,
    getSkillsSorted,
    getSkillPeriodRate,
  } = useImproveCounterContext();

  const [editingPeriod, setEditingPeriod] = useState(false);
  const [periodDraft, setPeriodDraft] = useState(String(periodLengthMinutes));
  const periodInputRef = useRef<HTMLInputElement>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const { panelFontSize, updatePanelFontSize } = useAppSettingsContext();

  const isPinned = mode === 'pinned';

  // Split counters into active vs archived, sort active by order
  const activeCounters = useMemo(
    () =>
      counters
        .filter((c) => !c.archived)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [counters]
  );
  const archivedCounters = useMemo(
    () => counters.filter((c) => c.archived),
    [counters]
  );

  const activeCounter = counters.find((c) => c.id === activeCounterId) ?? null;

  useEffect(() => {
    if (editingPeriod) periodInputRef.current?.focus();
  }, [editingPeriod]);

  const handleAddCounter = () => {
    const num = counters.length + 1;
    createCounter(`Counter ${num}`);
  };

  // Drag-and-drop for counter pills
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const activeIds = useMemo(() => activeCounters.map((c) => c.id), [activeCounters]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = activeIds.indexOf(String(active.id));
      const newIndex = activeIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      reorderCounters(arrayMove(activeIds, oldIndex, newIndex));
    },
    [activeIds, reorderCounters]
  );

  return (
    <div className={panelRootClass(isPinned)}>
      <PanelHeader icon={<CounterIcon size={12} />} title="Counters" panel="counter" mode={mode}>
        <FontSizeControl value={panelFontSize} onChange={updatePanelFontSize} />
      </PanelHeader>
      {/* Counter tabs — drag-and-drop sortable */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={activeIds} strategy={horizontalListSortingStrategy}>
              {activeCounters.map((c) => (
                <SortableCounterPill
                  key={c.id}
                  counter={c}
                  isActive={c.id === activeCounterId}
                  onClick={() => setActiveCounterId(c.id)}
                  isAnyDragging={draggingId != null}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button
            onClick={handleAddCounter}
            title="Add counter"
            className="flex items-center justify-center w-4 h-4 rounded-full border border-border-dim text-text-dim hover:text-amber hover:border-amber/40 cursor-pointer transition-colors duration-150 shrink-0"
          >
            <PlusIcon size={8} />
          </button>
        </div>
        {/* Archive dropdown toggle */}
        {archivedCounters.length > 0 && (
          <button
            onClick={() => setArchiveOpen((o) => !o)}
            title={archiveOpen ? 'Hide archived' : `Show archived (${archivedCounters.length})`}
            className="flex items-center gap-0.5 px-1 py-px text-[8px] font-mono text-text-dim hover:text-text-label cursor-pointer transition-colors duration-150 shrink-0"
          >
            <ArchiveIcon size={9} />
            {archiveOpen ? <ChevronUpIcon size={7} /> : <ChevronDownIcon size={7} />}
          </button>
        )}
      </div>

      {/* Archived counters dropdown */}
      {archiveOpen && archivedCounters.length > 0 && (
        <div className="border-b border-border-subtle bg-bg-secondary/30 max-h-40 overflow-y-auto">
          <div className="px-2 py-1 text-[8px] font-mono text-text-dim uppercase tracking-wider">
            Archived
          </div>
          {archivedCounters.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-1.5 px-2 py-1 hover:bg-bg-secondary/50"
            >
              <button
                onClick={() => {
                  setActiveCounterId(c.id);
                }}
                className="flex-1 min-w-0 text-left text-[10px] font-mono text-text-dim truncate cursor-pointer hover:text-text-label transition-colors duration-100"
              >
                {c.name}
              </button>
              <span className="text-[9px] font-mono text-text-dim shrink-0">
                {c.totalImps.toLocaleString()} imps
              </span>
              <span className="text-[9px] font-mono text-text-dim shrink-0">
                {formatCompactDuration(c.accumulatedMs)}
              </span>
              <button
                onClick={() => unarchiveCounter(c.id)}
                title="Unarchive"
                className="flex items-center justify-center w-3.5 h-3.5 text-text-dim hover:text-green cursor-pointer transition-colors duration-150 shrink-0"
              >
                <UnarchiveIcon size={8} />
              </button>
              <ConfirmDeleteButton
                onDelete={() => deleteCounter(c.id)}
                size={8}
                variant="fixed"
              />
            </div>
          ))}
        </div>
      )}

      {/* Active counter content */}
      {activeCounter && !activeCounter.archived ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Controls bar — fixed */}
          <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0">
            {/* Play/Pause */}
            {activeCounter.status === 'running' ? (
              <TinyBtn onClick={() => pauseCounter(activeCounter.id)} title="Pause" accent="amber">
                <PauseIcon size={8} />
              </TinyBtn>
            ) : (
              <TinyBtn
                onClick={() =>
                  activeCounter.status === 'paused'
                    ? resumeCounter(activeCounter.id)
                    : startCounter(activeCounter.id)
                }
                title={activeCounter.status === 'paused' ? 'Resume' : 'Start'}
                accent="green"
              >
                <PlayIcon size={8} />
              </TinyBtn>
            )}
            {/* Stop */}
            {(activeCounter.status === 'running' || activeCounter.status === 'paused') && (
              <TinyBtn onClick={() => stopCounter(activeCounter.id)} title="Stop" accent="red">
                <StopIcon size={7} />
              </TinyBtn>
            )}

            {/* Counter name */}
            <div className="flex-1 min-w-0 mx-0.5">
              <InlineEdit
                value={activeCounter.name}
                onSave={(name) => renameCounter(activeCounter.id, name)}
              />
            </div>

            {/* Archive */}
            {activeCounters.length > 1 && (
              <button
                onClick={() => archiveCounter(activeCounter.id)}
                title="Archive counter"
                className="flex items-center justify-center w-5 h-5 rounded text-text-dim hover:text-text-label hover:bg-bg-secondary/60 cursor-pointer transition-colors duration-150 shrink-0"
              >
                <ArchiveIcon size={8} />
              </button>
            )}
            {/* Clear */}
            {(activeCounter.totalImps > 0 || activeCounter.accumulatedMs > 0) && (
              <ConfirmDeleteButton
                key={`clear-${activeCounter.id}`}
                onDelete={() => clearCounter(activeCounter.id)}
                icon={<RotateCcwIcon size={10} />}
                confirmText="Clear?"
                title="Clear counter"
                variant="fixed"
              />
            )}
            {/* Delete */}
            {activeCounters.length > 1 && (
              <ConfirmDeleteButton
                key={activeCounter.id}
                onDelete={() => deleteCounter(activeCounter.id)}
                size={10}
                variant="fixed"
              />
            )}
            {/* Period config */}
            {editingPeriod ? (
              <input
                ref={periodInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={periodDraft}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setPeriodDraft(v);
                }}
                onBlur={() => {
                  const val = parseInt(periodDraft, 10);
                  if (!isNaN(val) && val >= 1 && val <= 60) setPeriodLength(val);
                  else setPeriodDraft(String(periodLengthMinutes));
                  setEditingPeriod(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    setPeriodDraft(String(periodLengthMinutes));
                    setEditingPeriod(false);
                  }
                }}
                className="w-7 text-[9px] font-mono text-text-label bg-bg-secondary border border-border-dim rounded px-0.5 py-px outline-none text-center"
              />
            ) : (
              <button
                onClick={() => {
                  setPeriodDraft(String(periodLengthMinutes));
                  setEditingPeriod(true);
                }}
                className="text-[9px] font-mono text-text-dim hover:text-text-label cursor-pointer transition-colors duration-150"
                title="Click to change period length (minutes)"
              >
                {periodLengthMinutes}m
              </button>
            )}
          </div>

          {/* Scrollable: stats + skills together */}
          <div className="flex-1 overflow-y-auto" style={{ fontSize: panelFontSize + 'px' }}>
            {/* Stats */}
            <div className="px-2 py-1.5 border-b border-border-subtle">
              <CounterStats
                counter={activeCounter}
                elapsed={getElapsedMs(activeCounter)}
                perMinute={getPerMinuteRate(activeCounter)}
                perPeriod={getPerPeriodRate(activeCounter)}
                perHour={getPerHourRate(activeCounter)}
                periodLabel={`${periodLengthMinutes}m`}
              />
            </div>
            {/* Skills */}
            <SkillsTable
              counter={activeCounter}
              skills={getSkillsSorted(activeCounter)}
              getRate={(skill) => getSkillPeriodRate(activeCounter, skill)}
            />
          </div>
        </div>
      ) : activeCounter && activeCounter.archived ? (
        /* Viewing an archived counter (read-only) */
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle shrink-0">
            <span className="text-[11px] font-semibold text-text-dim truncate flex-1">
              {activeCounter.name}
              <span className="text-[9px] text-text-dim ml-1">(archived)</span>
            </span>
            <button
              onClick={() => unarchiveCounter(activeCounter.id)}
              title="Unarchive"
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono text-text-dim hover:text-green border border-border-dim hover:border-green/30 rounded cursor-pointer transition-colors duration-150"
            >
              <UnarchiveIcon size={8} />
              Restore
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ fontSize: panelFontSize + 'px' }}>
            <div className="px-2 py-1.5 border-b border-border-subtle">
              <CounterStats
                counter={activeCounter}
                elapsed={getElapsedMs(activeCounter)}
                perMinute={getPerMinuteRate(activeCounter)}
                perPeriod={getPerPeriodRate(activeCounter)}
                perHour={getPerHourRate(activeCounter)}
                periodLabel={`${periodLengthMinutes}m`}
              />
            </div>
            <SkillsTable
              counter={activeCounter}
              skills={getSkillsSorted(activeCounter)}
              getRate={(skill) => getSkillPeriodRate(activeCounter, skill)}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <p className="text-[11px] text-text-dim mb-2">No counters yet.</p>
            <button
              onClick={handleAddCounter}
              className="text-[10px] font-mono text-amber border border-amber/40 rounded px-2 py-1 cursor-pointer hover:bg-amber/10 transition-colors duration-150"
            >
              + Create Counter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TinyBtn({
  onClick,
  title,
  accent,
  children,
}: {
  onClick: () => void;
  title: string;
  accent: 'green' | 'amber' | 'red' | 'dim';
  children: React.ReactNode;
}) {
  const colorMap = {
    green: 'text-green hover:bg-green/10 border-green/30',
    amber: 'text-amber hover:bg-amber/10 border-amber/30',
    red: 'text-red hover:bg-red/10 border-red/30',
    dim: 'text-text-dim hover:text-text-label hover:bg-bg-secondary border-border-dim',
  };
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center w-5 h-5 rounded border cursor-pointer transition-colors duration-150 shrink-0 ${colorMap[accent]}`}
    >
      {children}
    </button>
  );
}

function CounterStats({
  counter,
  elapsed,
  perMinute,
  perPeriod,
  perHour,
  periodLabel,
}: {
  counter: ImproveCounter;
  elapsed: number;
  perMinute: number;
  perPeriod: number;
  perHour: number;
  periodLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-text-dim">Total</span>
        <span className="text-[11px] font-mono text-text-label">
          <span className="font-semibold text-amber">{counter.totalImps.toLocaleString()}</span>
          <span className="text-[9px] text-text-dim ml-0.5">imps</span>
          <span className="text-text-dim mx-1">·</span>
          {formatCompactDuration(elapsed)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <RateStat label="/min" value={perMinute} />
        <RateStat label={`/${periodLabel}`} value={perPeriod} />
        <RateStat label="/hr" value={perHour} />
      </div>
    </div>
  );
}

function RateStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[12px] font-mono font-semibold text-text-primary">
        {value.toFixed(1)}
      </div>
      <div className="text-[8px] text-text-dim uppercase tracking-wider">{label}</div>
    </div>
  );
}

function SkillsTable({
  counter,
  skills,
  getRate,
}: {
  counter: ImproveCounter;
  skills: { skill: string; count: number }[];
  getRate: (skill: string) => number;
}) {
  const { counterHotThreshold, counterColdThreshold } = useAppSettingsContext();

  if (skills.length === 0) {
    return (
      <div className="px-3 py-4 text-[10px] text-text-dim">
        {counter.status === 'stopped' && counter.totalImps === 0
          ? 'Start the counter and improve skills to begin tracking.'
          : 'No skill improves recorded yet.'}
      </div>
    );
  }

  return (
    <div className="px-1 py-1">
      {skills.map(({ skill, count }) => {
        const rate = getRate(skill);
        const effectClass =
          counterHotThreshold > 0 && rate >= counterHotThreshold
            ? 'skill-hot'
            : counterColdThreshold > 0 && rate > 0 && rate <= counterColdThreshold
              ? 'skill-cold'
              : '';

        return (
          <div
            key={skill}
            className={`flex items-center justify-between px-2 py-0.5 hover:bg-bg-secondary/50 transition-colors duration-100 rounded-sm ${effectClass}`}
          >
            <span className="text-[11px] text-text-primary truncate mr-2">{skill}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-mono text-text-label">
                {count.toLocaleString()}
              </span>
              <span className="skill-rate text-[10px] font-mono text-text-label w-10 text-right">
                ({rate.toFixed(2)})
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
