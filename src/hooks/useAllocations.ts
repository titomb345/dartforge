import { useState, useCallback, useEffect, useRef } from 'react';
import type { AllocData, AllocProfile, AllocSlot, AllocView, AllocTab, LimbAllocation, MagicAllocation, MagicData, MagicProfile, MagicSlot } from '../types/alloc';
import { EMPTY_LIMB, EMPTY_MAGIC } from '../types/alloc';
import { updateSlot, buildAllocCommand, updateMagicSlot, buildMagicAllocCommand } from '../lib/allocPatterns';
import type { AllocParseResult, MagicParseResult } from '../lib/allocPatterns';
import type { DataStore } from '../contexts/DataStoreContext';

function allocFileName(name: string): string {
  return `alloc-${name.toLowerCase()}.json`;
}

const EMPTY_DATA: AllocData = {
  profiles: [],
  currentProfileIndex: 0,
  detectedLimbs: [],
  liveAllocations: {},
};

const EMPTY_MAGIC_DATA: MagicData = {
  profiles: [],
  currentProfileIndex: 0,
  liveAllocation: { ...EMPTY_MAGIC },
};

let nextId = 1;
function genId(): string {
  return `alloc-${Date.now()}-${nextId++}`;
}

export interface AllocState {
  // Combat
  data: AllocData;
  view: AllocView;
  setView: (view: AllocView) => void;
  currentProfile: AllocProfile | null;
  setCurrentProfileIndex: (idx: number) => void;
  createProfile: (name?: string) => void;
  createProfileFromLive: (name?: string) => void;
  updateProfileFromLive: (profileId: string) => void;
  deleteProfile: (id: string) => void;
  duplicateProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;
  updateLimbSlot: (profileId: string, limb: string, slot: AllocSlot, value: number) => void;
  setLimbSlotDelta: (profileId: string, limb: string, slot: AllocSlot, delta: number) => void;
  updateLiveLimbSlot: (limb: string, slot: AllocSlot, value: number) => void;
  setLiveLimbSlotDelta: (limb: string, slot: AllocSlot, delta: number) => void;
  setProfileActive: (id: string, active: boolean) => void;
  handleAllocParse: (result: AllocParseResult) => void;
  navigateProfile: (direction: 'prev' | 'next') => void;
  applyLimb: (profileId: string, limb: string) => void;
  applyAll: (profileId: string) => void;
  applyLiveLimb: (limb: string) => void;
  applyLiveAll: () => void;
  loadProfileToLive: (profileId: string) => void;

  // Tab toggle
  allocTab: AllocTab;
  setAllocTab: (tab: AllocTab) => void;

  // Magic
  magicData: MagicData;
  magicView: AllocView;
  setMagicView: (view: AllocView) => void;
  currentMagicProfile: MagicProfile | null;
  navigateMagicProfile: (direction: 'prev' | 'next') => void;
  createMagicProfile: (name?: string) => void;
  createMagicProfileFromLive: (name?: string) => void;
  updateMagicProfileFromLive: (profileId: string) => void;
  deleteMagicProfile: (id: string) => void;
  duplicateMagicProfile: (id: string) => void;
  renameMagicProfile: (id: string, name: string) => void;
  updateMagicProfileSlot: (profileId: string, slot: MagicSlot, value: number) => void;
  setMagicProfileSlotDelta: (profileId: string, slot: MagicSlot, delta: number) => void;
  updateMagicLiveSlot: (slot: MagicSlot, value: number) => void;
  setMagicLiveSlotDelta: (slot: MagicSlot, delta: number) => void;
  setMagicProfileActive: (id: string, active: boolean) => void;
  handleMagicParse: (result: MagicParseResult) => void;
  applyMagic: (profileId: string) => void;
  applyMagicLive: () => void;
  loadMagicProfileToLive: (profileId: string) => void;
}

