import { useState, useCallback, useEffect, useRef } from 'react';
import { load } from '@tauri-apps/plugin-store';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { CharacterSkillFile, SkillMatchResult, SkillRecord } from '../types/skills';
import { getTierForCount, getTierByName, getImprovesToNextTier } from '../lib/skillTiers';
import { matchSkillLine } from '../lib/skillPatterns';
import { smartWrite } from '../lib/terminalUtils';
import type { OutputProcessor } from '../lib/outputProcessor';

const SETTINGS_FILE = 'settings.json';
const ACTIVE_CHAR_KEY = 'activeCharacter';
const INLINE_IMPROVES_KEY = 'showInlineImproves';
const SHOW_SKILL_TIMEOUT_MS = 15_000;

const EMPTY_SKILL_FILE: CharacterSkillFile = { skills: {}, pets: {} };

function storeFileName(name: string): string {
  return `skills-${name.toLowerCase()}.json`;
}

export function useSkillTracker(
  sendCommandRef: React.RefObject<((cmd: string) => Promise<void>) | null>,
  processorRef: React.RefObject<OutputProcessor | null>,
  terminalRef: React.RefObject<XTerm | null>,
) {
  const [activeCharacter, setActiveCharacterState] = useState<string | null>(null);
  const activeCharacterRef = useRef<string | null>(null);
  const [skillData, setSkillData] = useState<CharacterSkillFile>({ ...EMPTY_SKILL_FILE });
  const lastImproveRef = useRef<{ who: 'self' | string; skill: string; prevCount: number } | null>(null);

  // Inline improve toggle
  const [showInlineImproves, setShowInlineImproves] = useState(false);
  const showInlineImprovesRef = useRef(false);

  // Load last active character + inline preference from settings on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await load(SETTINGS_FILE);
        const saved = await store.get<string>(ACTIVE_CHAR_KEY);
        if (saved) {
          await loadCharacterSkills(saved);
        }
        const inlinePref = await store.get<boolean>(INLINE_IMPROVES_KEY);
        if (inlinePref != null) {
          showInlineImprovesRef.current = inlinePref;
          setShowInlineImproves(inlinePref);
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    })();
  }, []);

  async function loadCharacterSkills(name: string) {
    const lower = name.toLowerCase();
    activeCharacterRef.current = lower;
    setActiveCharacterState(lower);
    try {
      const store = await load(storeFileName(lower));
      const skills = (await store.get<CharacterSkillFile['skills']>('skills')) ?? {};
      const pets = (await store.get<CharacterSkillFile['pets']>('pets')) ?? {};
      setSkillData({ skills, pets });
    } catch (e) {
      console.error('Failed to load skill data for', lower, e);
      setSkillData({ ...EMPTY_SKILL_FILE });
    }
  }

  async function saveSkillData(name: string, data: CharacterSkillFile) {
    try {
      const store = await load(storeFileName(name));
      await store.set('skills', data.skills);
      await store.set('pets', data.pets);
      await store.save();
    } catch (e) {
      console.error('Failed to save skill data:', e);
    }
  }

  const setActiveCharacter = useCallback(async (name: string) => {
    const lower = name.toLowerCase();
    // Persist to settings
    try {
      const store = await load(SETTINGS_FILE);
      await store.set(ACTIVE_CHAR_KEY, lower);
      await store.save();
    } catch (e) {
      console.error('Failed to save active character:', e);
    }
    await loadCharacterSkills(lower);
  }, []);

  const toggleInlineImproves = useCallback(async (value: boolean) => {
    showInlineImprovesRef.current = value;
    setShowInlineImproves(value);
    try {
      const store = await load(SETTINGS_FILE);
      await store.set(INLINE_IMPROVES_KEY, value);
      await store.save();
    } catch (e) {
      console.error('Failed to save inline improve setting:', e);
    }
  }, []);

  const handleSkillMatch = useCallback((match: SkillMatchResult) => {
    setSkillData((prev) => {
      const charName = activeCharacterRef.current;
      if (!charName && match.type !== 'mistake') return prev;

      const now = new Date().toISOString();
      let next = prev;

      if (match.type === 'self-improve') {
        const existing = prev.skills[match.skill];
        const prevCount = existing?.count ?? 0;
        const newCount = prevCount + 1;
        const record: SkillRecord = { skill: match.skill, count: newCount, lastImproveAt: now };
        next = {
          ...prev,
          skills: { ...prev.skills, [match.skill]: record },
        };
        lastImproveRef.current = { who: 'self', skill: match.skill, prevCount };

        // Write inline improve message to terminal
        if (showInlineImprovesRef.current && terminalRef.current) {
          const tier = getTierForCount(newCount);
          const toNext = getImprovesToNextTier(newCount);
          const nextInfo = toNext > 0 ? ` | ${toNext} to next` : '';
          const line = `\x1b[36m[${match.skill} +1 \u2192 ${newCount} (${tier.abbr})${nextInfo}]\x1b[0m\r\n`;
          smartWrite(terminalRef.current, line);
        }

        // Trigger skill level verification
        if (sendCommandRef.current) {
          sendCommandRef.current(`show skills: ${match.skill}`).catch(console.error);
        }
        // Register temp matcher for the shown-skill response
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
      } else if (match.type === 'pet-improve') {
        const petSkills = prev.pets[match.pet] ?? {};
        const existing = petSkills[match.skill];
        const prevCount = existing?.count ?? 0;
        const newCount = prevCount + 1;
        const record: SkillRecord = { skill: match.skill, count: newCount, lastImproveAt: now };
        next = {
          ...prev,
          pets: {
            ...prev.pets,
            [match.pet]: { ...petSkills, [match.skill]: record },
          },
        };
        lastImproveRef.current = { who: match.pet, skill: match.skill, prevCount };

        // Write inline improve message to terminal (pet)
        if (showInlineImprovesRef.current && terminalRef.current) {
          const tier = getTierForCount(newCount);
          const toNext = getImprovesToNextTier(newCount);
          const nextInfo = toNext > 0 ? ` | ${toNext} to next` : '';
          const line = `\x1b[35m[${match.pet}: ${match.skill} +1 \u2192 ${newCount} (${tier.abbr})${nextInfo}]\x1b[0m\r\n`;
          smartWrite(terminalRef.current, line);
        }
      } else if (match.type === 'mistake') {
        if (!lastImproveRef.current) return prev;
        const { who, skill, prevCount } = lastImproveRef.current;
        lastImproveRef.current = null;

        if (who === 'self') {
          const existing = prev.skills[skill];
          if (!existing) return prev;
          next = {
            ...prev,
            skills: { ...prev.skills, [skill]: { ...existing, count: prevCount } },
          };
        } else {
          const petSkills = prev.pets[who];
          if (!petSkills?.[skill]) return prev;
          next = {
            ...prev,
            pets: {
              ...prev.pets,
              [who]: { ...petSkills, [skill]: { ...petSkills[skill], count: prevCount } },
            },
          };
        }
      } else if (match.type === 'shown-skill') {
        // Compare MUD-reported level with our expected level
        const existing = prev.skills[match.skill];
        if (!existing) return prev;

        const expectedTier = getTierForCount(existing.count);
        const reportedTier = getTierByName(match.level);
        if (!reportedTier) return prev;

        if (expectedTier.level !== reportedTier.level) {
          // Mismatch — reset count to the minimum for the reported tier
          console.log(
            `Skill mismatch: ${match.skill} expected ${expectedTier.name} (${existing.count}) but MUD reports ${reportedTier.name}. Resetting to ${reportedTier.min}.`,
          );
          next = {
            ...prev,
            skills: { ...prev.skills, [match.skill]: { ...existing, count: reportedTier.min } },
          };
        }
      }

      // Persist asynchronously
      if (next !== prev && charName) {
        saveSkillData(charName, next);
      }

      return next;
    });
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
