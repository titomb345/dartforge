import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import type { SkillRecord, SkillCategory } from '../types/skills';
import type { PinnablePanelProps } from '../types';
import { panelRootClass, charDisplayName } from '../lib/panelUtils';
import { getTierForCount, getImprovesToNextTier } from '../lib/skillTiers';
import {
  getSkillCategory, getSkillSubcategory,
  CATEGORY_LABELS, CATEGORY_ORDER, SUBCATEGORY_ORDER,
} from '../lib/skillCategories';
import { TrashIcon } from './icons';
import { FilterPill } from './FilterPill';
import { MudInput, MudButton } from './shared';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';

const SETTINGS_FILE = 'settings.json';
const SKILL_FILTER_KEY = 'skillPanelFilter';
const SKILL_SORT_KEY = 'skillPanelSort';
const SKILL_SUBS_KEY = 'skillPanelShowSubs';

type SkillPanelProps = PinnablePanelProps;

type FilterValue = 'all' | SkillCategory;
type SortMode = 'name' | 'count';

interface SubGroup {
  name: string;
  skills: SkillRecord[];
}

function sortSkills(skills: SkillRecord[], mode: SortMode): SkillRecord[] {
  return [...skills].sort((a, b) =>
    mode === 'name'
      ? a.skill.localeCompare(b.skill)
      : b.count - a.count || a.skill.localeCompare(b.skill),
  );
}

function SkillRow({ record, displayName }: { record: SkillRecord; displayName?: string }) {
  const { updateSkillCount, deleteSkill } = useSkillTrackerContext();
  const tier = getTierForCount(record.count);
  const toNext = getImprovesToNextTier(record.count);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    setDraft(String(record.count));
    setEditing(true);
  }, [record.count]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed !== record.count) {
      updateSkillCount(record.skill, parsed);
    }
    setEditing(false);
  }, [draft, record.count, record.skill, updateSkillCount]);

  return (
    <div className="group flex items-center gap-1 px-2 py-1 hover:bg-bg-secondary rounded transition-[background] duration-150">
      {confirmingDelete ? (
        <button
          onClick={() => { deleteSkill(record.skill); setConfirmingDelete(false); }}
          onBlur={() => setConfirmingDelete(false)}
          className="text-[8px] font-mono text-red border border-red/40 rounded px-1 py-px cursor-pointer hover:bg-red/10 shrink-0 transition-colors duration-150"
        >
          Del?
        </button>
      ) : (
        <button
          onClick={() => setConfirmingDelete(true)}
          title="Delete skill"
          className="w-0 overflow-hidden opacity-0 group-hover:w-4 group-hover:opacity-100 shrink-0 flex items-center justify-center text-text-dim hover:text-red cursor-pointer transition-all duration-150"
        >
          <TrashIcon size={9} />
        </button>
      )}
      <span className="text-xs text-text-label flex-1 truncate" title={record.skill}>{displayName ?? record.skill}</span>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min={0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'Escape') { setEditing(false); }
          }}
          className="text-[11px] font-mono text-text-heading w-[34px] shrink-0 text-right bg-bg-input border border-cyan/40 rounded px-0.5 py-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      ) : (
        <span
          onClick={startEdit}
          title="Click to edit"
          className="text-[11px] font-mono text-text-heading w-[34px] shrink-0 text-right cursor-pointer hover:text-cyan transition-colors duration-150"
        >
          {record.count}
        </span>
      )}
      <span className="text-[11px] font-mono text-cyan w-[74px] shrink-0 text-center truncate">
        {tier.abbr}
      </span>
      <span className="text-[11px] font-mono text-text-dim w-[34px] shrink-0 text-right">
        {toNext > 0 ? toNext : 'max'}
      </span>
    </div>
  );
}

function ColumnHeaders() {
  return (
    <div className="flex items-center gap-1 px-2 pb-0.5">
      <span className="text-[10px] text-[#444] flex-1">Skill</span>
      <span className="text-[10px] text-[#444] w-[34px] shrink-0 text-right">Imps</span>
      <span className="text-[10px] text-[#444] w-[74px] shrink-0 text-center">Level</span>
      <span className="text-[10px] text-[#444] w-[34px] shrink-0 text-right">Next</span>
    </div>
  );
}

