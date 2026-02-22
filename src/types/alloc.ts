export type AllocSlot = 'bonus' | 'daring' | 'speed' | 'aiming' | 'parry' | 'control';

export const ALLOC_SLOTS: AllocSlot[] = ['bonus', 'daring', 'speed', 'aiming', 'parry', 'control'];

export const SLOT_SHORT: Record<AllocSlot, string> = {
  bonus: 'b',
  daring: 'd',
  speed: 's',
  aiming: 'a',
  parry: 'p',
  control: 'c',
};

export const POINTS_PER_LIMB = 300;

export interface LimbAllocation {
  bonus: number;
  daring: number;
  speed: number;
  aiming: number;
  parry: number;
  control: number;
}

export interface AllocProfile {
  id: string;
  name: string;
  limbs: Record<string, LimbAllocation>;
  isActive: boolean;
}

export type AllocView = 'live' | 'profiles';

export interface AllocData {
  profiles: AllocProfile[];
  currentProfileIndex: number;
  detectedLimbs: string[];
  /** Live allocations as reported by the MUD (updated on each parse). */
  liveAllocations: Record<string, LimbAllocation>;
}

export const EMPTY_LIMB: LimbAllocation = {
  bonus: 0,
  daring: 0,
  speed: 0,
  aiming: 0,
  parry: 0,
  control: 0,
};

/* ------------------------------------------------------------------ */
/*  Magic allocations                                                   */
/* ------------------------------------------------------------------ */

export type MagicSlot = 'air' | 'fire' | 'water' | 'earth';

export const MAGIC_SLOTS: MagicSlot[] = ['air', 'fire', 'water', 'earth'];

export const MAGIC_SLOT_SHORT: Record<MagicSlot, string> = {
  air: 'a',
  fire: 'f',
  water: 'w',
  earth: 'e',
};

export const MAGIC_POINTS = 100;

export interface MagicAllocation {
  air: number;
  fire: number;
  water: number;
  earth: number;
}

export interface MagicProfile {
  id: string;
  name: string;
  alloc: MagicAllocation;
  isActive: boolean;
}

export interface MagicData {
  profiles: MagicProfile[];
  currentProfileIndex: number;
  liveAllocation: MagicAllocation;
}

export const EMPTY_MAGIC: MagicAllocation = { air: 0, fire: 0, water: 0, earth: 0 };

export type AllocTab = 'combat' | 'magic';
