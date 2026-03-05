import { useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { ExpandIcon, CollapseIcon, ChevronDownIcon, ChevronUpIcon } from './icons';
import { SyntaxHelpTable, SCRIPT_API_HELP_ROWS, SCRIPT_ACCENT } from './SyntaxHelpTable';
import type { HelpRow } from './SyntaxHelpTable';

const cyanTheme = EditorView.theme({
  '&': {
    fontSize: '12px',
    backgroundColor: '#1a1a2e',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    caretColor: '#8be9fd',
  },
  '.cm-cursor': {
    borderLeftColor: '#8be9fd',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#8be9fd30 !important',
  },
  '.cm-gutters': {
    backgroundColor: '#151525',
    color: '#8be9fd50',
    border: 'none',
    minWidth: '32px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#8be9fd15',
  },
  '.cm-activeLine': {
    backgroundColor: '#8be9fd08',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-line': {
    padding: '0 4px',
  },
});

interface ScriptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** If provided, Ctrl+S triggers this callback */
  onSave?: () => void;
  /** Hide the expand button (used internally by the popout modal) */
  popout?: boolean;
  /** Extra help rows to show in popout (panel-specific variables like $0-$9) */
  extraHelpRows?: HelpRow[];
}

function InnerEditor({
  value,
  onChange,
  placeholder,
  className,
  onSave,
}: Omit<ScriptEditorProps, 'popout' | 'extraHelpRows'>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const externalUpdate = useRef(false);

  const createView = useCallback(() => {
    if (!containerRef.current) return;
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !externalUpdate.current) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const sizeTheme = EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        javascript(),
        oneDark,
        cyanTheme,
        sizeTheme,
        saveKeymap,
        updateListener,
        EditorView.lineWrapping,
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });
  }, []); // Only create once

  useEffect(() => {
    createView();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [createView]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      externalUpdate.current = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
      externalUpdate.current = false;
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        borderRadius: '4px',
        overflow: 'hidden',
        border: '1px solid rgba(139, 233, 253, 0.2)',
        height: '100%',
      }}
    />
  );
}

/* ── Popout Modal ── */

function PopoutModal({
  value,
  onChange,
  placeholder,
  onSave,
  onClose,
  extraHelpRows,
}: Omit<ScriptEditorProps, 'popout' | 'className'> & { onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [showHelp, setShowHelp] = useState(false);

  const handleSave = useCallback(() => {
    onSave?.();
  }, [onSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const helpRows = [...(extraHelpRows ?? []), ...SCRIPT_API_HELP_ROWS];

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]">
      <div
        ref={modalRef}
        className="w-[70vw] min-w-[480px] border border-cyan/30 rounded-lg bg-bg-primary flex flex-col overflow-hidden"
        style={{ height: '60vh', minHeight: '320px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle shrink-0">
          <span className="text-[11px] font-semibold text-text-heading font-mono">
            Script Editor
          </span>
          <div className="flex items-center gap-1.5">
            {onSave && (
              <button
                onClick={handleSave}
                className="font-mono font-semibold rounded border cursor-pointer transition-colors duration-150 text-[10px] px-1.5 py-0.5 bg-cyan/15 border-cyan/30 text-cyan hover:bg-cyan/25"
              >
                Save
              </button>
            )}
            <button
              onClick={onClose}
              className="font-mono font-semibold rounded border cursor-pointer transition-colors duration-150 text-[10px] px-1.5 py-0.5 border-border-dim text-text-dim hover:text-text-label"
              title="Close (Esc)"
            >
              <CollapseIcon size={11} />
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          <InnerEditor
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            onSave={onSave ? handleSave : undefined}
          />
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between px-3 py-1.5 border-t border-border-subtle shrink-0">
          <span className="text-[10px] text-text-dim font-mono">
            {value.split('\n').length} lines
          </span>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="flex items-center gap-0.5 text-[9px] text-cyan/70 hover:text-cyan cursor-pointer transition-colors duration-150"
          >
            {showHelp ? 'hide help' : 'syntax help'}
            {showHelp ? <ChevronDownIcon size={7} /> : <ChevronUpIcon size={7} />}
          </button>

          {/* Syntax help popover — floats above footer */}
          {showHelp && (
            <div className="absolute bottom-full right-0 mb-1 mr-1 w-[380px] max-h-[280px] overflow-y-auto rounded-lg border border-cyan/25 bg-bg-primary shadow-lg">
              <div className="p-2">
                <SyntaxHelpTable
                  rows={helpRows}
                  accentColor={SCRIPT_ACCENT}
                  footer={
                    <span>
                      Script bodies run as <code className="font-mono text-cyan">async</code>{' '}
                      functions. Use <code className="font-mono text-cyan">await</code> before
                      send/delay/spam.
                    </span>
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Exported ScriptEditor ── */

export function ScriptEditor({
  value,
  onChange,
  placeholder,
  className,
  onSave,
  popout = true,
  extraHelpRows,
}: ScriptEditorProps) {
  const [expanded, setExpanded] = useState(false);

  if (!popout) {
    return (
      <InnerEditor
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        onSave={onSave}
      />
    );
  }

  return (
    <div className="se-wrapper" style={{ position: 'relative', height: '100%' }}>
      <style>{`
        .se-wrapper .se-expand-btn {
          opacity: 0;
          transition: opacity 0.15s;
        }
        .se-wrapper:hover .se-expand-btn {
          opacity: 1;
        }
      `}</style>
      <InnerEditor
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        onSave={onSave}
      />
      <button
        onClick={() => setExpanded(true)}
        title="Expand editor"
        className="se-expand-btn absolute top-1 right-1 bg-bg-primary/80 border border-cyan/20 rounded text-cyan/40 hover:text-cyan hover:border-cyan/40 cursor-pointer p-0.5 flex items-center z-10 transition-colors duration-150"
      >
        <ExpandIcon size={11} />
      </button>
      {expanded && (
        <PopoutModal
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          onSave={onSave}
          onClose={() => setExpanded(false)}
          extraHelpRows={extraHelpRows}
        />
      )}
    </div>
  );
}