/** Accent colors for subcategory dividers (combat + fallback for pets) */
const SUB_GROUP_COLORS: Record<string, string> = {
  Weapons: '#f59e0b',  // amber
  SODA: '#22c55e',     // green
  Defense: '#a78bfa',  // purple
  General: '#8be9fd',  // cyan
};

/** Default color for pet name dividers */
const PET_DIVIDER_COLOR = '#50fa7b';

function getSkillDisplayName(skill: string, context: 'all' | SkillCategory): string | undefined {
  const category = getSkillCategory(skill);

  // Spells: replace spaces with underscores (any tab)
  if (category === 'spells') {
    return skill.replace(/ /g, '_');
  }

  // Languages in "all" tab: "language common" → "language#common"
  if (category === 'language' && context === 'all') {
    return skill.replace(' ', '#').replace(/ /g, '_');
  }

  // Languages in language tab: strip "language " prefix, underscores for remaining spaces
  if (category === 'language' && context === 'language') {
    return skill.startsWith('language ') ? skill.slice(9).replace(/ /g, '_') : undefined;
  }

  return undefined;
}

function SkillSection({
  title,
  skills,
  subGroups,
  displayContext,
  subGroupColor,
}: {
  title?: string;
  skills: SkillRecord[];
  subGroups?: SubGroup[];
  displayContext?: 'all' | SkillCategory;
  subGroupColor?: string;
}) {
  if (skills.length === 0) return null;

  return (
    <div className="mb-4">
      {title && (
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#555] mb-1.5 px-2">
          {title}
        </div>
      )}
      <ColumnHeaders />
      {subGroups ? (
        subGroups.map((group) => {
          const color = SUB_GROUP_COLORS[group.name] ?? subGroupColor ?? '#666';
          return group.skills.length > 0 ? (
            <div key={group.name}>
              <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
                <div className="h-px flex-1" style={{ background: `color-mix(in srgb, ${color} 40%, transparent)` }} />
                <span
                  className="text-[9px] font-mono uppercase tracking-wider"
                  style={{ color }}
                >
                  {group.name}
                </span>
                <div className="h-px flex-1" style={{ background: `color-mix(in srgb, ${color} 40%, transparent)` }} />
              </div>
              {group.skills.map((record) => (
                <SkillRow key={record.skill} record={record}
                  displayName={displayContext ? getSkillDisplayName(record.skill, displayContext) : undefined} />
              ))}
            </div>
          ) : null;
        })
      ) : (
        skills.map((record) => (
          <SkillRow key={record.skill} record={record}
            displayName={displayContext ? getSkillDisplayName(record.skill, displayContext) : undefined} />
        ))
      )}
    </div>
  );
}

function buildSubGroups(
  skills: SkillRecord[],
  category: SkillCategory,
  sort: SortMode,
): SubGroup[] | undefined {
  const order = SUBCATEGORY_ORDER[category];
  if (!order) return undefined;

  const groups: Record<string, SkillRecord[]> = {};
  for (const name of order) groups[name] = [];

  for (const record of skills) {
    const sub = getSkillSubcategory(record.skill, category) ?? order[order.length - 1];
    if (!groups[sub]) groups[sub] = [];
    groups[sub].push(record);
  }

  return order
    .filter((name) => groups[name].length > 0)
    .map((name) => ({
      name,
      skills: sortSkills(groups[name], sort),
    }));
}

