import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { PanelHeader } from './PanelHeader';
import {
  BabelIcon,
  PlayIcon,
  StopIcon,
  RotateCcwIcon,
  FolderIcon,
  PlusIcon,
  ChevronRightIcon,
} from './icons';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import { DEFAULT_BABEL_PHRASES } from '../lib/babelPhrases';
import { MudNumberInput } from './shared';
import { cn } from '../lib/cn';

/* ── Phrase Row ─────────────────────────────────────────────── */

function PhraseRow({
  phrase,
  index,
  onUpdate,
  onDelete,
  disabled,
}: {
  phrase: string;
  index: number;
  onUpdate: (index: number, value: string) => void;
  onDelete: (index: number) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phrase);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== phrase) {
      onUpdate(index, trimmed);
    }
    setEditing(false);
  }, [draft, phrase, index, onUpdate]);

  return (
    <div
      className={cn(
        'group flex items-center gap-1 px-1.5 py-[3px] rounded transition-[background] duration-150',
        !editing && !disabled && 'hover:bg-bg-secondary cursor-pointer'
      )}
      onClick={() => {
        if (!editing && !disabled) {
          setDraft(phrase);
          setEditing(true);
        }
      }}
    >
      {/* Delete button — hover-revealed */}
      {!disabled && <ConfirmDeleteButton onDelete={() => onDelete(index)} />}

      {/* Index */}
      <span className="text-[9px] text-text-dim font-mono w-[18px] shrink-0 text-right tabular-nums select-none">
        {index + 1}.
      </span>

      {/* Content: display or edit */}
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(phrase);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-bg-canvas border border-border-dim rounded px-1.5 py-px text-[10px] font-mono text-text-primary outline-none focus:border-[#e879f9]/50 transition-colors"
          spellCheck={false}
        />
      ) : (
        <span
          className="flex-1 min-w-0 text-[10px] font-mono text-text-label truncate"
          title={phrase}
        >
          {phrase}
        </span>
      )}
    </div>
  );
}

/* ── Add Phrase Row ─────────────────────────────────────────── */

function AddPhraseRow({ onAdd }: { onAdd: (phrase: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) {
      onAdd(trimmed);
      setDraft('');
      // Keep input open for rapid adding
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setAdding(false);
    }
  }, [draft, onAdd]);

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex items-center gap-1.5 px-1.5 py-1 text-[9px] font-mono text-text-dim hover:text-[#e879f9] cursor-pointer transition-colors duration-150"
      >
        <PlusIcon size={8} /> Add phrase
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 px-1.5 py-[3px]">
      <span className="w-[18px] shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft('');
            setAdding(false);
          }
        }}
        placeholder="New phrase..."
        className="flex-1 min-w-0 bg-bg-canvas border border-[#e879f9]/30 rounded px-1.5 py-px text-[10px] font-mono text-text-primary outline-none focus:border-[#e879f9]/50 transition-colors"
        spellCheck={false}
      />
    </div>
  );
}

/* ── Babel Panel ────────────────────────────────────────────── */

