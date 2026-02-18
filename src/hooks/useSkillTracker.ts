import { useState, useCallback, useEffect, useRef } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { CharacterSkillFile, SkillMatchResult, SkillRecord } from '../types/skills';
import { getTierForCount, getTierByName, getImprovesToNextTier } from '../lib/skillTiers';
import { matchSkillLine } from '../lib/skillPatterns';
import { smartWrite } from '../lib/terminalUtils';
import type { OutputProcessor } from '../lib/outputProcessor';
import type { DataStore } from '../contexts/DataStoreContext';

const SETTINGS_FILE = 'settings.json';
const ACTIVE_CHAR_KEY = 'activeCharacter';
const INLINE_IMPROVES_KEY = 'showInlineImproves';
const SHOW_SKILL_TIMEOUT_MS = 15_000;

const EMPTY_SKILL_FILE: CharacterSkillFile = { skills: {}, pets: {} };

function skillFileName(name: string): string {
  return `skills-${name.toLowerCase()}.json`;
}

export function useSkillTracker(
  sendCommandRef: React.RefObject<((cmd: string) => Promise<void>) | null>,
  processorRef: React.RefObject<OutputProcessor | null>,
  terminalRef: React.RefObject<XTerm | null>,
  dataStore: DataStore,
) {
  const [activeCharacter, setActiveCharacterState] = useState<string | null>(null);
  const activeCharacterRef = useRef<string | null>(null);
  const [skillData, setSkillData] = useState<CharacterSkillFile>({ ...EMPTY_SKILL_FILE });
  const skillDataRef = useRef<CharacterSkillFile>(skillData);
  skillDataRef.current = skillData;
  const lastImproveRef = useRef<{ who: 'self' | string; skill: string; prevCount: number } | null>(null);

  // Inline improve toggle
  const [showInlineImproves, setShowInlineImproves] = useState(false);
  const showInlineImprovesRef = useRef(false);

  // Keep a stable ref to dataStore for use in callbacks
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;

  // Track whether initial load is done (to avoid persisting defaults)
  const loadedRef = useRef(false);

  // Load last active character + inline preference from settings on mount
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const saved = await dataStore.get<string>(SETTINGS_FILE, ACTIVE_CHAR_KEY);
        if (saved) {
          await loadCharacterSkills(saved);
        }
        const inlinePref = await dataStore.get<boolean>(SETTINGS_FILE, INLINE_IMPROVES_KEY);
        if (inlinePref != null) {
          showInlineImprovesRef.current = inlinePref;
          setShowInlineImproves(inlinePref);
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
      loadedRef.current = true;
    })();
  }, [dataStore.ready]);

  async function loadCharacterSkills(name: string) {
    const lower = name.toLowerCase();
    activeCharacterRef.current = lower;
    setActiveCharacterState(lower);
    try {
      const ds = dataStoreRef.current;
      const filename = skillFileName(lower);
      const skills = (await ds.get<CharacterSkillFile['skills']>(filename, 'skills')) ?? {};
      const pets = (await ds.get<CharacterSkillFile['pets']>(filename, 'pets')) ?? {};
      setSkillData({ skills, pets });
    } catch (e) {
      console.error('Failed to load skill data for', lower, e);
      setSkillData({ ...EMPTY_SKILL_FILE });
    }
  }

  async function saveSkillData(name: string, data: CharacterSkillFile) {
    try {
      const ds = dataStoreRef.current;
      const filename = skillFileName(name);
      await ds.set(filename, 'skills', data.skills);
      await ds.set(filename, 'pets', data.pets);
      await ds.save(filename);
    } catch (e) {
      console.error('Failed to save skill data:', e);
    }
  }

  // Persist skill data whenever it changes (after initial load)
  useEffect(() => {
    if (!loadedRef.current) return;
    const charName = activeCharacterRef.current;
    if (!charName) return;
    saveSkillData(charName, skillData);
  }, [skillData]);

  const setActiveCharacter = useCallback(async (name: string) => {
    const lower = name.toLowerCase();
    // Persist to settings
    try {
      const ds = dataStoreRef.current;
      await ds.set(SETTINGS_FILE, ACTIVE_CHAR_KEY, lower);
      await ds.save(SETTINGS_FILE);
    } catch (e) {
      console.error('Failed to save active character:', e);
    }
    await loadCharacterSkills(lower);
  }, []);

  const toggleInlineImproves = useCallback(async (value: boolean) => {
    showInlineImprovesRef.current = value;
    setShowInlineImproves(value);
    try {
      const ds = dataStoreRef.current;
      await ds.set(SETTINGS_FILE, INLINE_IMPROVES_KEY, value);
      await ds.save(SETTINGS_FILE);
    } catch (e) {
      console.error('Failed to save inline improve setting:', e);
    }
  }, []);

  const handleSkillMatch = useCallback((match: SkillMatchResult) => {
    const charName = activeCharacterRef.current;
    if (!charName && match.type !== 'mistake') return;

    if (match.type === 'self-improve') {
      // Read current count from ref for inline display
      const prevCount = skillDataRef.current.skills[match.skill]?.count ?? 0;
      const newCount = prevCount + 1;

      // Set ref outside updater
      lastImproveRef.current = { who: 'self', skill: match.skill, prevCount };

      // Write inline outside updater (executes once)
      if (showInlineImprovesRef.current && terminalRef.current) {
        const tier = getTierForCount(newCount);
        const toNext = getImprovesToNextTier(newCount);
        const nextInfo = toNext > 0 ? ` | ${toNext} to next` : '';
        const line = `\x1b[36m[${match.skill} +1 \u2192 ${newCount} (${tier.abbr})${nextInfo}]\x1b[0m\r\n`;
        smartWrite(terminalRef.current, line);
      }

      // Send verification command outside updater
      if (sendCommandRef.current) {
        sendCommandRef.current(`show skills ${match.skill}`).catch(console.error);
      }
      if (processorRef.current) {
        processorRef.current.registerTempMatcher(
          (line: string) => {
            const result = matchSkillLine(line);
            if (result && result.type === 'shown-skill') return result;
            return null;
          },
          SHOW_SKILL_TIMEOUT_MS,
        );
      }

      // Pure state update
      const now = new Date().toISOString();
      setSkillData((prev) => {
        const existing = prev.skills[match.skill];
        const pc = existing?.count ?? 0;
        const nc = pc + 1;
        const record: SkillRecord = { skill: match.skill, count: nc, lastImproveAt: now };
        return { ...prev, skills: { ...prev.skills, [match.skill]: record } };
      });

    } else if (match.type === 'pet-improve') {
      const petSkills = skillDataRef.current.pets[match.pet] ?? {};
      const prevCount = petSkills[match.skill]?.count ?? 0;
      const newCount = prevCount + 1;

      lastImproveRef.current = { who: match.pet, skill: match.skill, prevCount };

      if (showInlineImprovesRef.current && terminalRef.current) {
        const tier = getTierForCount(newCount);
        const toNext = getImprovesToNextTier(newCount);
        const nextInfo = toNext > 0 ? ` | ${toNext} to next` : '';
        const line = `\x1b[35m[${match.pet}: ${match.skill} +1 \u2192 ${newCount} (${tier.abbr})${nextInfo}]\x1b[0m\r\n`;
        smartWrite(terminalRef.current, line);
      }

      const now = new Date().toISOString();
      setSkillData((prev) => {
        const ps = prev.pets[match.pet] ?? {};
        const existing = ps[match.skill];
        const pc = existing?.count ?? 0;
        const nc = pc + 1;
        const record: SkillRecord = { skill: match.skill, count: nc, lastImproveAt: now };
        return {
          ...prev,
          pets: { ...prev.pets, [match.pet]: { ...ps, [match.skill]: record } },
        };
      });

    } else if (match.type === 'mistake') {
      // Read and clear ref OUTSIDE updater (critical for StrictMode)
      const last = lastImproveRef.current;
      if (!last) return;
      lastImproveRef.current = null;

      // Write inline correction outside updater
      if (showInlineImprovesRef.current && terminalRef.current) {
        const tier = getTierForCount(last.prevCount);
        const label = last.who === 'self' ? last.skill : `${last.who}: ${last.skill}`;
        const line = `\x1b[33m[${label} -1 (mistake) \u2192 ${last.prevCount} (${tier.abbr})]\x1b[0m\r\n`;
        smartWrite(terminalRef.current, line);
      }

      // Pure state update using captured `last`
      setSkillData((prev) => {
        if (last.who === 'self') {
          const existing = prev.skills[last.skill];
          if (!existing) return prev;
          return {
            ...prev,
            skills: { ...prev.skills, [last.skill]: { ...existing, count: last.prevCount } },
          };
        } else {
          const petSkills = prev.pets[last.who];
          if (!petSkills?.[last.skill]) return prev;
          return {
            ...prev,
            pets: {
              ...prev.pets,
              [last.who]: { ...petSkills, [last.skill]: { ...petSkills[last.skill], count: last.prevCount } },
            },
          };
        }
      });

    } else if (match.type === 'shown-skill') {
      // Pure — no side effects needed
      setSkillData((prev) => {
        const existing = prev.skills[match.skill];
        if (!existing) return prev;

        const expectedTier = getTierForCount(existing.count);
        const reportedTier = getTierByName(match.level);
        if (!reportedTier) return prev;

        if (expectedTier.level !== reportedTier.level) {
          console.log(
            `Skill mismatch: ${match.skill} expected ${expectedTier.name} (${existing.count}) but MUD reports ${reportedTier.name}. Resetting to ${reportedTier.min}.`,
          );
          return {
            ...prev,
            skills: { ...prev.skills, [match.skill]: { ...existing, count: reportedTier.min } },
          };
        }
        return prev;
      });
    }
  }, [sendCommandRef, processorRef, terminalRef]);

  return {
    activeCharacter,
    skillData,
    setActiveCharacter,
    handleSkillMatch,
    showInlineImproves,
    toggleInlineImproves,
  };
}
