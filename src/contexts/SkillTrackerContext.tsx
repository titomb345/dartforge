import { createContext, useContext } from 'react';
import type { CharacterSkillFile } from '../types/skills';

export interface SkillTrackerState {
  activeCharacter: string | null;
  skillData: CharacterSkillFile;
  showInlineImproves: boolean;
  toggleInlineImproves: (value: boolean) => void;
  addSkill: (skill: string, count?: number) => void;
  updateSkillCount: (skill: string, newCount: number) => void;
  deleteSkill: (skill: string, petName?: string) => void;
}

const SkillTrackerContext = createContext<SkillTrackerState | null>(null);

export const SkillTrackerProvider = SkillTrackerContext.Provider;

export function useSkillTrackerContext(): SkillTrackerState {
  const ctx = useContext(SkillTrackerContext);
  if (!ctx) throw new Error('useSkillTrackerContext must be used within a SkillTrackerProvider');
  return ctx;
}
