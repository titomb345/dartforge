import { useState, useEffect, useRef, useCallback } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';
import { useDataStore } from '../contexts/DataStoreContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';

type NotesPanelProps = PinnablePanelProps;

function notesFileName(character: string): string {
  return `notes-${character.toLowerCase()}.txt`;
}

export function NotesPanel({
  mode = 'slideout',
  onPin,
  side,
  onUnpin,
  onSwapSide,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: NotesPanelProps) {
  const isPinned = mode === 'pinned';
  const dataStore = useDataStore();
  const { activeCharacter } = useSkillTrackerContext();
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentFileRef = useRef<string | null>(null);

  // Load notes when character changes
  useEffect(() => {
    if (!activeCharacter) {
      setNotes('');
      setLoaded(false);
      currentFileRef.current = null;
      return;
    }

    const filename = notesFileName(activeCharacter);
    currentFileRef.current = filename;
    setLoaded(false);

    (async () => {
      const saved = await dataStore.readText(filename);
      // Guard against stale loads if character changed while loading
      if (currentFileRef.current !== filename) return;
      setNotes(saved ?? '');
      setLoaded(true);
    })().catch(console.error);
  }, [activeCharacter, dataStore]);

  // Debounced save — writes 500ms after the user stops typing
  const saveNotes = useCallback((value: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const filename = currentFileRef.current;
      if (filename) {
        dataStore.writeText(filename, value).catch(console.error);
      }
    }, 500);
  }, [dataStore]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNotes(value);
    saveNotes(value);
  };

  const pinControls = isPinned ? (
    <PinnedControls
      side={side}
      onSwapSide={onSwapSide}
      canMoveUp={canMoveUp}
      onMoveUp={onMoveUp}
      canMoveDown={canMoveDown}
      onMoveDown={onMoveDown}
      onUnpin={onUnpin}
    />
  ) : onPin ? (
    <PinMenuButton onPin={onPin} />
  ) : null;

  return (
    <div className={panelRootClass(isPinned)}>
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle shrink-0">
        <span className="text-[11px] font-semibold text-text-heading flex-1">
          Notes{activeCharacter ? ` — ${activeCharacter.charAt(0).toUpperCase() + activeCharacter.slice(1)}` : ''}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {pinControls}
        </div>
      </div>

      {/* Text area */}
      <div className="flex-1 overflow-hidden p-1">
        {activeCharacter ? (
          <textarea
            value={notes}
            onChange={handleChange}
            disabled={!loaded}
            placeholder="Jot down notes here..."
            spellCheck={false}
            className="w-full h-full bg-transparent text-[12px] text-text-primary font-mono resize-none outline-none placeholder:text-text-dim/50 p-1"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[11px] text-text-dim">Log in to a character to use notes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
