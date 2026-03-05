import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { QuickButton } from '../types';
import { QuickButtonEditor } from './QuickButtonEditor';

interface QuickButtonBarProps {
  buttons: QuickButton[];
  onFire: (body: string, bodyMode: 'commands' | 'script') => void;
  onAdd: (data: Omit<QuickButton, 'id'>) => void;
  onUpdate: (id: string, data: Partial<QuickButton>) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, direction: 'left' | 'right') => void;
}

export function QuickButtonBar({
  buttons,
  onFire,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
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

  const addBtnRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div
      className={`flex flex-wrap items-center shrink-0 ${
        buttons.length > 0 ? 'gap-1 px-2 py-1' : 'px-2 py-px'
      }`}
    >
      {buttons.map((btn) => (
        <button
          key={btn.id}
          data-qb-id={btn.id}
          onClick={() => {
            if (btn.enabled) onFire(btn.body, btn.bodyMode);
          }}
          onContextMenu={(e) => handleContextMenu(e, btn)}
          className="qb-pill text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full border cursor-pointer transition-all duration-150 active:scale-95"
          style={
            {
              '--qb-color': btn.color,
              borderColor: btn.enabled
                ? `color-mix(in srgb, ${btn.color} 40%, transparent)`
                : '#333',
              color: btn.enabled ? btn.color : '#555',
              background: btn.enabled
                ? `color-mix(in srgb, ${btn.color} 6%, transparent)`
                : 'transparent',
              opacity: btn.enabled ? 1 : 0.4,
            } as React.CSSProperties
          }
          title={btn.enabled ? btn.body.split('\n')[0] : `${btn.label} (disabled)`}
        >
          {btn.label}
        </button>
      ))}

      {/* Add button — compact when row is empty */}
      <button
        ref={addBtnRef}
        onClick={openAdd}
        className={`font-mono text-text-dim hover:text-cyan border border-border-dim hover:border-cyan/30 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 ${
          buttons.length > 0 ? 'text-[11px] w-6 h-6' : 'text-[10px] w-4 h-4 leading-none'
        }`}
        title="Add quick button"
      >
        +
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
            const rect =
              el?.getBoundingClientRect() ?? new DOMRect(contextMenu.x, contextMenu.y);
            openEdit(btn, rect);
          }}
          onDelete={onDelete}
          onToggleEnabled={(btn) => onUpdate(btn.id, { enabled: !btn.enabled })}
          onMoveLeft={(btn) => onReorder(btn.id, 'left')}
          onMoveRight={(btn) => onReorder(btn.id, 'right')}
          isFirst={buttons[0]?.id === contextMenu.button.id}
          isLast={buttons[buttons.length - 1]?.id === contextMenu.button.id}
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
  onMoveLeft: (btn: QuickButton) => void;
  onMoveRight: (btn: QuickButton) => void;
  isFirst: boolean;
  isLast: boolean;
}

function ContextMenuOverlay({
  button,
  x,
  y,
  onClose,
  onEdit,
  onDelete,
  onToggleEnabled,
  onMoveLeft,
  onMoveRight,
  isFirst,
  isLast,
}: ContextMenuOverlayProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  const itemClass =
    'w-full px-3 py-1.5 text-[11px] text-left transition-colors cursor-pointer';
  const activeClass = `${itemClass} text-text-label hover:bg-bg-secondary/60`;
  const dimClass = `${itemClass} text-text-dim/40 cursor-default`;
  const dangerClass = `${itemClass} text-red hover:bg-red/10`;

  // Keep menu in viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: Math.min(y, window.innerHeight - 180),
    left: Math.min(x, window.innerWidth - 150),
  };

  return createPortal(
    <div
      className="fixed inset-0"
      style={{ zIndex: 9998 }}
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={menuRef}
        style={style}
        className="bg-bg-primary border border-border rounded shadow-lg z-[200] py-1 min-w-[140px]"
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
        <button
          onClick={() => {
            onMoveLeft(button);
            onClose();
          }}
          disabled={isFirst}
          className={isFirst ? dimClass : activeClass}
        >
          Move Left
        </button>
        <button
          onClick={() => {
            onMoveRight(button);
            onClose();
          }}
          disabled={isLast}
          className={isLast ? dimClass : activeClass}
        >
          Move Right
        </button>
        <div className="h-px bg-border-dim mx-1.5 my-0.5" />
        <button
          onClick={() => {
            onDelete(button.id);
            onClose();
          }}
          className={dangerClass}
        >
          Delete
        </button>
      </div>
    </div>,
    document.body
  );
}
