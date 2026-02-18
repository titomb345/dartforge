import { useEffect, useMemo, useRef, useState } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { useSkillTrackerContext } from '../contexts/SkillTrackerContext';
import type { SkillRecord, SkillCategory } from '../types/skills';
import type { DockSide } from '../types';
import { getTierForCount, getImprovesToNextTier } from '../lib/skillTiers';
import {
  getSkillCategory, getSkillSubcategory,
  CATEGORY_LABELS, CATEGORY_ORDER, SUBCATEGORY_ORDER,
} from '../lib/skillCategories';
import { PinIcon, ArrowLeftIcon, ArrowRightIcon } from './icons';

const SETTINGS_FILE = 'settings.json';
const SKILL_FILTER_KEY = 'skillPanelFilter';
const SKILL_SORT_KEY = 'skillPanelSort';
const SKILL_SUBS_KEY = 'skillPanelShowSubs';

interface SkillPanelProps {
  mode?: 'slideout' | 'pinned';
  onPin?: (side: DockSide) => void;
}

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
  const tier = getTierForCount(record.count);
  const toNext = getImprovesToNextTier(record.count);

  return (
    <div className="flex items-center gap-1 px-2 py-1 hover:bg-bg-secondary rounded transition-[background] duration-150">
      <span className="text-xs text-text-label flex-1 truncate" title={record.skill}>{displayName ?? record.skill}</span>
      <span className="text-[11px] font-mono text-text-heading w-[34px] shrink-0 text-right">
        {record.count}
      </span>
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

/** Accent colors for combat subcategory dividers */
const SUB_GROUP_COLORS: Record<string, string> = {
  Weapons: '#f59e0b',  // amber
  SODA: '#22c55e',     // green
  Defense: '#a78bfa',  // purple
  General: '#8be9fd',  // cyan
};

function langDisplayName(skill: string): string | undefined {
  return skill.startsWith('language ') ? skill.slice(9) : undefined;
}

function SkillSection({
  title,
  skills,
  subGroups,
  stripLangPrefix,
}: {
  title?: string;
  skills: SkillRecord[];
  subGroups?: SubGroup[];
  stripLangPrefix?: boolean;
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
        subGroups.map((group) =>
          group.skills.length > 0 ? (
            <div key={group.name}>
              <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
                <div className="h-px flex-1" style={{ background: `color-mix(in srgb, ${SUB_GROUP_COLORS[group.name] ?? '#666'} 40%, transparent)` }} />
                <span
                  className="text-[9px] font-mono uppercase tracking-wider"
                  style={{ color: SUB_GROUP_COLORS[group.name] ?? '#666' }}
                >
                  {group.name}
                </span>
                <div className="h-px flex-1" style={{ background: `color-mix(in srgb, ${SUB_GROUP_COLORS[group.name] ?? '#666'} 40%, transparent)` }} />
              </div>
              {group.skills.map((record) => (
                <SkillRow key={record.skill} record={record}
                  displayName={stripLangPrefix ? langDisplayName(record.skill) : undefined} />
              ))}
            </div>
          ) : null,
        )
      ) : (
        skills.map((record) => (
          <SkillRow key={record.skill} record={record}
            displayName={stripLangPrefix ? langDisplayName(record.skill) : undefined} />
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

export function SkillPanel({ mode = 'slideout', onPin }: SkillPanelProps) {
  const { activeCharacter, skillData, showInlineImproves, toggleInlineImproves } = useSkillTrackerContext();
  const dataStore = useDataStore();
  const [filter, setFilter] = useState<FilterValue>('all');
  const [sort, setSort] = useState<SortMode>('name');
  const [showSubs, setShowSubs] = useState(true);
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
      combat: [], magic: [], spells: [], crafting: [], language: [], thief: [], other: [],
    };
    for (const record of Object.values(skillData.skills)) {
      const cat = getSkillCategory(record.skill);
      groups[cat].push(record);
    }
    for (const cat of CATEGORY_ORDER) {
      groups[cat] = sortSkills(groups[cat], sort);
    }
    return groups;
  }, [skillData.skills, sort]);

  const allSkillsSorted = useMemo(() => {
    return sortSkills(Object.values(skillData.skills), sort);
  }, [skillData.skills, sort]);

  const visibleCategories = useMemo(() => {
    if (filter === 'all') return CATEGORY_ORDER.filter((cat) => categorizedSkills[cat].length > 0);
    return categorizedSkills[filter].length > 0 ? [filter] : [];
  }, [filter, categorizedSkills]);

  const petSections = useMemo(() => {
    return Object.entries(skillData.pets)
      .map(([petName, skills]) => ({
        name: petName,
        skills: sortSkills(Object.values(skills), sort),
      }))
      .filter((s) => s.skills.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [skillData.pets, sort]);

  const hasAnySkills =
    CATEGORY_ORDER.some((cat) => categorizedSkills[cat].length > 0) ||
    petSections.length > 0;

  const showPets = filter === 'all';

  const [showPinMenu, setShowPinMenu] = useState(false);

  const isPinned = mode === 'pinned';

  return (
    <div className={isPinned ? 'h-full flex flex-col overflow-hidden' : 'w-[360px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden'}>
      {/* Header — only in slide-out mode (pinned mode uses PinnedPanelWrapper header) */}
      {!isPinned && (
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[13px] font-semibold text-text-heading">
          Skills{activeCharacter ? ` (${activeCharacter.charAt(0).toUpperCase()}${activeCharacter.slice(1)})` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {onPin && (
            <div className="relative">
              <button
                onClick={() => setShowPinMenu((v) => !v)}
                title="Pin panel"
                className="flex items-center rounded text-[10px] cursor-pointer px-1.5 py-[2px] transition-all duration-200 ease-in-out border bg-transparent border-border-dim text-text-dim hover:text-green hover:border-green/40"
              >
                <PinIcon size={10} />
              </button>
              {showPinMenu && (
                <div className="absolute top-full right-0 mt-1 z-50 flex flex-col gap-0.5 bg-bg-secondary border border-border rounded-md p-1 shadow-lg min-w-[100px]">
                  <button
                    onClick={() => { onPin('left'); setShowPinMenu(false); }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer transition-colors duration-100"
                  >
                    <ArrowLeftIcon size={9} /> Pin Left
                  </button>
                  <button
                    onClick={() => { onPin('right'); setShowPinMenu(false); }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer transition-colors duration-100"
                  >
                    <ArrowRightIcon size={9} /> Pin Right
                  </button>
                </div>
              )}
            </div>
          )}
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
          <button
            onClick={() => toggleInlineImproves(!showInlineImproves)}
            title="Show skill improves inline in terminal"
            className={`flex items-center rounded text-[10px] cursor-pointer px-1.5 py-[2px] transition-all duration-200 ease-in-out border ${
              showInlineImproves
                ? 'bg-cyan/15 border-cyan/40 text-cyan'
                : 'bg-transparent border-border-dim text-text-dim hover:text-text-label'
            }`}
          >
            Inline
          </button>
        </div>
      </div>
      )}

      {/* Pinned mode controls */}
      {isPinned && (
        <div className="flex items-center justify-end gap-1.5 px-2 py-1.5 border-b border-border-subtle">
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
          <button
            onClick={() => toggleInlineImproves(!showInlineImproves)}
            title="Show skill improves inline in terminal"
            className={`flex items-center rounded text-[10px] cursor-pointer px-1.5 py-[2px] transition-all duration-200 ease-in-out border ${
              showInlineImproves
                ? 'bg-cyan/15 border-cyan/40 text-cyan'
                : 'bg-transparent border-border-dim text-text-dim hover:text-text-label'
            }`}
          >
            Inline
          </button>
        </div>
      )}

      {/* Category filter */}
      {hasAnySkills && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle flex-wrap">
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
          <SkillSection skills={allSkillsSorted} />
        ) : (
          /* Single category view — with subcategories for combat */
          visibleCategories.map((cat) => (
            <SkillSection
              key={cat}
              skills={categorizedSkills[cat]}
              subGroups={cat === 'combat' && showSubs ? buildSubGroups(categorizedSkills[cat], cat, sort) : undefined}
              stripLangPrefix={cat === 'language'}
            />
          ))
        )}

        {showPets && petSections.map((section) => (
          <SkillSection
            key={section.name}
            title={section.name}
            skills={section.skills}
          />
        ))}
      </div>
    </div>
  );
}

const ACCENT_STYLES: Record<string, string> = {
  cyan: 'bg-cyan/15 border-cyan/40 text-cyan',
  amber: 'bg-amber/15 border-amber/40 text-amber',
};

function FilterPill({
  label,
  active,
  accent,
  onClick,
}: {
  label: string;
  active: boolean;
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[10px] font-mono rounded-full border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
        active
          ? ACCENT_STYLES[accent ?? 'cyan']
          : 'bg-transparent border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle'
      }`}
    >
      {label}
    </button>
  );
}
