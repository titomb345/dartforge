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
import { PopoverMenu } from './PopoverMenu';
import { CheckIcon, GearIcon } from './icons';
import type { ThemeColorKey } from '../lib/defaultTheme';
import type { AnsiColorSegment, MudColor } from '../lib/ansiColorExtract';
import { mudColorToCss } from '../lib/ansiColorExtract';
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
  mudColor?: MudColor | null;
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
  /**
   * Un-hide every vital's output lines at once (bar gear menu). Optional:
   * when omitted the bar toggles each hidden filter key individually.
   */
  showAllVitalLines?: () => void;
  /**
   * Compact or expand every visible readout at once (bar gear menu).
   * Optional: when omitted the bar toggles each readout individually.
   */
  setAllCompact?: (compact: boolean) => void;
}

/** Shared chrome for the readout and bar menus (matches QuickButtonBar). */
const MENU_CLASS = 'bg-bg-primary border border-border rounded shadow-lg py-1 min-w-[190px]';
const MENU_ITEM_CLASS =
  'w-full px-3 py-1.5 text-[11px] text-left transition-colors flex items-center gap-2';
const MENU_ITEM_ACTIVE = `${MENU_ITEM_CLASS} text-text-label hover:bg-bg-secondary/60 cursor-pointer`;
const MENU_ITEM_DISABLED = `${MENU_ITEM_CLASS} text-text-dim cursor-default`;
const MENU_HINT_CLASS = 'px-3 pt-1 pb-0.5 text-[10px] text-text-dim italic';

/** Menu row with a fixed-width check column so labels line up. */
function MenuItem({
  checked,
  disabled,
  onClick,
  children,
}: {
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={disabled ? MENU_ITEM_DISABLED : MENU_ITEM_ACTIVE}
    >
      <span className="w-3 h-3 flex items-center justify-center shrink-0 text-green">
        {checked && <CheckIcon size={10} />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function stopPropagation(e: React.SyntheticEvent) {
  e.stopPropagation();
}

/** "hunger" -> "Hunger" for tooltips and menu headers. */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const { data } = config;
  if (!data) return null;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isSelfDragging ? 50 : undefined,
    opacity: isSelfDragging ? 0.8 : 1,
    cursor: isAnyDragging ? 'grabbing' : undefined,
  };

  const vital = config.id;
  const color = mudColorToCss(data.mudColor, theme) ?? data.color ?? theme[data.themeColor];
  const filterKey = config.filterKey;
  const filtered = filterKey ? filterFlags[filterKey] : false;
  const userCompact = !!compactReadouts[vital];
  const compact = autoCompact || userCompact;

  // Tooltip: the vital's message, then a plain statement of what the clicks do.
  const base = config.tooltip(data);
  const hint = filterKey
    ? filtered
      ? `${titleCase(vital)} lines are hidden from the output. Click to show them. Right-click for options.`
      : `Click to hide ${vital} lines from the output. Right-click for options.`
    : 'Right-click for options.';
  const tooltip = base ? `${base}\n${hint}` : hint;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <StatusReadout
        icon={config.icon}
        label={data.label}
        color={color}
        tooltip={tooltip}
        glow={data.severity <= 1}
        danger={data.severity >= config.dangerThreshold}
        labelNode={
          data.key === 'scintillating' ? (
            <RainbowText text={data.label} />
          ) : data.mudColors ? (
            <MultiColorText segments={data.mudColors} theme={theme} />
          ) : undefined
        }
        compact={compact}
        autoCompact={autoCompact}
        filtered={filterKey ? filtered : undefined}
        onClick={filterKey ? () => toggleFilter(filterKey) : undefined}
        onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY })}
      />
      {menu && (
        /*
         * The menu portals to body, but React events still bubble through
         * this tree to the sortable wrapper's dnd-kit listeners. Fence them
         * so a menu click or Space/Enter never starts a drag.
         */
        <span
          className="contents"
          onPointerDown={stopPropagation}
          onKeyDown={stopPropagation}
          onClick={stopPropagation}
          onContextMenu={stopPropagation}
        >
          <PopoverMenu x={menu.x} y={menu.y} onClose={closeMenu} className={MENU_CLASS}>
            <div
              className="px-3 py-1 text-[10px] font-mono font-semibold uppercase tracking-wide truncate border-b border-border-dim mb-0.5"
              style={{ color }}
            >
              {vital}
            </div>
            {filterKey && (
              <MenuItem
                checked={filtered}
                onClick={() => {
                  toggleFilter(filterKey);
                  closeMenu();
                }}
              >
                {filtered ? `Show ${vital} lines in output` : `Hide ${vital} lines in output`}
              </MenuItem>
            )}
            <MenuItem
              checked={userCompact}
              disabled={autoCompact}
              onClick={() => {
                toggleCompactReadout(vital);
                closeMenu();
              }}
            >
              {autoCompact
                ? 'Compact (automatic while the bar is narrow)'
                : userCompact
                  ? 'Expand (show label)'
                  : 'Compact (icon only)'}
            </MenuItem>
            <div className="h-px bg-border-dim mx-1.5 my-0.5" />
            <div className={MENU_HINT_CLASS}>Drag to reorder</div>
          </PopoverMenu>
        </span>
      )}
    </div>
  );
}

