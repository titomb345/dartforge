/** Normalize a spell/skill name for fuzzy comparison: lowercase, strip punctuation, underscores → spaces. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/_/g, ' ').trim();
}

/** Find the first key in `data` whose normalized form matches the normalized `input`. */
export function fuzzyMatchKey<V>(input: string, data: Record<string, V>): string | null {
  const norm = normalizeName(input);
  for (const key of Object.keys(data)) {
    if (normalizeName(key) === norm) return key;
  }
  return null;
}
