import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { StatusReadout } from './StatusReadout';
import type { ThemeColorKey } from '../lib/defaultTheme';
import type { AnsiColorSegment } from '../lib/ansiColorExtract';
import type { FilterFlags } from '../lib/outputFilter';

export type StatusReadoutKey =
  | 'health'
  | 'concentration'
  | 'aura'
  | 'hunger'
  | 'thirst'
  | 'encumbrance'
  | 'movement'
  | 'alignment';

export const DEFAULT_STATUS_BAR_ORDER: StatusReadoutKey[] = [
  'health',
  'concentration',
  'aura',
  'hunger',
  'thirst',
  'encumbrance',
  'movement',
  'alignment',
];

export interface ReadoutData {
  label: string;
  themeColor: ThemeColorKey;
  severity: number;
  descriptor?: string;
  message?: string;
  key?: string;
  /** Optional direct CSS color — bypasses theme lookup when set */
  color?: string;
  /** ANSI color extracted from MUD output — takes priority over color when set */
  mudColor?: ThemeColorKey | null;
  /** Per-word color segments for multi-colored descriptors (e.g. "very dim red") */
  mudColors?: AnsiColorSegment[] | null;
}

export interface ReadoutConfig {
  id: StatusReadoutKey;
  data: ReadoutData | null;
  icon: React.ReactNode;
  tooltip: (data: ReadoutData) => string;
  filterKey?: keyof FilterFlags;
  /** Severity at or above which the readout flashes red */
  dangerThreshold: number;
}

interface SortableStatusBarProps {
  items: ReadoutConfig[];
  order: StatusReadoutKey[];
  onReorder: (newOrder: StatusReadoutKey[]) => void;
  theme: Record<string, string>;
  autoCompact: boolean;
  compactReadouts: Record<string, boolean>;
  filterFlags: FilterFlags;
  toggleFilter: (key: keyof FilterFlags) => void;
  toggleCompactReadout: (key: string) => void;
}

const RAINBOW_COLORS = [
  '#ff2020',
  '#ff6020',
  '#ffa020',
  '#ffe020',
  '#a0ff20',
  '#20ff40',
  '#20ffa0',
  '#20e0ff',
  '#2080ff',
  '#6040ff',
  '#a020ff',
  '#ff20e0',
];

function randomizeColors(length: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < length; i++) {
    let color: string;
    do {
      color = RAINBOW_COLORS[Math.floor(Math.random() * RAINBOW_COLORS.length)];
    } while (i > 0 && color === result[i - 1]);
    result.push(color);
  }
  return result;
}

function RainbowText({ text }: { text: string }) {
  const [colors, setColors] = useState(() => randomizeColors(text.length));
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setColors(randomizeColors(text.length));
    }, 10000);
    return () => clearInterval(intervalRef.current);
  }, [text.length]);

  return (
    <>
      {text.split('').map((ch, i) => (
        <span key={i} style={{ color: colors[i], transition: 'color 0.5s ease' }}>
          {ch}
        </span>
      ))}
    </>
  );
}

function MultiColorText({
  segments,
  theme,
}: {
  segments: AnsiColorSegment[];
  theme: Record<string, string>;
}) {
  return (
    <>
      {segments.map((seg, i) => (
        <span key={i} style={{ color: theme[seg.color] ?? seg.color }}>
          {seg.text}
        </span>
      ))}
    </>
  );
}

function SortableReadout({
  config,
  theme,
  autoCompact,
  compactReadouts,
  filterFlags,
  toggleFilter,
  toggleCompactReadout,
  isDragging: isAnyDragging,
}: {
  config: ReadoutConfig;
  theme: Record<string, string>;
  autoCompact: boolean;
  compactReadouts: Record<string, boolean>;
  filterFlags: FilterFlags;
  toggleFilter: (key: keyof FilterFlags) => void;
  toggleCompactReadout: (key: string) => void;
  isDragging: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSelfDragging,
  } = useSortable({ id: config.id });

  const { data } = config;
  if (!data) return null;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isSelfDragging ? 50 : undefined,
    opacity: isSelfDragging ? 0.8 : 1,
    cursor: isAnyDragging ? 'grabbing' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <StatusReadout
        icon={config.icon}
        label={data.label}
        color={data.mudColor ? theme[data.mudColor] : (data.color ?? theme[data.themeColor])}
        tooltip={config.tooltip(data)}
        glow={data.severity <= 1}
        danger={data.severity >= config.dangerThreshold}
        labelNode={
          data.key === 'scintillating'
            ? <RainbowText text={data.label} />
            : data.mudColors
              ? <MultiColorText segments={data.mudColors} theme={theme} />
              : undefined
        }
        compact={autoCompact || !!compactReadouts[config.id]}
        autoCompact={autoCompact}
        filtered={config.filterKey ? filterFlags[config.filterKey] : undefined}
        onClick={config.filterKey ? () => toggleFilter(config.filterKey!) : undefined}
        onToggleCompact={() => toggleCompactReadout(config.id)}
      />
    </div>
  );
}

export function SortableStatusBar({
  items,
  order,
  onReorder,
  theme,
  autoCompact,
  compactReadouts,
  filterFlags,
  toggleFilter,
  toggleCompactReadout,
}: SortableStatusBarProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Require 5px of movement before starting a drag so clicks still work
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // Build a map for O(1) lookup
  const itemMap = useMemo(() => {
    const map = new Map<StatusReadoutKey, ReadoutConfig>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  // Merge saved order with any new/removed items
  const sortedIds = useMemo(() => {
    const knownIds = new Set(items.map((i) => i.id));
    const result: StatusReadoutKey[] = [];
    // Add items in saved order (skip removed ones)
    for (const id of order) {
      if (knownIds.has(id)) {
        result.push(id);
        knownIds.delete(id);
      }
    }
    // Append any new items not in saved order
    for (const id of knownIds) {
      result.push(id);
    }
    return result;
  }, [order, items]);

  // Only include items that have data (are visible)
  const visibleIds = useMemo(
    () => sortedIds.filter((id) => itemMap.get(id)?.data != null),
    [sortedIds, itemMap]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortedIds.indexOf(active.id as StatusReadoutKey);
      const newIndex = sortedIds.indexOf(over.id as StatusReadoutKey);
      if (oldIndex === -1 || newIndex === -1) return;

      onReorder(arrayMove(sortedIds, oldIndex, newIndex));
    },
    [sortedIds, onReorder]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={visibleIds} strategy={horizontalListSortingStrategy}>
        {visibleIds.map((id) => {
          const config = itemMap.get(id);
          if (!config) return null;
          return (
            <SortableReadout
              key={id}
              config={config}
              theme={theme}
              autoCompact={autoCompact}
              compactReadouts={compactReadouts}
              filterFlags={filterFlags}
              toggleFilter={toggleFilter}
              toggleCompactReadout={toggleCompactReadout}
              isDragging={draggingId != null}
            />
          );
        })}
      </SortableContext>
    </DndContext>
  );
}
