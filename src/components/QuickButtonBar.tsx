import { useState, useRef, useCallback } from 'react';
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
import type { QuickButton } from '../types';
import { QuickButtonEditor } from './QuickButtonEditor';
import { PopoverMenu } from './PopoverMenu';
import { PlusIcon } from './icons';

const EDIT_HINT = 'Right click to edit';

interface QuickButtonBarProps {
  buttons: QuickButton[];
  onFire: (body: string, bodyMode: 'commands' | 'script', toggleBtn?: QuickButton) => void;
  onAdd: (data: Omit<QuickButton, 'id'>) => void;
  onUpdate: (id: string, data: Partial<QuickButton>) => void;
  onDelete: (id: string) => void;
  onReorder: (newButtons: QuickButton[]) => void;
  getVariable: (name: string) => string;
}

function SortableQuickButton({
  btn,
  onFire,
  onContextMenu,
  isDragging: isAnyDragging,
  getVariable,
}: {
  btn: QuickButton;
  onFire: (body: string, bodyMode: 'commands' | 'script', toggleBtn?: QuickButton) => void;
  onContextMenu: (e: React.MouseEvent, btn: QuickButton) => void;
  isDragging: boolean;
  getVariable: (name: string) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSelfDragging,
  } = useSortable({ id: btn.id });

  // Resolve toggle state for display
  const isToggle = !!btn.toggle;
  const varVal = isToggle ? getVariable(btn.toggle!.variable) : '';
  const isOn = !!varVal && varVal !== '0';
  const displayLabel = isToggle ? (isOn ? btn.toggle!.onLabel : btn.toggle!.offLabel) : btn.label;
  const displayColor = isToggle ? (isOn ? btn.toggle!.onColor : btn.toggle!.offColor) : btn.color;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isSelfDragging ? 50 : undefined,
    opacity: isSelfDragging ? 0.8 : 1,
    cursor: isAnyDragging ? 'grabbing' : undefined,
  };

  const enabled = btn.enabled;
  const summary = enabled
    ? isToggle
      ? `Toggle: ${btn.toggle!.variable} (${isOn ? 'ON' : 'OFF'})`
      : btn.body.split('\n')[0]
    : `${displayLabel} (disabled)`;

  // Enabled pills take their color inline; disabled pills fall back to
  // theme tokens (dim text, faint dashed border) plus a strike-through
  // label and an "off" tag so the state reads without relying on opacity.
  const pillStyle: React.CSSProperties = enabled
    ? ({
        '--qb-color': displayColor,
        borderColor: `color-mix(in srgb, ${displayColor} 40%, transparent)`,
        color: displayColor,
        background: `color-mix(in srgb, ${displayColor} 6%, transparent)`,
      } as React.CSSProperties)
    : ({ '--qb-color': 'var(--color-text-dim)' } as React.CSSProperties);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <button
        data-qb-id={btn.id}
        aria-disabled={!enabled}
        onClick={() => {
          if (btn.enabled) {
            if (isToggle) {
              onFire('', 'commands', btn);
            } else {
              onFire(btn.body, btn.bodyMode);
            }
          }
        }}
        onContextMenu={(e) => onContextMenu(e, btn)}
        className={`qb-pill inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full border cursor-pointer transition-all duration-150 active:scale-95 ${
          enabled ? '' : 'text-text-dim border-border-faint border-dashed bg-transparent'
        }`}
        style={pillStyle}
        title={`${summary}\n${EDIT_HINT}`}
      >
        <span className={enabled ? undefined : 'line-through decoration-1'}>{displayLabel}</span>
        {!enabled && (
          <span className="text-[8px] font-bold uppercase tracking-wider text-text-muted leading-none">
            off
          </span>
        )}
      </button>
    </div>
  );
}

