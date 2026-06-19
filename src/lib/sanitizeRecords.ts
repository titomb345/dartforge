/**
 * Defensive sanitizer for persisted "record maps" (`{ [id]: Record }`).
 *
 * Several stores (variables, triggers, aliases, who-title mappings) load their
 * data straight from disk and then sort/look it up by a required string field
 * (e.g. `name`, `pattern`, `whoTitle`). A single malformed entry — for example
 * a legacy/raw value where an object is expected — would make `.localeCompare`
 * or `.toLowerCase` throw on `undefined` and crash the entire UI.
 *
 * This drops any entry that isn't a plain object carrying the required string
 * key. Because the cleaned map is what gets written back on the next persist,
 * a bad entry is also self-healed out of the file.
 */
export function sanitizeRecordMap<T>(
  raw: unknown,
  requiredStringKey: keyof T & string
): Record<string, T> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const ok =
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>)[requiredStringKey] === 'string';

    if (ok) {
      out[key] = value as T;
    } else {
      console.warn(
        `[DartForge] Dropping malformed record "${key}" (missing string "${requiredStringKey}")`,
        value
      );
    }
  }
  return out;
}
