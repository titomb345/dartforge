import { useMemo } from 'react';

interface Groupable {
  pattern: string;
  body: string;
  group: string;
}

/** Capitalize first character: "starknight" → "Starknight" */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Shared filter/group logic for AliasPanel and TriggerPanel.
 * Computes unique groups, filtered list, and grouped entries.
 * Group names are case-insensitive ("Starknight" and "starknight" merge)
 * and displayed with a capitalized first character.
 */
export function useFilteredGroups<T extends Groupable>(
  items: T[],
  groupFilter: string | null,
  searchText: string
) {
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(capitalize(item.group || 'General'));
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (groupFilter)
      list = list.filter((item) => capitalize(item.group || 'General') === groupFilter);
    if (searchText) {
      const lower = searchText.toLowerCase();
      list = list.filter((item) => item.pattern.toLowerCase().includes(lower));
    }
    return list.sort((a, b) => a.pattern.localeCompare(b.pattern));
  }, [items, groupFilter, searchText]);

  const grouped = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of filtered) {
      const g = capitalize(item.group || 'General');
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return { groups, filtered, grouped };
}
