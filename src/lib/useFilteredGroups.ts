import { useMemo } from 'react';

interface Groupable {
  pattern: string;
  body: string;
  group: string;
}

/**
 * Shared filter/group logic for AliasPanel and TriggerPanel.
 * Computes unique groups, filtered list, and grouped entries.
 */
export function useFilteredGroups<T extends Groupable>(
  items: T[],
  groupFilter: string | null,
  searchText: string,
) {
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add((item.group || 'General').toLowerCase());
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (groupFilter) list = list.filter((item) => (item.group || 'General').toLowerCase() === groupFilter.toLowerCase());
    if (searchText) {
      const lower = searchText.toLowerCase();
      list = list.filter(
        (item) =>
          item.pattern.toLowerCase().includes(lower) ||
          item.body.toLowerCase().includes(lower) ||
          item.group.toLowerCase().includes(lower),
      );
    }
    return list.sort((a, b) => a.pattern.localeCompare(b.pattern));
  }, [items, groupFilter, searchText]);

  const grouped = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of filtered) {
      const g = (item.group || 'General').toLowerCase();
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return { groups, filtered, grouped };
}
