/**
 * DartMUD Date Module — TypeScript port of dartmudlet/Scripts/date.lua
 *
 * Three calendar systems:
 *   Common (Elvish)  — 12 months × 15 days, 6-day week
 *   Thorpian (Rowan) — 8 months × 24 days, 8-day week
 *   Adachian         — 12 months × 15 days, 6-day week (offset)
 *
 * All calculations use Unix epoch seconds (same as os.time() in Lua).
 */

// ── Reckoning enum ──────────────────────────────────────────────

export enum Reckoning {
  Common = 0,
  Thorpian = 1,
  Adachian = 2,
}

// ── Time constants (in real-world seconds) ──────────────────────

const COMMON_HOUR = 600; // 10 real minutes
const COMMON_DAY = 14400; // 4 real hours  (24 common hours)

const ELVISH_MONTH = 216000; // 15 common days (2.5 real days)
const ELVISH_YEAR = 2592000; // 12 months     (30 real days)
const ROWAN_MONTH = 345600; // 24 common days (4 real days)
const ROWAN_YEAR = 2764800; // 8 months      (32 real days)

// ── Per-reckoning lookup tables ─────────────────────────────────

const MONTH_LENGTH: Record<Reckoning, number> = {
  [Reckoning.Common]: ELVISH_MONTH,
  [Reckoning.Thorpian]: ROWAN_MONTH,
  [Reckoning.Adachian]: ELVISH_MONTH,
};

const YEAR_LENGTH: Record<Reckoning, number> = {
  [Reckoning.Common]: ELVISH_YEAR,
  [Reckoning.Thorpian]: ROWAN_YEAR,
  [Reckoning.Adachian]: ELVISH_YEAR,
};

const DATE_OFFSET: Record<Reckoning, number> = {
  [Reckoning.Common]: 0,
  [Reckoning.Thorpian]: 0,
  [Reckoning.Adachian]: -864000, // −3 common years
};

const YEAR_OFFSET: Record<Reckoning, number> = {
  [Reckoning.Common]: 0,
  [Reckoning.Thorpian]: 1100,
  [Reckoning.Adachian]: 1832,
};

// ── Month names ─────────────────────────────────────────────────

const COMMON_MONTHS = [
  'Frostflower',
  'Icemoon',
  'Wolfmoon',
  'Wintersebb',
  'Saprise',
  'Petalspread',
  'Greentide',
  'Midsummer',
  'Berrymoon',
  'Cornripe',
  'Harvestmoon',
  'Winnowing',
];

const COMMON_MONTHS_ABBREV = [
  'Ffl',
  'Ice',
  'Wlf',
  'Web',
  'Sap',
  'Ptl',
  'Grt',
  'Mid',
  'Bry',
  'Crn',
  'Hvt',
  'Win',
];

const THORPIAN_MONTHS = [
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Indigo',
  'Violet',
  'Octarine',
];

const THORPIAN_MONTHS_ABBREV = ['Red', 'Org', 'Ylw', 'Grn', 'Blu', 'Ind', 'Vio', 'Oct'];

const ADACHIAN_MONTHS = [
  'Yayoi',
  'Uzuki',
  'Satsuki',
  'Minazuki',
  'Fumizuki',
  'Hazuki',
  'Nagatsuki',
  'Kannazuki',
  'Shimotsuki',
  'Shiwasu',
  'Mutsuki',
  'Kisaragi',
];

const ADACHIAN_MONTHS_ABBREV = [
  'Yay',
  'Uzu',
  'Saz',
  'Min',
  'Fum',
  'Haz',
  'Nag',
  'Kan',
  'Shm',
  'Shw',
  'Muz',
  'Kis',
];

const MONTH_NAMES: Record<Reckoning, string[]> = {
  [Reckoning.Common]: COMMON_MONTHS,
  [Reckoning.Thorpian]: THORPIAN_MONTHS,
  [Reckoning.Adachian]: ADACHIAN_MONTHS,
};

const MONTH_NAMES_ABBREV: Record<Reckoning, string[]> = {
  [Reckoning.Common]: COMMON_MONTHS_ABBREV,
  [Reckoning.Thorpian]: THORPIAN_MONTHS_ABBREV,
  [Reckoning.Adachian]: ADACHIAN_MONTHS_ABBREV,
};

// ── Weekday names ───────────────────────────────────────────────

const COMMON_WEEKDAYS = ['Martin', 'Mahasa', "Tannorat'h", 'Anastasia', 'Sulamar', 'Dannika'];

const THORPIAN_WEEKDAYS = ['Flic', 'Ic', 'Mla', 'Orl', 'Dri', 'Sic', 'Lor', 'Cim'];

const ADACHIAN_WEEKDAYS = ['Homura', 'Mizu', 'Moku', 'Kane', 'Seki', 'Kuu'];