export function SkillPanel({
  mode = 'slideout',
  onPin,
  side,
  onUnpin,
  onSwapSide,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: SkillPanelProps) {
  const { activeCharacter, skillData, addSkill } = useSkillTrackerContext();
  const dataStore = useDataStore();
  const [filter, setFilter] = useState<FilterValue>('all');
  const [sort, setSort] = useState<SortMode>('name');
  const [showSubs, setShowSubs] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [addSkillValue, setAddSkillValue] = useState('');
  const [addSkillCount, setAddSkillCount] = useState('');
  const addSkillRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  // Load persisted panel settings on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedFilter = await dataStore.get<FilterValue>(SETTINGS_FILE, SKILL_FILTER_KEY);
        if (savedFilter) setFilter(savedFilter);
        const savedSort = await dataStore.get<SortMode>(SETTINGS_FILE, SKILL_SORT_KEY);
        if (savedSort) setSort(savedSort);
        const savedSubs = await dataStore.get<boolean>(SETTINGS_FILE, SKILL_SUBS_KEY);
        if (savedSubs != null) setShowSubs(savedSubs);
      } catch (e) {
        console.error('Failed to load skill panel settings:', e);
      }
      loaded.current = true;
    })();
  }, [dataStore.ready]);

  // Persist panel settings on change (skip initial load)
  useEffect(() => {
    if (!loaded.current) return;
    (async () => {
      try {
        await dataStore.set(SETTINGS_FILE, SKILL_FILTER_KEY, filter);
        await dataStore.set(SETTINGS_FILE, SKILL_SORT_KEY, sort);
        await dataStore.set(SETTINGS_FILE, SKILL_SUBS_KEY, showSubs);
        await dataStore.save(SETTINGS_FILE);
      } catch (e) {
        console.error('Failed to save skill panel settings:', e);
      }
    })();
  }, [filter, sort, showSubs]);

  const categorizedSkills = useMemo(() => {
    const groups: Record<SkillCategory, SkillRecord[]> = {
      combat: [], magic: [], spells: [], crafting: [], movement: [], language: [], thief: [], pets: [], other: [],
    };
    for (const record of Object.values(skillData.skills)) {
      const cat = getSkillCategory(record.skill);
      groups[cat].push(record);
      // "language magic" belongs in both language and magic
      if (record.skill.toLowerCase() === 'language magic') {
        groups.magic.push(record);
      }
    }
    // Fold pet skills into the 'pets' category
    for (const petSkills of Object.values(skillData.pets)) {
      for (const record of Object.values(petSkills)) {
        groups.pets.push(record);
      }
    }
    for (const cat of CATEGORY_ORDER) {
      groups[cat] = sortSkills(groups[cat], sort);
    }
    return groups;
  }, [skillData.skills, skillData.pets, sort]);

  const petSubGroups = useMemo((): SubGroup[] => {
    return Object.entries(skillData.pets)
      .map(([petName, skills]) => ({
        name: charDisplayName(petName),
        skills: sortSkills(Object.values(skills), sort),
      }))
      .filter((g) => g.skills.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [skillData.pets, sort]);

  const allSkillsSorted = useMemo(() => {
    const allRecords = Object.values(skillData.skills);
    const sorted = sortSkills(allRecords, sort);
    if (!searchText) return sorted;
    const lower = searchText.toLowerCase();
    return sorted.filter((r) => r.skill.toLowerCase().includes(lower));
  }, [skillData.skills, sort, searchText]);

  const visibleCategories = useMemo(() => {
    if (filter === 'all') return CATEGORY_ORDER.filter((cat) => categorizedSkills[cat].length > 0);
    return categorizedSkills[filter].length > 0 ? [filter] : [];
  }, [filter, categorizedSkills]);

  const hasAnySkills = CATEGORY_ORDER.some((cat) => categorizedSkills[cat].length > 0);

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    const name = addSkillValue.trim().toLowerCase();
    if (!name) return;
    const count = addSkillCount ? parseInt(addSkillCount, 10) : 0;
    addSkill(name, isNaN(count) ? 0 : count);
    setAddSkillValue('');
    setAddSkillCount('');
    setShowAddSkill(false);
  };

  const isPinned = mode === 'pinned';

  const titleText = `Skills${activeCharacter ? ` (${charDisplayName(activeCharacter)})` : ''}`;

  const addButton = activeCharacter ? (
    <button
      onClick={() => { setShowAddSkill((v) => !v); if (!showAddSkill) requestAnimationFrame(() => addSkillRef.current?.focus()); }}
      title={showAddSkill ? 'Close add skill' : 'Add skill'}
      className={`flex items-center rounded text-[10px] cursor-pointer px-1.5 py-[2px] transition-all duration-200 ease-in-out border ${
        showAddSkill
          ? 'bg-cyan/15 border-cyan/40 text-cyan'
          : 'bg-transparent border-border-dim text-text-dim hover:text-text-label'
      }`}
    >
      +
    </button>
  ) : null;

  const sortButton = (
    <button
      onClick={() => setSort(sort === 'name' ? 'count' : 'name')}
      title={sort === 'name' ? 'Sorted by name — click for count' : 'Sorted by count — click for name'}
      className={`flex items-center rounded text-[10px] cursor-pointer px-1.5 py-[2px] transition-all duration-200 ease-in-out border ${
        sort === 'count'
          ? 'bg-cyan/15 border-cyan/40 text-cyan'
          : 'bg-transparent border-border-dim text-text-dim hover:text-text-label'
      }`}
    >
      {sort === 'name' ? 'A-Z' : '#↓'}
    </button>
  );

  return (
    <div className={panelRootClass(isPinned)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading">{titleText}</span>
        <div className="flex items-center gap-1.5">
          {isPinned ? (
            <>
              {side === 'left' && <>{addButton}{sortButton}</>}
              <PinnedControls
                side={side}
                onSwapSide={onSwapSide}
                canMoveUp={canMoveUp}
                onMoveUp={onMoveUp}
                canMoveDown={canMoveDown}
                onMoveDown={onMoveDown}
                onUnpin={onUnpin}
              />
              {side === 'right' && <>{sortButton}{addButton}</>}
            </>
          ) : (
            <>
              {onPin && <PinMenuButton onPin={onPin} />}
              {sortButton}
              {addButton}
            </>
          )}
        </div>
      </div>

      {/* Category filter */}
      {hasAnySkills && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle flex-wrap shrink-0">
          <FilterPill label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          {CATEGORY_ORDER.map((cat) =>
            categorizedSkills[cat].length > 0 ? (
              <FilterPill
                key={cat}
                label={CATEGORY_LABELS[cat]}
                active={filter === cat}
                accent={filter === cat && cat === 'combat' && showSubs ? 'amber' : undefined}
                onClick={() => {
                  if (filter === cat && cat === 'combat') {
                    setShowSubs((v) => !v);
                  } else {
                    setFilter(cat);
                  }
                }}
              />
            ) : null,
          )}
        </div>
      )}

      {/* Text filter — only on "all" tab */}
      {filter === 'all' && hasAnySkills && (
        <div className="px-2 py-1.5 border-b border-border-subtle shrink-0">
          <div className="relative">
            <MudInput
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Filter skills..."
              className="w-full"
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-label text-[11px] cursor-pointer"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add skill form */}
      {showAddSkill && activeCharacter && (
        <form onSubmit={handleAddSkill} className="flex items-center gap-1.5 px-3 py-2 border-b border-border-subtle shrink-0">
          <MudInput
            ref={addSkillRef}
            accent="cyan"
            size="lg"
            value={addSkillValue}
            onChange={(e) => setAddSkillValue(e.target.value)}
            placeholder="Add skill..."
            className="flex-1 min-w-0"
          />
          <MudInput
            accent="cyan"
            size="lg"
            type="number"
            min={0}
            value={addSkillCount}
            onChange={(e) => setAddSkillCount(e.target.value)}
            placeholder="0"
            className="w-14 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <MudButton
            type="submit"
            accent="cyan"
            size="sm"
            disabled={!addSkillValue.trim()}
            className="shrink-0"
          >
            Add
          </MudButton>
        </form>
      )}

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto px-1 py-3">
        {!activeCharacter && (
          <div className="px-2 text-xs text-text-dim">
            Log in to track skills.
          </div>
        )}

        {activeCharacter && !hasAnySkills && (
          <div className="px-2 text-xs text-text-dim">
            No skills tracked yet. Skills will appear here as they improve.
          </div>
        )}

        {filter === 'all' ? (
          /* Flat list — no category headers or subcategories */
          <SkillSection skills={allSkillsSorted} displayContext="all" />
        ) : (
          /* Single category view — with subcategories for combat */
          visibleCategories.map((cat) => {
            const subGroups =
              cat === 'combat' && showSubs ? buildSubGroups(categorizedSkills[cat], cat, sort) :
              cat === 'pets' ? petSubGroups :
              undefined;
            return (
              <SkillSection
                key={cat}
                skills={categorizedSkills[cat]}
                subGroups={subGroups}
                displayContext={cat}
                subGroupColor={cat === 'pets' ? PET_DIVIDER_COLOR : undefined}
              />
            );
          })
        )}

      </div>
    </div>
  );
}