/**
 * Small gear at the end of the bar. Dim at rest, opens a menu with the
 * bar-wide versions of the per-readout actions.
 */
function StatusBarGear({
  hiddenCount,
  allCompact,
  autoCompact,
  onShowAll,
  onSetAllCompact,
}: {
  hiddenCount: number;
  allCompact: boolean;
  autoCompact: boolean;
  onShowAll: () => void;
  onSetAllCompact: (compact: boolean) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const btnRef = useRef<HTMLButtonElement>(null);

  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    // Anchor under the button so keyboard activation lands in the same spot.
    setMenu(rect ? { x: rect.left - 4, y: rect.bottom } : { x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={open}
        onContextMenu={open}
        title="Status bar options"
        aria-label="Status bar options"
        aria-haspopup="menu"
        data-help-id="status-bar-gear"
        className={`ml-0.5 w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[4px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan ${
          menu ? 'text-text-label bg-bg-secondary/60' : 'text-text-dim hover:text-text-label'
        }`}
      >
        <GearIcon size={11} />
      </button>
      {menu && (
        <PopoverMenu x={menu.x} y={menu.y} onClose={closeMenu} className={MENU_CLASS}>
          <div className="px-3 py-1 text-[10px] font-mono font-semibold uppercase tracking-wide text-text-muted border-b border-border-dim mb-0.5">
            Status bar
          </div>
          <MenuItem
            disabled={hiddenCount === 0}
            onClick={() => {
              onShowAll();
              closeMenu();
            }}
          >
            {hiddenCount === 0
              ? 'Show all vital lines (none hidden)'
              : `Show all vital lines (${hiddenCount} hidden)`}
          </MenuItem>
          <MenuItem
            disabled={autoCompact}
            onClick={() => {
              onSetAllCompact(!allCompact);
              closeMenu();
            }}
          >
            {autoCompact
              ? 'Compact all (automatic while the bar is narrow)'
              : allCompact
                ? 'Expand all'
                : 'Compact all'}
          </MenuItem>
          <div className="h-px bg-border-dim mx-1.5 my-0.5" />
          <div className={MENU_HINT_CLASS}>Drag a readout to reorder</div>
        </PopoverMenu>
      )}
    </>
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
  showAllVitalLines,
  setAllCompact,
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

  // Bar-wide state for the gear menu
  const hiddenKeys = useMemo(() => {
    const keys: (keyof FilterFlags)[] = [];
    for (const id of visibleIds) {
      const fk = itemMap.get(id)?.filterKey;
      if (fk && filterFlags[fk]) keys.push(fk);
    }
    return keys;
  }, [visibleIds, itemMap, filterFlags]);

  const allCompact = visibleIds.length > 0 && visibleIds.every((id) => !!compactReadouts[id]);

  const handleShowAll = useCallback(() => {
    if (showAllVitalLines) {
      showAllVitalLines();
      return;
    }
    // Each toggle is a functional state update, so several in a row are safe.
    for (const key of hiddenKeys) toggleFilter(key);
  }, [showAllVitalLines, hiddenKeys, toggleFilter]);

  const handleSetAllCompact = useCallback(
    (compact: boolean) => {
      if (setAllCompact) {
        setAllCompact(compact);
        return;
      }
      for (const id of visibleIds) {
        if (!!compactReadouts[id] !== compact) toggleCompactReadout(id);
      }
    },
    [setAllCompact, visibleIds, compactReadouts, toggleCompactReadout]
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
      {visibleIds.length > 0 && (
        <StatusBarGear
          hiddenCount={hiddenKeys.length}
          allCompact={allCompact}
          autoCompact={autoCompact}
          onShowAll={handleShowAll}
          onSetAllCompact={handleSetAllCompact}
        />
      )}
    </DndContext>
  );
}