const WEEKDAYS: Record<Reckoning, string[]> = {
  [Reckoning.Common]: COMMON_WEEKDAYS,
  [Reckoning.Thorpian]: THORPIAN_WEEKDAYS,
  [Reckoning.Adachian]: ADACHIAN_WEEKDAYS,
};

// ── Holidays ────────────────────────────────────────────────────

const COMMON_HOLIDAYS: Record<string, string> = {
  '1 frostflower': "New Year's Day",
  '8 icemoon': 'Festival of Lights',
  '1 wintersebb': 'Festival of Quickening',
  '14 wintersebb': 'Sun Day',
  '8 saprise': 'Spring Equinox',
  '1 greentide': 'Festival of Flowers',
  '8 midsummer': 'Summer Solstice',
  '1 cornripe': 'Harvest Festival',
  '4 cornripe': 'The Hand of Sulamar',
  '8 harvestmoon': 'Festival of Trees',
};

const THORPIAN_HOLIDAYS: Record<string, string> = {
  '1 red': "New Year's Day",
  '7 orange': 'The Hand of Sulamar',
  '11 indigo': 'Sun Day',
};

const ADACHIAN_HOLIDAYS: Record<string, string> = {
  '1 yayoi': "Ganjitsu (New Year's Day)",
  '7 hazuki': 'Obon',
  '4 shimotsuki': "Emperor's Birthday",
};

const HOLIDAYS: Record<Reckoning, Record<string, string>> = {
  [Reckoning.Common]: COMMON_HOLIDAYS,
  [Reckoning.Thorpian]: THORPIAN_HOLIDAYS,
  [Reckoning.Adachian]: ADACHIAN_HOLIDAYS,
};

// ── Thorpian month accent colors ────────────────────────────────

export const THORPIAN_MONTH_COLORS: string[] = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#d946ef', // Octarine
];

// ── Query functions ─────────────────────────────────────────────

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Day of the month (1-based). */
export function queryDate(secs: number | null, reckoning: Reckoning): number {
  const s = (secs ?? nowSecs()) + DATE_OFFSET[reckoning];
  return Math.floor((s % MONTH_LENGTH[reckoning]) / COMMON_DAY) + 1;
}

/** Month number (1-based). */
export function queryMonth(secs: number | null, reckoning: Reckoning): number {
  const s = (secs ?? nowSecs()) + DATE_OFFSET[reckoning];
  return Math.floor((s % YEAR_LENGTH[reckoning]) / MONTH_LENGTH[reckoning]) + 1;
}

/** Year number. */
export function queryYear(secs: number | null, reckoning: Reckoning): number {
  const s = (secs ?? nowSecs()) + DATE_OFFSET[reckoning];
  return Math.floor(s / YEAR_LENGTH[reckoning]) + YEAR_OFFSET[reckoning];
}

/** Month name (full or abbreviated). Pass negative number to look up by month index. */
export function queryMonthName(
  secsOrIdx: number | null,
  reckoning: Reckoning,
  abbrev = false
): string {
  let monthIdx: number;
  if (secsOrIdx !== null && secsOrIdx < 0) {
    monthIdx = -secsOrIdx;
  } else {
    monthIdx = queryMonth(secsOrIdx, reckoning);
  }

  const names = abbrev ? MONTH_NAMES_ABBREV[reckoning] : MONTH_NAMES[reckoning];
  const idx = monthIdx - 1;
  if (idx < 0 || idx >= names.length) return '';
  return names[idx];
}

/** Day of the week (1-based). */
export function queryDayOfWeek(secs: number | null, reckoning: Reckoning): number {
  const s = (secs ?? nowSecs()) + DATE_OFFSET[reckoning];
  return Math.floor((s / COMMON_DAY) % WEEKDAYS[reckoning].length) + 1;
}

/** Weekday name. Pass negative number to look up by day index. */
export function queryDayName(secsOrIdx: number | null, reckoning: Reckoning): string {
  let dayIdx: number;
  if (secsOrIdx !== null && secsOrIdx < 0) {
    dayIdx = -secsOrIdx;
  } else {
    dayIdx = queryDayOfWeek(secsOrIdx, reckoning);
  }

  const names = WEEKDAYS[reckoning];
  const idx = dayIdx - 1;
  if (idx < 0 || idx >= names.length) return '';
  return names[idx];
}

/** Current common hour (0–23). */
export function queryHour(secs?: number | null): number {
  const s = secs ?? nowSecs();
  return Math.floor((s % COMMON_DAY) / COMMON_HOUR);
}

// ── Holiday lookup ──────────────────────────────────────────────

/** Returns the holiday name for the given date, or null. */
export function getHoliday(secs: number | null, reckoning: Reckoning): string | null {
  const s = secs ?? nowSecs();
  const day = queryDate(s, reckoning);
  const monthName = queryMonthName(s, reckoning).toLowerCase();
  const key = `${day} ${monthName}`;
  return HOLIDAYS[reckoning][key] ?? null;
}

