import { useRef, useEffect, useCallback } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';

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
  /** Minimum height in pixels (default 120) */
  minHeight?: number;
  /** If provided, Ctrl+S triggers this callback */
  onSave?: () => void;
}

export function ScriptEditor({ value, onChange, placeholder, className, minHeight = 120, onSave }: ScriptEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Track whether we're currently applying an external update to avoid looping
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

    const minHeightTheme = EditorView.theme({
      '.cm-editor': { minHeight: `${minHeight}px` },
      '.cm-scroller': { minHeight: `${minHeight}px` },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        javascript(),
        oneDark,
        cyanTheme,
        minHeightTheme,
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

  // Mount
  useEffect(() => {
    createView();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [createView]);

  // Sync external value changes
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
      style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(139, 233, 253, 0.2)' }}
    />
  );
}
