import { useState, useEffect, useRef, useCallback } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';
import { NotesIcon, ChevronLeftIcon, ChevronRightSmallIcon, PlusIcon } from './icons';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { useDataStore } from '../contexts/DataStoreContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import { useNotesContext } from '../contexts/NotesContext';
import { cn } from '../lib/cn';

/* ── Constants ──────────────────────────────────────────────── */

const MAX_TABS = 8;
const MAX_NAME_LENGTH = 10;
const SAVE_DEBOUNCE_MS = 500;

/* ── Types ──────────────────────────────────────────────────── */

type NotesPanelProps = PinnablePanelProps;

/* ── Helpers ────────────────────────────────────────────────── */

/** Slugify a tab name for use in filenames: lowercase, spaces → hyphens, strip non-alphanumeric. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

/**
 * Content filename for a note.
 * The default "General" note keeps the legacy name `notes-{char}.txt`.
 * Others use `notes-{char}-{slug}.txt`.
 */
function contentFileName(character: string, slug: string): string {
  const base = `notes-${character.toLowerCase()}`;
  return slug === 'general' ? `${base}.txt` : `${base}-${slug}.txt`;
}

/** Metadata file: stores tab order and active tab only. */
function metaFileName(character: string): string {
  return `notes-${character.toLowerCase()}-meta.json`;
}

/* ── InlineField (adapted from AllocPanel) ──────────────────── */

function InlineField({
  value,
  placeholder,
  onSave,
  className,
  maxLength,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  className?: string;
  maxLength?: number;
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
        title="Click to rename"
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
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) onSave(trimmed);
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
      placeholder={placeholder}
    />
  );
}

/* ── NotesPanel ─────────────────────────────────────────────── */