export function BabelPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const isPinned = mode === 'pinned';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    babelEnabled,
    babelLanguage,
    babelIntervalSeconds,
    babelPhrases,
    updateBabelEnabled,
    updateBabelLanguage,
    updateBabelIntervalSeconds,
    updateBabelPhrases,
  } = useAppSettingsContext();

  const { skillData } = useSkillTrackerContext();

  const languageOptions = useMemo(() => {
    const langs: string[] = [];
    for (const skillName of Object.keys(skillData.skills)) {
      if (skillName.startsWith('language#')) {
        langs.push(skillName.slice(9));
      }
    }
    return langs.sort();
  }, [skillData.skills]);

  const isCustom = babelPhrases.length > 0;
  const activePhrases = isCustom ? babelPhrases : DEFAULT_BABEL_PHRASES;

  const handleToggle = useCallback(() => {
    updateBabelEnabled(!babelEnabled);
  }, [babelEnabled, updateBabelEnabled]);

  // Ensure we're working with a custom copy before mutating
  const ensureCustom = useCallback((): string[] => {
    if (babelPhrases.length > 0) return [...babelPhrases];
    return [...DEFAULT_BABEL_PHRASES];
  }, [babelPhrases]);

  const handleUpdatePhrase = useCallback(
    (index: number, value: string) => {
      const next = ensureCustom();
      next[index] = value;
      updateBabelPhrases(next);
    },
    [ensureCustom, updateBabelPhrases]
  );

  const handleDeletePhrase = useCallback(
    (index: number) => {
      const next = ensureCustom();
      next.splice(index, 1);
      updateBabelPhrases(next);
    },
    [ensureCustom, updateBabelPhrases]
  );

  const handleAddPhrase = useCallback(
    (phrase: string) => {
      const next = ensureCustom();
      next.push(phrase);
      updateBabelPhrases(next);
    },
    [ensureCustom, updateBabelPhrases]
  );

  const handleLoadFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 0) updateBabelPhrases(lines);
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [updateBabelPhrases]
  );

  const handleResetPhrases = useCallback(() => {
    updateBabelPhrases([]);
  }, [updateBabelPhrases]);

  const [phrasesOpen, setPhrasesOpen] = useState(false);

  const canStart = babelLanguage && activePhrases.length > 0;

  return (
    <div className={panelRootClass(isPinned)}>
      <PanelHeader icon={<BabelIcon size={12} />} title="Babel" panel="babel" mode={mode} />

      {/* Single scrollable region — no nested scrolls */}
      <div className="flex-1 overflow-y-auto">
        {/* Controls */}
        <div className="px-3 py-2.5 space-y-2.5 border-b border-border-subtle">
          {/* Language + Interval on one row */}
          <div className="flex items-end gap-2.5">
            <div className="flex-1 min-w-0">
              <label className="block text-[9px] text-text-dim uppercase tracking-wide mb-1">
                Language
              </label>
              {languageOptions.length > 0 ? (
                <select
                  value={babelLanguage}
                  onChange={(e) => updateBabelLanguage(e.target.value)}
                  className={cn(
                    'w-full bg-bg-input border border-border-dim rounded px-2 py-1 text-[11px] font-mono text-text-primary',
                    'focus:outline-none focus:border-[#e879f9]/40 transition-colors'
                  )}
                >
                  <option value="">Select...</option>
                  {languageOptions.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-[10px] text-text-dim italic py-1.5">
                  No languages learned yet.
                </div>
              )}
            </div>
            <div className="shrink-0">
              <label className="block text-[9px] text-text-dim uppercase tracking-wide mb-1">
                Every
              </label>
              <div className="flex items-center gap-1">
                <MudNumberInput
                  accent="pink"
                  size="md"
                  min={10}
                  max={120}
                  value={babelIntervalSeconds}
                  onChange={updateBabelIntervalSeconds}
                  disabled={babelEnabled}
                  className="w-[48px] text-center"
                />
                <span className="text-[9px] font-mono text-text-dim">sec</span>
              </div>
            </div>
          </div>

          {/* Start / Stop */}
          <button
            onClick={handleToggle}
            disabled={!canStart && !babelEnabled}
            className={cn(
              'w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border text-[11px] font-semibold transition-all duration-200 cursor-pointer',
              babelEnabled
                ? 'text-red border-red/30 bg-red/8 hover:bg-red/15'
                : `text-[#50fa7b] border-[#50fa7b]/30 bg-[#50fa7b]/8 hover:bg-[#50fa7b]/15`,
              !canStart && !babelEnabled && 'opacity-40 cursor-not-allowed'
            )}
          >
            {babelEnabled ? (
              <>
                <StopIcon size={10} /> Stop
              </>
            ) : (
              <>
                <PlayIcon size={10} /> Start
              </>
            )}
          </button>

          {babelEnabled && (
            <div className="text-[9px] text-[#e879f9] font-mono animate-pulse-slow">
              Training {babelLanguage} — {activePhrases.length} phrases, every{' '}
              {babelIntervalSeconds}s
            </div>
          )}
        </div>

        {/* Phrases section — collapsible */}
        <div className="px-2 py-2">
          {/* Clickable header row */}
          <div className="flex items-center justify-between px-1 mb-1">
            <button
              onClick={() => setPhrasesOpen((v) => !v)}
              className="flex items-center gap-1 text-[9px] text-text-dim uppercase tracking-wide cursor-pointer hover:text-text-label transition-colors"
            >
              <span
                className="transition-transform duration-150"
                style={{ transform: phrasesOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                <ChevronRightIcon size={8} />
              </span>
              Phrases{' '}
              <span className="normal-case opacity-60">
                — {activePhrases.length}
                {!isCustom && ' (defaults)'}
              </span>
            </button>
            {phrasesOpen && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleLoadFile}
                  disabled={babelEnabled}
                  title="Load phrases from .txt file"
                  className={cn(
                    'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-mono transition-colors cursor-pointer',
                    'text-text-dim hover:text-[#e879f9]',
                    babelEnabled && 'opacity-40 cursor-not-allowed pointer-events-none'
                  )}
                >
                  <FolderIcon size={8} /> Import
                </button>
                {isCustom && (
                  <button
                    onClick={handleResetPhrases}
                    disabled={babelEnabled}
                    title="Reset to default phrases"
                    className={cn(
                      'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-mono transition-colors cursor-pointer',
                      'text-text-dim hover:text-[#e879f9]',
                      babelEnabled && 'opacity-40 cursor-not-allowed pointer-events-none'
                    )}
                  >
                    <RotateCcwIcon size={8} /> Reset
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            onChange={handleFileSelected}
            className="hidden"
          />

          {/* Phrase list — visible when expanded */}
          {phrasesOpen && (
            <div className="space-y-0">
              {activePhrases.map((phrase, i) => (
                <PhraseRow
                  key={`${i}-${phrase.slice(0, 20)}`}
                  phrase={phrase}
                  index={i}
                  onUpdate={handleUpdatePhrase}
                  onDelete={handleDeletePhrase}
                  disabled={babelEnabled}
                />
              ))}
              {!babelEnabled && <AddPhraseRow onAdd={handleAddPhrase} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