export function useAllocations(
  sendCommandRef: React.RefObject<((cmd: string) => Promise<void>) | null>,
  dataStore: DataStore,
  activeCharacter: string | null,
): AllocState {
  const [data, setData] = useState<AllocData>({ ...EMPTY_DATA });
  const [view, setView] = useState<AllocView>('live');
  const [allocTab, setAllocTab] = useState<AllocTab>('combat');
  const dataRef = useRef(data);
  dataRef.current = data;
  const loadedRef = useRef(false);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const activeCharRef = useRef(activeCharacter);
  activeCharRef.current = activeCharacter;

  // Magic state
  const [magicData, setMagicData] = useState<MagicData>({ ...EMPTY_MAGIC_DATA });
  const [magicView, setMagicView] = useState<AllocView>('live');
  const magicDataRef = useRef(magicData);
  magicDataRef.current = magicData;
  const magicLoadedRef = useRef(false);

  // Load alloc data when character changes
  useEffect(() => {
    if (!dataStore.ready || !activeCharacter) return;
    loadedRef.current = false;
    magicLoadedRef.current = false;
    (async () => {
      try {
        const filename = allocFileName(activeCharacter);
        const profiles = await dataStore.get<AllocProfile[]>(filename, 'profiles');
        const currentProfileIndex = await dataStore.get<number>(filename, 'currentProfileIndex');
        const detectedLimbs = await dataStore.get<string[]>(filename, 'detectedLimbs');
        const liveAllocations = await dataStore.get<Record<string, LimbAllocation>>(filename, 'liveAllocations');
        setData({
          profiles: profiles ?? [],
          currentProfileIndex: currentProfileIndex ?? 0,
          detectedLimbs: detectedLimbs ?? [],
          liveAllocations: liveAllocations ?? {},
        });
        // Load magic data
        const magicProfiles = await dataStore.get<MagicProfile[]>(filename, 'magicProfiles');
        const magicCurrentIndex = await dataStore.get<number>(filename, 'magicCurrentProfileIndex');
        const magicLive = await dataStore.get<MagicAllocation>(filename, 'magicLiveAllocation');
        setMagicData({
          profiles: magicProfiles ?? [],
          currentProfileIndex: magicCurrentIndex ?? 0,
          liveAllocation: magicLive ?? { ...EMPTY_MAGIC },
        });
      } catch (e) {
        console.error('Failed to load alloc data:', e);
        setData({ ...EMPTY_DATA });
        setMagicData({ ...EMPTY_MAGIC_DATA });
      }
      loadedRef.current = true;
      magicLoadedRef.current = true;
    })();
  }, [dataStore.ready, activeCharacter]);

  // Persist combat data
  useEffect(() => {
    if (!loadedRef.current) return;
    const charName = activeCharRef.current;
    if (!charName) return;
    const filename = allocFileName(charName);
    const ds = dataStoreRef.current;
    (async () => {
      try {
        await ds.set(filename, 'profiles', data.profiles);
        await ds.set(filename, 'currentProfileIndex', data.currentProfileIndex);
        await ds.set(filename, 'detectedLimbs', data.detectedLimbs);
        await ds.set(filename, 'liveAllocations', data.liveAllocations);
        await ds.save(filename);
      } catch (e) {
        console.error('Failed to save alloc data:', e);
      }
    })();
  }, [data]);

  // Persist magic data
  useEffect(() => {
    if (!magicLoadedRef.current) return;
    const charName = activeCharRef.current;
    if (!charName) return;
    const filename = allocFileName(charName);
    const ds = dataStoreRef.current;
    (async () => {
      try {
        await ds.set(filename, 'magicProfiles', magicData.profiles);
        await ds.set(filename, 'magicCurrentProfileIndex', magicData.currentProfileIndex);
        await ds.set(filename, 'magicLiveAllocation', magicData.liveAllocation);
        await ds.save(filename);
      } catch (e) {
        console.error('Failed to save magic alloc data:', e);
      }
    })();
  }, [magicData]);

  const currentProfile = data.profiles[data.currentProfileIndex] ?? null;

  const setCurrentProfileIndex = useCallback((idx: number) => {
    setData((prev) => ({
      ...prev,
      currentProfileIndex: Math.max(0, Math.min(prev.profiles.length - 1, idx)),
    }));
  }, []);

  const navigateProfile = useCallback((direction: 'prev' | 'next') => {
    setData((prev) => {
      if (prev.profiles.length === 0) return prev;
      const delta = direction === 'prev' ? -1 : 1;
      const next = (prev.currentProfileIndex + delta + prev.profiles.length) % prev.profiles.length;
      return { ...prev, currentProfileIndex: next };
    });
  }, []);

  const createProfile = useCallback((name?: string) => {
    setData((prev) => {
      const limbNames = prev.detectedLimbs.length > 0 ? prev.detectedLimbs : ['right hand', 'left hand'];
      const limbs: Record<string, LimbAllocation> = {};
      for (const limb of limbNames) {
        limbs[limb] = { ...EMPTY_LIMB };
      }
      const profile: AllocProfile = {
        id: genId(),
        name: name ?? `Profile ${prev.profiles.length + 1}`,

        limbs,
        isActive: false,
      };
      const profiles = [...prev.profiles, profile];
      return { ...prev, profiles, currentProfileIndex: profiles.length - 1 };
    });
    setView('profiles');
  }, []);

  /** Create a new profile pre-populated from the current live allocations. */
  const createProfileFromLive = useCallback((name?: string) => {
    setData((prev) => {
      const limbs: Record<string, LimbAllocation> = {};
      for (const limbName of prev.detectedLimbs) {
        limbs[limbName] = prev.liveAllocations[limbName]
          ? { ...prev.liveAllocations[limbName] }
          : { ...EMPTY_LIMB };
      }
      const profile: AllocProfile = {
        id: genId(),
        name: name ?? `Profile ${prev.profiles.length + 1}`,

        limbs,
        isActive: false,
      };
      const profiles = [...prev.profiles, profile];
      return { ...prev, profiles, currentProfileIndex: profiles.length - 1 };
    });
    setView('profiles');
  }, []);

  /** Overwrite an existing profile's limb data with current live allocations. */
  const updateProfileFromLive = useCallback((profileId: string) => {
    setData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => {
        if (p.id !== profileId) return p;
        const limbs: Record<string, LimbAllocation> = {};
        for (const limbName of prev.detectedLimbs) {
          limbs[limbName] = prev.liveAllocations[limbName]
            ? { ...prev.liveAllocations[limbName] }
            : { ...EMPTY_LIMB };
        }
        return { ...p, limbs };
      }),
    }));
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setData((prev) => {
      const profiles = prev.profiles.filter((p) => p.id !== id);
      const idx = Math.min(prev.currentProfileIndex, Math.max(0, profiles.length - 1));
      return { ...prev, profiles, currentProfileIndex: idx };
    });
  }, []);

  const duplicateProfile = useCallback((id: string) => {
    setData((prev) => {
      const source = prev.profiles.find((p) => p.id === id);
      if (!source) return prev;
      const copy: AllocProfile = {
        ...source,
        id: genId(),
        name: `${source.name} (copy)`,
        isActive: false,
        limbs: Object.fromEntries(
          Object.entries(source.limbs).map(([k, v]) => [k, { ...v }]),
        ),
      };
      const profiles = [...prev.profiles, copy];
      return { ...prev, profiles, currentProfileIndex: profiles.length - 1 };
    });
  }, []);

  const renameProfile = useCallback((id: string, name: string) => {
    setData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  }, []);

  const updateLimbSlot = useCallback((profileId: string, limb: string, slot: AllocSlot, value: number) => {
    setData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => {
        if (p.id !== profileId) return p;
        const limbAlloc = p.limbs[limb] ?? { ...EMPTY_LIMB };
        return {
          ...p,
          limbs: { ...p.limbs, [limb]: updateSlot(limbAlloc, slot, value) },
        };
      }),
    }));
  }, []);

  const setLimbSlotDelta = useCallback((profileId: string, limb: string, slot: AllocSlot, delta: number) => {
    setData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => {
        if (p.id !== profileId) return p;
        const limbAlloc = p.limbs[limb] ?? { ...EMPTY_LIMB };
        return {
          ...p,
          limbs: { ...p.limbs, [limb]: updateSlot(limbAlloc, slot, limbAlloc[slot] + delta) },
        };
      }),
    }));
  }, []);

  // Live allocation editing
  const updateLiveLimbSlot = useCallback((limb: string, slot: AllocSlot, value: number) => {
    setData((prev) => {
      const limbAlloc = prev.liveAllocations[limb] ?? { ...EMPTY_LIMB };
      return {
        ...prev,
        liveAllocations: { ...prev.liveAllocations, [limb]: updateSlot(limbAlloc, slot, value) },
      };
    });
  }, []);

  const setLiveLimbSlotDelta = useCallback((limb: string, slot: AllocSlot, delta: number) => {
    setData((prev) => {
      const limbAlloc = prev.liveAllocations[limb] ?? { ...EMPTY_LIMB };
      return {
        ...prev,
        liveAllocations: {
          ...prev.liveAllocations,
          [limb]: updateSlot(limbAlloc, slot, limbAlloc[slot] + delta),
        },
      };
    });
  }, []);

  const setProfileActive = useCallback((id: string, active: boolean) => {
    setData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => (p.id === id ? { ...p, isActive: active } : { ...p, isActive: false })),
    }));
  }, []);

  const handleAllocParse = useCallback((result: AllocParseResult) => {
    console.log('[alloc] parsed limbs:', result.limbs.map((l) => {
      const sum = Object.values(l.alloc).reduce((a, b) => a + b, 0);
      return `${l.limb} (sum=${sum}, null=${l.null})`;
    }));
    const newLimbNames = result.limbs.map((l) => l.limb);

    // Build a map of the parsed allocations
    const parsed: Record<string, LimbAllocation> = {};
    for (const l of result.limbs) {
      parsed[l.limb] = { ...l.alloc };
    }

    setData((prev) => {
      // When we get 2+ limbs (full "show all" response), use parsed order as canonical.
      // For single-limb updates, append to existing order if not already present.
      let mergedLimbs: string[];
      if (newLimbNames.length >= 2) {
        // Full alloc dump — use the MUD's canonical limb order
        mergedLimbs = newLimbNames;
      } else {
        // Single limb update — preserve existing order, append if new
        const existing = new Set(prev.detectedLimbs);
        mergedLimbs = [...prev.detectedLimbs];
        for (const name of newLimbNames) {
          if (!existing.has(name)) {
            mergedLimbs.push(name);
          }
        }
      }

      // Merge live allocations with parsed values
      const liveAllocations = { ...prev.liveAllocations };
      for (const [limb, alloc] of Object.entries(parsed)) {
        liveAllocations[limb] = alloc;
      }

      const updated: AllocData = { ...prev, detectedLimbs: mergedLimbs, liveAllocations };

      // Ensure all existing profiles have entries for any new limbs
      updated.profiles = prev.profiles.map((p) => {
        const limbs = { ...p.limbs };
        for (const name of mergedLimbs) {
          if (!limbs[name]) {
            limbs[name] = { ...EMPTY_LIMB };
          }
        }
        return { ...p, limbs };
      });

      return updated;
    });
  }, []);

  const applyLimb = useCallback((profileId: string, limb: string) => {
    const profile = dataRef.current.profiles.find((p) => p.id === profileId);
    if (!profile || !sendCommandRef.current) return;
    const alloc = profile.limbs[limb];
    if (!alloc) return;
    const cmd = buildAllocCommand(limb, alloc);
    console.log('[alloc] apply limb:', cmd);
    sendCommandRef.current(cmd).catch(console.error);
    // Update live state directly — we already know the values
    setData((prev) => ({
      ...prev,
      liveAllocations: { ...prev.liveAllocations, [limb]: { ...alloc } },
    }));
  }, [sendCommandRef]);

  const applyAll = useCallback((profileId: string) => {
    const profile = dataRef.current.profiles.find((p) => p.id === profileId);
    if (!profile || !sendCommandRef.current) return;
    const send = sendCommandRef.current;
    const limbOrder = dataRef.current.detectedLimbs.length > 0
      ? dataRef.current.detectedLimbs
      : Object.keys(profile.limbs);
    (async () => {
      for (const limb of limbOrder) {
        const alloc = profile.limbs[limb];
        if (!alloc) continue;
        const cmd = buildAllocCommand(limb, alloc);
        console.log('[alloc] apply all:', cmd);
        await send(cmd);
      }
      setProfileActive(profileId, true);
    })().catch(console.error);
    // Update live state directly from the profile
    setData((prev) => {
      const liveAllocations = { ...prev.liveAllocations };
      for (const limb of limbOrder) {
        const alloc = profile.limbs[limb];
        if (alloc) liveAllocations[limb] = { ...alloc };
      }
      return { ...prev, liveAllocations };
    });
  }, [sendCommandRef, setProfileActive]);

  const applyLiveLimb = useCallback((limb: string) => {
    if (!sendCommandRef.current) return;
    const alloc = dataRef.current.liveAllocations[limb];
    if (!alloc) return;
    const cmd = buildAllocCommand(limb, alloc);
    console.log('[alloc] apply live limb:', cmd);
    sendCommandRef.current(cmd).catch(console.error);
  }, [sendCommandRef]);

  const applyLiveAll = useCallback(() => {
    if (!sendCommandRef.current) return;
    const send = sendCommandRef.current;
    const live = dataRef.current.liveAllocations;
    const limbOrder = dataRef.current.detectedLimbs.length > 0
      ? dataRef.current.detectedLimbs
      : Object.keys(live);
    (async () => {
      for (const limb of limbOrder) {
        const alloc = live[limb];
        if (!alloc) continue;
        const cmd = buildAllocCommand(limb, alloc);
        console.log('[alloc] apply live all:', cmd);
        await send(cmd);
      }
    })().catch(console.error);
  }, [sendCommandRef]);

  /** Load a profile's allocations into the live view. */
  const loadProfileToLive = useCallback((profileId: string) => {
    setData((prev) => {
      const profile = prev.profiles.find((p) => p.id === profileId);
      if (!profile) return prev;
      const liveAllocations: Record<string, LimbAllocation> = {};
      for (const [limb, alloc] of Object.entries(profile.limbs)) {
        liveAllocations[limb] = { ...alloc };
      }
      return { ...prev, liveAllocations };
    });
    setView('live');
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Magic allocation callbacks                                         */
  /* ------------------------------------------------------------------ */

  const currentMagicProfile = magicData.profiles[magicData.currentProfileIndex] ?? null;

  const navigateMagicProfile = useCallback((direction: 'prev' | 'next') => {
    setMagicData((prev) => {
      if (prev.profiles.length === 0) return prev;
      const delta = direction === 'prev' ? -1 : 1;
      const next = (prev.currentProfileIndex + delta + prev.profiles.length) % prev.profiles.length;
      return { ...prev, currentProfileIndex: next };
    });
  }, []);

  const createMagicProfile = useCallback((name?: string) => {
    setMagicData((prev) => {
      const profile: MagicProfile = {
        id: genId(),
        name: name ?? `Magic ${prev.profiles.length + 1}`,
        alloc: { ...EMPTY_MAGIC },
        isActive: false,
      };
      const profiles = [...prev.profiles, profile];
      return { ...prev, profiles, currentProfileIndex: profiles.length - 1 };
    });
    setMagicView('profiles');
  }, []);

  const createMagicProfileFromLive = useCallback((name?: string) => {
    setMagicData((prev) => {
      const profile: MagicProfile = {
        id: genId(),
        name: name ?? `Magic ${prev.profiles.length + 1}`,
        alloc: { ...prev.liveAllocation },
        isActive: false,
      };
      const profiles = [...prev.profiles, profile];
      return { ...prev, profiles, currentProfileIndex: profiles.length - 1 };
    });
    setMagicView('profiles');
  }, []);

  /** Overwrite an existing magic profile with current live allocation. */
  const updateMagicProfileFromLive = useCallback((profileId: string) => {
    setMagicData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => {
        if (p.id !== profileId) return p;
        return { ...p, alloc: { ...prev.liveAllocation } };
      }),
    }));
  }, []);

  const deleteMagicProfile = useCallback((id: string) => {
    setMagicData((prev) => {
      const profiles = prev.profiles.filter((p) => p.id !== id);
      const idx = Math.min(prev.currentProfileIndex, Math.max(0, profiles.length - 1));
      return { ...prev, profiles, currentProfileIndex: idx };
    });
  }, []);

  const duplicateMagicProfile = useCallback((id: string) => {
    setMagicData((prev) => {
      const source = prev.profiles.find((p) => p.id === id);
      if (!source) return prev;
      const copy: MagicProfile = {
        ...source,
        id: genId(),
        name: `${source.name} (copy)`,
        isActive: false,
        alloc: { ...source.alloc },
      };
      const profiles = [...prev.profiles, copy];
      return { ...prev, profiles, currentProfileIndex: profiles.length - 1 };
    });
  }, []);

  const renameMagicProfile = useCallback((id: string, name: string) => {
    setMagicData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  }, []);

  const updateMagicProfileSlot = useCallback((profileId: string, slot: MagicSlot, value: number) => {
    setMagicData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => {
        if (p.id !== profileId) return p;
        return { ...p, alloc: updateMagicSlot(p.alloc, slot, value) };
      }),
    }));
  }, []);

  const setMagicProfileSlotDelta = useCallback((profileId: string, slot: MagicSlot, delta: number) => {
    setMagicData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => {
        if (p.id !== profileId) return p;
        return { ...p, alloc: updateMagicSlot(p.alloc, slot, p.alloc[slot] + delta) };
      }),
    }));
  }, []);

  const updateMagicLiveSlot = useCallback((slot: MagicSlot, value: number) => {
    setMagicData((prev) => ({
      ...prev,
      liveAllocation: updateMagicSlot(prev.liveAllocation, slot, value),
    }));
  }, []);

  const setMagicLiveSlotDelta = useCallback((slot: MagicSlot, delta: number) => {
    setMagicData((prev) => ({
      ...prev,
      liveAllocation: updateMagicSlot(prev.liveAllocation, slot, prev.liveAllocation[slot] + delta),
    }));
  }, []);

  const setMagicProfileActive = useCallback((id: string, active: boolean) => {
    setMagicData((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => (p.id === id ? { ...p, isActive: active } : { ...p, isActive: false })),
    }));
  }, []);

  const handleMagicParse = useCallback((result: MagicParseResult) => {
    console.log('[alloc] parsed magic:', result.alloc, 'arcane:', result.arcane);
    setMagicData((prev) => ({
      ...prev,
      liveAllocation: { ...result.alloc },
    }));
  }, []);

  const applyMagic = useCallback((profileId: string) => {
    const profile = magicDataRef.current.profiles.find((p) => p.id === profileId);
    if (!profile || !sendCommandRef.current) return;
    const cmd = buildMagicAllocCommand(profile.alloc);
    console.log('[alloc] apply magic:', cmd);
    sendCommandRef.current(cmd).catch(console.error);
    setMagicData((prev) => ({ ...prev, liveAllocation: { ...profile.alloc } }));
    setMagicProfileActive(profileId, true);
  }, [sendCommandRef, setMagicProfileActive]);

  const applyMagicLive = useCallback(() => {
    if (!sendCommandRef.current) return;
    const alloc = magicDataRef.current.liveAllocation;
    const cmd = buildMagicAllocCommand(alloc);
    console.log('[alloc] apply magic live:', cmd);
    sendCommandRef.current(cmd).catch(console.error);
  }, [sendCommandRef]);

  const loadMagicProfileToLive = useCallback((profileId: string) => {
    setMagicData((prev) => {
      const profile = prev.profiles.find((p) => p.id === profileId);
      if (!profile) return prev;
      return { ...prev, liveAllocation: { ...profile.alloc } };
    });
    setMagicView('live');
  }, []);

  return {
    // Combat
    data,
    view,
    setView,
    currentProfile,
    setCurrentProfileIndex,
    createProfile,
    createProfileFromLive,
    updateProfileFromLive,
    deleteProfile,
    duplicateProfile,
    renameProfile,
    updateLimbSlot,
    setLimbSlotDelta,
    updateLiveLimbSlot,
    setLiveLimbSlotDelta,
    setProfileActive,
    handleAllocParse,
    navigateProfile,
    applyLimb,
    applyAll,
    applyLiveLimb,
    applyLiveAll,
    loadProfileToLive,

    // Tab
    allocTab,
    setAllocTab,

    // Magic
    magicData,
    magicView,
    setMagicView,
    currentMagicProfile,
    navigateMagicProfile,
    createMagicProfile,
    createMagicProfileFromLive,
    updateMagicProfileFromLive,
    deleteMagicProfile,
    duplicateMagicProfile,
    renameMagicProfile,
    updateMagicProfileSlot,
    setMagicProfileSlotDelta,
    updateMagicLiveSlot,
    setMagicLiveSlotDelta,
    setMagicProfileActive,
    handleMagicParse,
    applyMagic,
    applyMagicLive,
    loadMagicProfileToLive,
  };
}
