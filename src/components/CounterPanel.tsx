import { useState, useRef, useEffect } from 'react';
import { useImproveCounterContext } from '../contexts/ImproveCounterContext';
import type { ImproveCounter } from '../types/counter';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  PlusIcon,
  TrashIcon,
  RotateCcwIcon,
} from './icons';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';

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
    status === 'running'
      ? 'bg-green'
      : status === 'paused'
        ? 'bg-amber'
        : 'bg-text-dim';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} shrink-0`} />;
}

function InlineEdit({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
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

export function CounterPanel({
  mode = 'slideout',
}: CounterPanelProps) {
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
    setPeriodLength,
    getElapsedMs,
    getPerMinuteRate,
    getPerPeriodRate,
    getPerHourRate,
    getSkillsSorted,
    getSkillPeriodRate,
  } = useImproveCounterContext();

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [periodDraft, setPeriodDraft] = useState(String(periodLengthMinutes));
  const periodInputRef = useRef<HTMLInputElement>(null);

  const isPinned = mode === 'pinned';
  const activeCounter = counters.find((c) => c.id === activeCounterId) ?? null;

  useEffect(() => {
    if (confirmDelete) {
      const t = setTimeout(() => setConfirmDelete(null), 3000);
      return () => clearTimeout(t);
    }
  }, [confirmDelete]);

  useEffect(() => {
    if (confirmClear) {
      const t = setTimeout(() => setConfirmClear(null), 3000);
      return () => clearTimeout(t);
    }
  }, [confirmClear]);

  useEffect(() => {
    if (editingPeriod) periodInputRef.current?.focus();
  }, [editingPeriod]);

  const handleAddCounter = () => {
    const num = counters.length + 1;
    createCounter(`Counter ${num}`);
  };

  // Pin controls (shared between header layouts)
  const pinControls = isPinned ? (
    <PinnedControls />
  ) : (
    <PinMenuButton panel="counter" />
  );

  return (
    <div
      className={panelRootClass(isPinned)}
    >
      {/* Row 1: Counter tabs + pin controls */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {counters.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCounterId(c.id)}
              className={`flex items-center gap-1 px-1.5 py-px text-[9px] font-mono rounded-full border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
                c.id === activeCounterId
                  ? 'bg-amber/15 border-amber/40 text-amber'
                  : 'bg-transparent border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle'
              }`}
            >
              <StatusDot status={c.status} />
              {c.name}
            </button>
          ))}
          <button
            onClick={handleAddCounter}
            title="Add counter"
            className="flex items-center justify-center w-4 h-4 rounded-full border border-border-dim text-text-dim hover:text-amber hover:border-amber/40 cursor-pointer transition-colors duration-150 shrink-0"
          >
            <PlusIcon size={8} />
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {pinControls}
        </div>
      </div>

      {/* Active counter content */}
      {activeCounter ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Controls bar — fixed */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle shrink-0">
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

            {/* Clear */}
            {(activeCounter.totalImps > 0 || activeCounter.accumulatedMs > 0) && (
              confirmClear === activeCounter.id ? (
                <button
                  onClick={() => { clearCounter(activeCounter.id); setConfirmClear(null); }}
                  className="text-[8px] font-mono text-red border border-red/40 rounded px-1 py-px cursor-pointer hover:bg-red/10 transition-colors duration-150"
                >
                  Clear?
                </button>
              ) : (
                <TinyBtn onClick={() => setConfirmClear(activeCounter.id)} title="Clear counter" accent="dim">
                  <RotateCcwIcon size={8} />
                </TinyBtn>
              )
            )}
            {/* Delete */}
            {counters.length > 1 && (
              confirmDelete === activeCounter.id ? (
                <button
                  onClick={() => { deleteCounter(activeCounter.id); setConfirmDelete(null); }}
                  className="text-[8px] font-mono text-red border border-red/40 rounded px-1 py-px cursor-pointer hover:bg-red/10 transition-colors duration-150"
                >
                  Del?
                </button>
              ) : (
                <TinyBtn onClick={() => setConfirmDelete(activeCounter.id)} title="Delete counter" accent="dim">
                  <TrashIcon size={8} />
                </TinyBtn>
              )
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
                  if (e.key === 'Escape') { setPeriodDraft(String(periodLengthMinutes)); setEditingPeriod(false); }
                }}
                className="w-7 text-[9px] font-mono text-text-label bg-bg-secondary border border-border-dim rounded px-0.5 py-px outline-none text-center"
              />
            ) : (
              <button
                onClick={() => { setPeriodDraft(String(periodLengthMinutes)); setEditingPeriod(true); }}
                className="text-[9px] font-mono text-text-dim hover:text-text-label cursor-pointer transition-colors duration-150"
                title="Click to change period length (minutes)"
              >
                {periodLengthMinutes}m
              </button>
            )}
          </div>

          {/* Scrollable: stats + skills together */}
          <div className="flex-1 overflow-y-auto">
            {/* Stats */}
            <div className="px-3 py-2 border-b border-border-subtle">
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
        <span className="text-[12px] font-mono font-semibold text-amber">
          {counter.totalImps.toLocaleString()}
          <span className="text-[9px] text-text-dim font-normal ml-1">imps</span>
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-text-dim">Elapsed</span>
        <span className="text-[10px] font-mono text-text-label">
          {formatCompactDuration(elapsed)}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-text-dim">Current period</span>
        <span className="text-[10px] font-mono text-text-label">{counter.impsInCurrentPeriod}</span>
      </div>
      <div className="h-px bg-border-subtle my-1" />
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
      {skills.map(({ skill, count }) => (
        <div
          key={skill}
          className="flex items-center justify-between px-2 py-0.5 hover:bg-bg-secondary/50 transition-colors duration-100 rounded-sm"
        >
          <span className="text-[11px] text-text-primary truncate mr-2">{skill}</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-mono text-text-label">{count.toLocaleString()}</span>
            <span className="text-[10px] font-mono text-text-dim w-10 text-right">
              ({getRate(skill).toFixed(2)})
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