export function QuickButtonBar({
  buttons,
  onFire,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
  getVariable,
}: QuickButtonBarProps) {
  const [editorState, setEditorState] = useState<{
    mode: 'add' | 'edit';
    button: QuickButton | null;
    anchorRect: DOMRect | null;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    button: QuickButton;
    x: number;
    y: number;
  } | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const addBtnRef = useRef<HTMLButtonElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const openAdd = useCallback(() => {
    const rect = addBtnRef.current?.getBoundingClientRect() ?? null;
    setEditorState({ mode: 'add', button: null, anchorRect: rect });
    setContextMenu(null);
  }, []);

  const openEdit = useCallback((btn: QuickButton, rect: DOMRect) => {
    setEditorState({ mode: 'edit', button: btn, anchorRect: rect });
    setContextMenu(null);
  }, []);

  const closeEditor = useCallback(() => setEditorState(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent, btn: QuickButton) => {
    e.preventDefault();
    setContextMenu({ button: btn, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = buttons.findIndex((b) => b.id === active.id);
      const newIndex = buttons.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      onReorder(arrayMove(buttons, oldIndex, newIndex));
    },
    [buttons, onReorder]
  );

  const buttonIds = buttons.map((b) => b.id);

  return (
    <div className="flex flex-wrap items-center shrink-0 gap-1 px-2 py-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={buttonIds} strategy={horizontalListSortingStrategy}>
          {buttons.map((btn) => (
            <SortableQuickButton
              key={btn.id}
              btn={btn}
              onFire={onFire}
              onContextMenu={handleContextMenu}
              isDragging={draggingId != null}
              getVariable={getVariable}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add button — same size whether the row is empty or not */}
      <button
        ref={addBtnRef}
        onClick={openAdd}
        className="w-6 h-6 text-text-dim hover:text-cyan border border-border-dim hover:border-cyan/30 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150"
        title="Add quick button"
      >
        <PlusIcon size={11} />
      </button>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuOverlay
          button={contextMenu.button}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onEdit={(btn) => {
            const el = document.querySelector(`[data-qb-id="${btn.id}"]`);
            const rect = el?.getBoundingClientRect() ?? new DOMRect(contextMenu.x, contextMenu.y);
            openEdit(btn, rect);
          }}
          onDelete={onDelete}
          onToggleEnabled={(btn) => onUpdate(btn.id, { enabled: !btn.enabled })}
        />
      )}

      {/* Editor popover */}
      {editorState && (
        <QuickButtonEditor
          button={editorState.button}
          anchorRect={editorState.anchorRect}
          onSave={(data) => {
            if (editorState.mode === 'edit' && editorState.button) {
              onUpdate(editorState.button.id, data);
            } else {
              onAdd(data);
            }
            closeEditor();
          }}
          onCancel={closeEditor}
        />
      )}
    </div>
  );
}

/* ── Context Menu ─────────────────────────────────────────────── */

interface ContextMenuOverlayProps {
  button: QuickButton;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: (btn: QuickButton) => void;
  onDelete: (id: string) => void;
  onToggleEnabled: (btn: QuickButton) => void;
}

function ContextMenuOverlay({
  button,
  x,
  y,
  onClose,
  onEdit,
  onDelete,
  onToggleEnabled,
}: ContextMenuOverlayProps) {
  // Two-step delete, mirroring ConfirmDeleteButton: first click arms the
  // row as "Delete?", second click deletes. Closing the menu disarms it.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const itemClass = 'w-full px-3 py-1.5 text-[11px] text-left transition-colors cursor-pointer';
  const activeClass = `${itemClass} text-text-label hover:bg-bg-secondary/60`;
  const dangerClass = `${itemClass} text-red hover:bg-red/10`;
  const confirmClass = `${itemClass} text-red bg-red/10 hover:bg-red/20 font-semibold`;

  return (
    <PopoverMenu
      x={x}
      y={y}
      onClose={onClose}
      className="bg-bg-primary border border-border rounded shadow-lg py-1 min-w-[140px]"
    >
      {/* Header — button name */}
      <div
        className="px-3 py-1 text-[10px] font-mono font-semibold truncate border-b border-border-dim mb-0.5"
        style={{ color: button.color }}
      >
        {button.label}
      </div>
      <button
        onClick={() => {
          onEdit(button);
          onClose();
        }}
        className={activeClass}
      >
        Edit
      </button>
      <button
        onClick={() => {
          onToggleEnabled(button);
          onClose();
        }}
        className={activeClass}
      >
        {button.enabled ? 'Disable' : 'Enable'}
      </button>
      <div className="h-px bg-border-dim mx-1.5 my-0.5" />
      {confirmingDelete ? (
        <button
          onClick={() => {
            onDelete(button.id);
            onClose();
          }}
          className={confirmClass}
          title="Click again to delete"
        >
          Delete?
        </button>
      ) : (
        <button onClick={() => setConfirmingDelete(true)} className={dangerClass}>
          Delete
        </button>
      )}
    </PopoverMenu>
  );
}