export function NotesPanel({ mode = 'slideout' }: NotesPanelProps) {
  const isPinned = mode === 'pinned';
  const dataStore = useDataStore();
  const { activeCharacter } = useSkillTrackerContext();
  const { pendingAppend, consumeAppend } = useNotesContext();

  // Each tab is just a display name. The slug (derived from name) determines the filename.
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const characterRef = useRef<string | null>(null);
  const activeTabRef = useRef<string | null>(null);
  activeTabRef.current = activeTab;
  const contentRef = useRef(content);
  contentRef.current = content;

  /** Get the slug for a tab name, checking for collisions with other tabs. */
  const slugForTab = useCallback(
    (name: string, exclude?: string): string => {
      const base = slugify(name);
      const otherSlugs = new Set(tabs.filter((t) => t !== exclude).map((t) => slugify(t)));
      if (!otherSlugs.has(base)) return base;
      // Append a number to resolve collision
      for (let i = 2; ; i++) {
        const candidate = `${base}-${i}`;
        if (!otherSlugs.has(candidate)) return candidate;
      }
    },
    [tabs]
  );

  // Flush any pending debounced save immediately
  const flushSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const char = characterRef.current;
    const tab = activeTabRef.current;
    if (char && tab) {
      dataStore
        .writeText(contentFileName(char, slugify(tab)), contentRef.current)
        .catch(console.error);
    }
  }, [dataStore]);

  // Persist metadata helper
  const persistMeta = useCallback(
    async (character: string, newTabs: string[], activeTabName: string) => {
      const meta = metaFileName(character);
      await dataStore.set(meta, 'tabs', newTabs);
      await dataStore.set(meta, 'activeTab', activeTabName);
    },
    [dataStore]
  );

  // Load notes when character changes
  useEffect(() => {
    if (!activeCharacter) {
      setTabs([]);
      setActiveTab(null);
      setContent('');
      setLoaded(false);
      characterRef.current = null;
      return;
    }

    const character = activeCharacter;
    characterRef.current = character;
    setLoaded(false);

    (async () => {
      const meta = metaFileName(character);
      const savedTabs = await dataStore.get<string[]>(meta, 'tabs');

      if (characterRef.current !== character) return;

      if (savedTabs && Array.isArray(savedTabs) && savedTabs.length > 0) {
        // Existing multi-tab notes
        const savedActive = await dataStore.get<string>(meta, 'activeTab');
        if (characterRef.current !== character) return;

        setTabs(savedTabs);
        const active = savedTabs.includes(savedActive ?? '') ? savedActive! : savedTabs[0];
        setActiveTab(active);

        const savedContent = await dataStore.readText(contentFileName(character, slugify(active)));
        if (characterRef.current !== character) return;
        setContent(savedContent ?? '');
      } else {
        // First load — read legacy notes-{char}.txt (slug "general")
        const legacyContent = await dataStore.readText(contentFileName(character, 'general'));
        if (characterRef.current !== character) return;

        const defaultTabs = ['General'];
        setTabs(defaultTabs);
        setActiveTab('General');
        setContent(legacyContent ?? '');

        await persistMeta(character, defaultTabs, 'General');
      }

      if (characterRef.current !== character) return;
      setLoaded(true);
    })().catch(console.error);
  }, [activeCharacter, dataStore, persistMeta]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Debounced content save
  const saveContent = useCallback(
    (value: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        const char = characterRef.current;
        const tab = activeTabRef.current;
        if (char && tab) {
          dataStore.writeText(contentFileName(char, slugify(tab)), value).catch(console.error);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [dataStore]
  );

  // Consume pending append from context menu "Open in Notes"
  useEffect(() => {
    if (!loaded || !pendingAppend) return;
    const appended = consumeAppend();
    if (appended) {
      const newContent = content ? `${content}\n${appended}` : appended;
      setContent(newContent);
      saveContent(newContent);
    }
  }, [loaded, pendingAppend]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);
    saveContent(value);
  };

  // Switch to a different tab
  const switchToTab = useCallback(
    async (tabName: string) => {
      if (tabName === activeTabRef.current) return;
      const char = characterRef.current;
      if (!char) return;

      // Flush current content before switching
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      const oldTab = activeTabRef.current;
      if (oldTab) {
        await dataStore.writeText(contentFileName(char, slugify(oldTab)), contentRef.current);
      }

      setActiveTab(tabName);
      await dataStore.set(metaFileName(char), 'activeTab', tabName);

      const tabContent = await dataStore.readText(contentFileName(char, slugify(tabName)));
      if (characterRef.current !== char) return;
      setContent(tabContent ?? '');
    },
    [dataStore]
  );

  // Navigate prev/next
  const navigateNote = useCallback(
    (direction: 'prev' | 'next') => {
      if (tabs.length <= 1) return;
      const currentIndex = tabs.indexOf(activeTab ?? '');
      if (currentIndex === -1) return;
      const delta = direction === 'prev' ? -1 : 1;
      const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
      flushSave();
      switchToTab(tabs[nextIndex]);
    },
    [tabs, activeTab, switchToTab, flushSave]
  );

  // Create new note
  const createNote = useCallback(async () => {
    if (tabs.length >= MAX_TABS) return;
    const char = characterRef.current;
    if (!char) return;

    flushSave();

    // Find next available "Note N" name
    const existingNums = tabs
      .map((t) => {
        const m = t.match(/^Note (\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const num = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    const name = `Note ${num}`;

    const newTabs = [...tabs, name];
    setTabs(newTabs);
    setActiveTab(name);
    setContent('');

    await dataStore.writeText(contentFileName(char, slugify(name)), '');
    await persistMeta(char, newTabs, name);
  }, [tabs, dataStore, flushSave, persistMeta]);

  // Rename current tab
  const renameTab = useCallback(
    async (oldName: string, newName: string) => {
      const char = characterRef.current;
      if (!char) return;
      const trimmed = newName.slice(0, MAX_NAME_LENGTH).trim();
      if (!trimmed || trimmed === oldName) return;

      // Check for duplicate names (case-insensitive)
      if (tabs.some((t) => t !== oldName && t.toLowerCase() === trimmed.toLowerCase())) return;

      // Flush current content
      flushSave();

      const oldSlug = slugify(oldName);
      const newSlug = slugForTab(trimmed, oldName);

      // Read content, write to new filename, delete old
      const oldContent = await dataStore.readText(contentFileName(char, oldSlug));
      await dataStore.writeText(contentFileName(char, newSlug), oldContent ?? '');
      if (oldSlug !== newSlug) {
        await dataStore.deleteText(contentFileName(char, oldSlug));
      }

      const newTabs = tabs.map((t) => (t === oldName ? trimmed : t));
      setTabs(newTabs);
      if (activeTab === oldName) setActiveTab(trimmed);
      await persistMeta(char, newTabs, activeTab === oldName ? trimmed : (activeTab ?? trimmed));
    },
    [tabs, activeTab, dataStore, flushSave, slugForTab, persistMeta]
  );

  // Delete current tab
  const deleteTab = useCallback(
    async (tabName: string) => {
      if (tabs.length <= 1) return;
      const char = characterRef.current;
      if (!char) return;

      const index = tabs.indexOf(tabName);
      if (index === -1) return;

      const newTabs = tabs.filter((t) => t !== tabName);
      const adjacent = newTabs[Math.min(index, newTabs.length - 1)];

      setTabs(newTabs);

      // Delete the .txt file
      await dataStore.deleteText(contentFileName(char, slugify(tabName)));

      // Switch to adjacent tab
      setActiveTab(adjacent);
      await persistMeta(char, newTabs, adjacent);

      const adjacentContent = await dataStore.readText(contentFileName(char, slugify(adjacent)));
      if (characterRef.current !== char) return;
      setContent(adjacentContent ?? '');
    },
    [tabs, dataStore, persistMeta]
  );

  // Derived values
  const currentIndex = tabs.indexOf(activeTab ?? '');
  const total = tabs.length;

  const pinControls = isPinned ? <PinnedControls /> : <PinMenuButton panel="notes" />;

  return (
    <div className={panelRootClass(isPinned)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5">
          <NotesIcon size={12} /> Notes
          {activeCharacter
            ? ` — ${activeCharacter.charAt(0).toUpperCase() + activeCharacter.slice(1)}`
            : ''}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">{pinControls}</div>
      </div>

      {activeCharacter && loaded && (
        /* Note navigation bar */
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border-dim shrink-0">
          <button
            onClick={() => navigateNote('prev')}
            disabled={total <= 1}
            className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
            title="Previous note"
          >
            <ChevronLeftIcon size={10} />
          </button>
          <span className="text-[11px] font-mono text-text-label w-[40px] text-center tabular-nums">
            {total > 0
              ? `${String(currentIndex + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`
              : '--/--'}
          </span>
          <button
            onClick={() => navigateNote('next')}
            disabled={total <= 1}
            className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
            title="Next note"
          >
            <ChevronRightSmallIcon size={10} />
          </button>

          <div className="w-px h-3 bg-border-dim mx-0.5" />

          {activeTab ? (
            <InlineField
              value={activeTab}
              placeholder="name"
              onSave={(v) => renameTab(activeTab, v)}
              className="flex-1 min-w-0 font-semibold"
              maxLength={MAX_NAME_LENGTH}
            />
          ) : (
            <span className="flex-1 text-[11px] text-text-dim italic">no notes</span>
          )}

          <div className="w-px h-3 bg-border-dim mx-0.5" />

          <button
            onClick={createNote}
            disabled={total >= MAX_TABS}
            className="flex items-center justify-center w-[18px] h-[18px] rounded text-text-dim hover:text-green cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
            title="New note"
          >
            <PlusIcon size={10} />
          </button>
          {activeTab && total > 1 && (
            <ConfirmDeleteButton
              key={activeTab}
              onDelete={() => deleteTab(activeTab)}
              size={10}
              variant="fixed"
            />
          )}
        </div>
      )}

      {/* Text area */}
      <div className="flex-1 overflow-hidden p-1">
        {activeCharacter ? (
          <textarea
            value={content}
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