/** Returns all active holidays across all reckonings. */
export function getAllHolidays(secs?: number | null): { reckoning: Reckoning; name: string }[] {
  const s = secs ?? nowSecs();
  const results: { reckoning: Reckoning; name: string }[] = [];
  for (const r of [Reckoning.Common, Reckoning.Thorpian, Reckoning.Adachian]) {
    const h = getHoliday(s, r);
    if (h) results.push({ reckoning: r, name: h });
  }
  return results;
}

// ── Formatting ──────────────────────────────────────────────────

/** Full formatted date: "Dayname, Month Day, Year" */
export function formatDate(secs: number | null, reckoning: Reckoning): string {
  const s = secs ?? nowSecs();
  const dayName = queryDayName(s, reckoning);
  const monthName = queryMonthName(s, reckoning);
  const day = queryDate(s, reckoning);
  const year = queryYear(s, reckoning);
  return `${dayName}, ${monthName} ${day}, ${year}`;
}

/** Human-readable reckoning name. */
export function getReckoningLabel(reckoning: Reckoning): string {
  switch (reckoning) {
    case Reckoning.Common:
      return 'Common';
    case Reckoning.Thorpian:
      return 'Thorpian';
    case Reckoning.Adachian:
      return 'Adachian';
  }
}

/** Descriptive time-of-day period based on common hour. */
export function getTimeOfDay(hour: number): string {
  if (hour >= 4 && hour < 6) return 'Dawn';
  if (hour >= 6 && hour < 10) return 'Morning';
  if (hour >= 10 && hour < 14) return 'Midday';
  if (hour >= 14 && hour < 18) return 'Afternoon';
  if (hour >= 18 && hour < 20) return 'Dusk';
  if (hour >= 20 && hour < 23) return 'Evening';
  return 'Night'; // 23, 0–3
}

/** Get the accent color for the current reckoning state. */
export function getReckoningAccent(reckoning: Reckoning, secs?: number | null): string {
  if (reckoning === Reckoning.Common) return '#f59e0b';
  if (reckoning === Reckoning.Adachian) return '#f472b6';
  // Thorpian: use the current month's color
  const monthIdx = queryMonth(secs ?? null, Reckoning.Thorpian) - 1;
  return THORPIAN_MONTH_COLORS[monthIdx] ?? '#8be9fd';
}

// ── Reverse conversion (in-game date → real-world date) ─────────

/** Real-world month abbreviations for date formatting. */
const REAL_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Pre-built lookup: lowercase month abbreviation → { reckoning, monthIdx } */
const ABBREV_LOOKUP: Map<string, { reckoning: Reckoning; monthIdx: number }> = new Map();
for (const r of [Reckoning.Common, Reckoning.Thorpian, Reckoning.Adachian]) {
  const abbrevs = MONTH_NAMES_ABBREV[r];
  for (let i = 0; i < abbrevs.length; i++) {
    ABBREV_LOOKUP.set(abbrevs[i].toLowerCase(), { reckoning: r, monthIdx: i });
  }
}

/**
 * Convert an in-game date string to a real-world date string.
 *
 * Input format: "Sap  1, 605" or "Red 12, 1150" (abbreviation + day + year)
 * Output format: "Sep 20, 2019" (Mon DD, YYYY)
 *
 * Returns null if the date string can't be parsed or the month abbreviation
 * is unrecognized.
 */
export function convertDartmudDate(dateString: string): string | null {
  // Split "Sap  1, 605" → ["Sap  1", "605"]
  const commaIdx = dateString.indexOf(',');
  if (commaIdx < 0) return null;

  const datePart = dateString.substring(0, commaIdx).trim();
  const yearStr = dateString.substring(commaIdx + 1).trim();
  const year = parseInt(yearStr, 10);
  if (isNaN(year)) return null;

  // Split "Sap  1" → abbreviation + day (collapse multiple spaces)
  const parts = datePart.split(/\s+/);
  if (parts.length < 2) return null;
  const abbrev = parts[0].toLowerCase();
  const dayOfMonth = parseInt(parts[1], 10);
  if (isNaN(dayOfMonth)) return null;

  // Look up reckoning and month index from abbreviation
  const lookup = ABBREV_LOOKUP.get(abbrev);
  if (!lookup) return null;
  const { reckoning, monthIdx } = lookup;

  // Calculate Unix timestamp (seconds)
  const yearTimestamp =
    DATE_OFFSET[reckoning] + (year - YEAR_OFFSET[reckoning]) * YEAR_LENGTH[reckoning];
  const monthTimestamp = yearTimestamp + monthIdx * MONTH_LENGTH[reckoning];
  const timestamp = monthTimestamp + (dayOfMonth - 1) * COMMON_DAY;

  // Convert to real-world date using local timezone
  const d = new Date(timestamp * 1000);
  const mo = REAL_MONTHS[d.getMonth()];
  const da = String(d.getDate()).padStart(2, '0');
  return `${mo} ${da}, ${d.getFullYear()}`;
}
