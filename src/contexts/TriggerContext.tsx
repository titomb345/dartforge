import { createContext, useContext } from 'react';
import type {
  Trigger,
  TriggerId,
  TriggerMatchMode,
  TriggerPrefill,
  TriggerScope,
} from '../types/trigger';

export interface TriggerState {
  characterTriggers: Record<TriggerId, Trigger>;
  globalTriggers: Record<TriggerId, Trigger>;
  mergedTriggers: Trigger[];
  createTrigger: (
    partial: {
      pattern: string;
      matchMode: TriggerMatchMode;
      body: string;
      group: string;
      cooldownMs?: number;
      gag?: boolean;
      highlight?: string | null;
      soundAlert?: boolean;
    },
    scope: TriggerScope
  ) => TriggerId;
  updateTrigger: (
    id: TriggerId,
    updates: Partial<Omit<Trigger, 'id' | 'createdAt'>>,
    scope: TriggerScope
  ) => void;
  deleteTrigger: (id: TriggerId, scope: TriggerScope) => void;
  toggleTrigger: (id: TriggerId, scope: TriggerScope) => void;
  duplicateTrigger: (id: TriggerId, scope: TriggerScope) => TriggerId | null;
  triggerPrefill: TriggerPrefill | null;
  setTriggerPrefill: (prefill: TriggerPrefill | null) => void;
}

const TriggerContext = createContext<TriggerState | null>(null);

export const TriggerProvider = TriggerContext.Provider;

export function useTriggerContext(): TriggerState {
  const ctx = useContext(TriggerContext);
  if (!ctx) throw new Error('useTriggerContext must be used within a TriggerProvider');
  return ctx;
}
