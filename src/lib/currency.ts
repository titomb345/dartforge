/**
 * DartMUD Currency Converter
 *
 * Four currency systems with a universal base unit:
 *   1 minim (mn) = 1 fals (fs) = 1 lepton (lp) = 1 mon (mo)
 */

export interface Denomination {
  name: string;
  plural: string;
  abbr: string;
  baseValue: number;
  metal: 'copper' | 'bronze' | 'silver' | 'gold';
}

export interface CurrencySystem {
  id: string;
  name: string;
  altName: string;
  denominations: Denomination[]; // sorted largest → smallest
}

// ---------------------------------------------------------------------------
// Currency definitions
// ---------------------------------------------------------------------------

export const FERDARCHIAN: CurrencySystem = {
  id: 'ferdarchian',
  name: 'Ferdarchian',
  altName: 'Eristan',
  denominations: [
    { name: 'gold sun',        plural: 'gold suns',          abbr: 'Su', baseValue: 1500, metal: 'gold' },
    { name: 'silver groat',    plural: 'silver groats',      abbr: 'g',  baseValue: 500,  metal: 'silver' },
    { name: 'silver penny',    plural: 'silver pennies',     abbr: 'p',  baseValue: 100,  metal: 'silver' },
    { name: 'silver farthing', plural: 'silver farthings',   abbr: 'f',  baseValue: 25,   metal: 'silver' },
    { name: 'copper bit',      plural: 'copper bits',        abbr: 'b',  baseValue: 5,    metal: 'copper' },
    { name: 'copper minim',    plural: 'copper minims',      abbr: 'mn', baseValue: 1,    metal: 'copper' },
  ],
};

export const TIRACHIAN: CurrencySystem = {
  id: 'tirachian',
  name: 'Tirachian',
  altName: 'Soriktos',
  denominations: [
    { name: 'gold rial',     plural: 'gold rials',     abbr: 'Ri', baseValue: 5000, metal: 'gold' },
    { name: 'gold dinar',    plural: 'gold dinars',    abbr: 'dn', baseValue: 1000, metal: 'gold' },
    { name: 'silver dirham', plural: 'silver dirhams', abbr: 'dh', baseValue: 100,  metal: 'silver' },
    { name: 'silver qirat',  plural: 'silver qirats',  abbr: 'qt', baseValue: 10,   metal: 'silver' },
    { name: 'copper fals',   plural: 'copper fulus',   abbr: 'fs', baseValue: 1,    metal: 'copper' },
  ],
};

export const EASTERLING: CurrencySystem = {
  id: 'easterling',
  name: 'Easterling',
  altName: 'Easthaven',
  denominations: [
    { name: 'gold stater',    plural: 'gold staters',    abbr: 'st', baseValue: 1800, metal: 'gold' },
    { name: 'silver drachm',  plural: 'silver drachms',  abbr: 'dr', baseValue: 600,  metal: 'silver' },
    { name: 'silver obol',    plural: 'silver obols',    abbr: 'ob', baseValue: 100,  metal: 'silver' },
    { name: 'bronze chalkos', plural: 'bronze chalkoi',  abbr: 'ch', baseValue: 10,   metal: 'bronze' },
    { name: 'bronze lepton',  plural: 'bronze lepta',    abbr: 'lp', baseValue: 1,    metal: 'bronze' },
  ],
};

export const ADACHIAN: CurrencySystem = {
  id: 'adachian',
  name: 'Adachian',
  altName: 'Adachian',
  denominations: [
    { name: 'gold ryo',    plural: 'gold ryo',    abbr: 'Ry', baseValue: 4000, metal: 'gold' },
    { name: 'gold bu',     plural: 'gold bu',     abbr: 'bu', baseValue: 1000, metal: 'gold' },
    { name: 'silver shu',  plural: 'silver shu',  abbr: 'sh', baseValue: 250,  metal: 'silver' },
    { name: 'bronze mon',  plural: 'bronze mon',  abbr: 'mo', baseValue: 1,    metal: 'bronze' },
  ],
};

export const ALL_SYSTEMS: CurrencySystem[] = [FERDARCHIAN, TIRACHIAN, EASTERLING, ADACHIAN];

// ---------------------------------------------------------------------------
// Lookup maps (built once)
// ---------------------------------------------------------------------------

/** Map from abbreviation (case-insensitive) to { system, denomination } */
const ABBR_MAP = new Map<string, { system: CurrencySystem; denom: Denomination }>();

/** Map from denomination name/plural (lowercased) to { system, denomination } */
const NAME_MAP = new Map<string, { system: CurrencySystem; denom: Denomination }>();

for (const sys of ALL_SYSTEMS) {
  for (const d of sys.denominations) {
    ABBR_MAP.set(d.abbr.toLowerCase(), { system: sys, denom: d });
    NAME_MAP.set(d.name.toLowerCase(), { system: sys, denom: d });
    NAME_MAP.set(d.plural.toLowerCase(), { system: sys, denom: d });
    // Also index the short coin name (e.g. "minim", "groat", "rial")
    const shortName = d.name.split(' ').slice(1).join(' ');
    if (shortName) {
      NAME_MAP.set(shortName.toLowerCase(), { system: sys, denom: d });
    }
    const shortPlural = d.plural.split(' ').slice(1).join(' ');
    if (shortPlural && shortPlural !== shortName) {
      NAME_MAP.set(shortPlural.toLowerCase(), { system: sys, denom: d });
    }
  }
}

// Also index system names for "to <system>" parsing
const SYSTEM_NAME_MAP = new Map<string, CurrencySystem>();
for (const sys of ALL_SYSTEMS) {
  SYSTEM_NAME_MAP.set(sys.id.toLowerCase(), sys);
  SYSTEM_NAME_MAP.set(sys.name.toLowerCase(), sys);
  SYSTEM_NAME_MAP.set(sys.altName.toLowerCase(), sys);
}

// ---------------------------------------------------------------------------
// Core conversion functions
// ---------------------------------------------------------------------------

export interface CoinBreakdown {
  system: CurrencySystem;
  coins: { denom: Denomination; count: number }[];
  totalBase: number;
}

/**
 * Resolve a denomination string (abbreviation or name) to its definition.
 */
export function findDenomination(input: string): { system: CurrencySystem; denom: Denomination } | null {
  const lower = input.toLowerCase().trim();
  return ABBR_MAP.get(lower) ?? NAME_MAP.get(lower) ?? null;
}

/**
 * Resolve a system name string to a CurrencySystem.
 */
export function findSystem(input: string): CurrencySystem | null {
  return SYSTEM_NAME_MAP.get(input.toLowerCase().trim()) ?? null;
}

/**
 * Convert an amount of a denomination to base units.
 */
export function toBase(amount: number, denom: Denomination): number {
  return amount * denom.baseValue;
}

/**
 * Break a base-unit amount into the largest-first coin breakdown for a system.
 */
export function fromBase(baseAmount: number, system: CurrencySystem): CoinBreakdown {
  let remaining = Math.floor(baseAmount);
  const coins: CoinBreakdown['coins'] = [];

  for (const denom of system.denominations) {
    const count = Math.floor(remaining / denom.baseValue);
    if (count > 0) {
      coins.push({ denom, count });
      remaining -= count * denom.baseValue;
    }
  }

  return { system, coins, totalBase: Math.floor(baseAmount) };
}

/**
 * Full conversion: amount + denomination → breakdown in source system + all other systems.
 * If targetSystem is provided, only converts to that system.
 */
export function convert(
  amount: number,
  denom: Denomination,
  sourceSystem: CurrencySystem,
  targetSystem?: CurrencySystem,
): { source: CoinBreakdown; targets: CoinBreakdown[] } {
  const base = toBase(amount, denom);
  const source = fromBase(base, sourceSystem);

  const targetSystems = targetSystem
    ? [targetSystem]
    : ALL_SYSTEMS.filter((s) => s.id !== sourceSystem.id);

  const targets = targetSystems.map((sys) => fromBase(base, sys));

  return { source, targets };
}

// ---------------------------------------------------------------------------
// Parsing — freeform multi-denomination
// ---------------------------------------------------------------------------

export interface CoinEntry {
  amount: number;
  denom: Denomination;
  system: CurrencySystem;
}

export interface ParsedConvertCommand {
  coins: CoinEntry[];
  totalBase: number;
  targetSystem?: CurrencySystem;
}

/**
 * Parse a freeform coin string into individual coin entries.
 * Accepts formats like:
 *   "3Ri"  "3 Ri"  "3ri 5dn"  "1su,2g"  "1ri1dn50fs"  "3 gold suns"
 *
 * Returns the parsed entries or an error string.
 */
export function parseCoins(input: string): CoinEntry[] | string {
  const entries: CoinEntry[] = [];

  // Strategy: use a regex to find all <number><denomination> pairs.
  // The denomination can be 1-2 letter abbreviations or longer words.
  // We try longest abbreviation matches first by sorting all known abbrs.
  const allAbbrs = [...ABBR_MAP.keys()].sort((a, b) => b.length - a.length);
  const abbrPattern = allAbbrs.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // Match: <number> <optional whitespace> <abbreviation>
  const regex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${abbrPattern})(?=[\\s,;+&]|\\d|$)`, 'gi');
  let match;
  while ((match = regex.exec(input)) !== null) {
    const amount = parseFloat(match[1]);
    if (amount <= 0 || !isFinite(amount)) continue;
    const found = findDenomination(match[2]);
    if (found) {
      entries.push({ amount, denom: found.denom, system: found.system });
    }
  }

  if (entries.length === 0) {
    return `No coins found. Use format like: 3Ri 5dn, or 1su2g50mn`;
  }

  return entries;
}

/**
 * Parse a #convert command string.
 * Formats:
 *   #convert <coins>
 *   #convert <coins> to <system>
 *
 * Where <coins> is freeform: "3Ri", "1su 2g", "1ri1dn50fs", etc.
 */
export function parseConvertCommand(input: string): ParsedConvertCommand | string {
  const trimmed = input.replace(/^#convert\s+/i, '').trim();
  if (!trimmed) return 'Usage: #convert <coins> [to <system>]  e.g. #convert 3Ri 5dn to ferdarchian';

  // Split on "to" for optional target
  const toMatch = trimmed.match(/^(.+?)\s+to\s+(.+)$/i);
  const coinPart = toMatch ? toMatch[1].trim() : trimmed;
  const targetPart = toMatch ? toMatch[2].trim() : undefined;

  const parsed = parseCoins(coinPart);
  if (typeof parsed === 'string') return parsed;

  const totalBase = parsed.reduce((sum, e) => sum + toBase(e.amount, e.denom), 0);

  let targetSystem: CurrencySystem | undefined;
  if (targetPart) {
    const found = findSystem(targetPart);
    if (!found) return `Unknown currency system "${targetPart}". Try: ferdarchian, tirachian, easterling, adachian.`;
    targetSystem = found;
  }

  return { coins: parsed, totalBase, targetSystem };
}

/**
 * Convert a total base amount to breakdowns in all (or a target) system.
 */
export function convertFromBase(
  totalBase: number,
  targetSystem?: CurrencySystem,
): CoinBreakdown[] {
  const systems = targetSystem ? [targetSystem] : ALL_SYSTEMS;
  return systems.map((sys) => fromBase(totalBase, sys));
}

// ---------------------------------------------------------------------------
// ANSI-colored terminal formatting
// ---------------------------------------------------------------------------

const METAL_ANSI: Record<Denomination['metal'], string> = {
  copper: '\x1b[33m',   // yellow (copper tone)
  bronze: '\x1b[33m',   // yellow (bronze tone)
  silver: '\x1b[37m',   // white (silver tone)
  gold: '\x1b[93m',     // bright yellow (gold tone)
};
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';

function formatCoinList(breakdown: CoinBreakdown): string {
  if (breakdown.coins.length === 0) return `${DIM}0${RESET}`;
  return breakdown.coins
    .map(({ denom, count }) => {
      const color = METAL_ANSI[denom.metal];
      return `${color}${count} ${count === 1 ? denom.name : denom.plural}${RESET} ${DIM}(${denom.abbr})${RESET}`;
    })
    .join(`${DIM}, ${RESET}`);
}

/**
 * Format a multi-coin conversion result as ANSI-colored terminal output.
 */
export function formatMultiConversion(
  parsed: ParsedConvertCommand,
): string {
  const lines: string[] = [];

  // Input summary
  const inputParts = parsed.coins.map((e) => {
    const color = METAL_ANSI[e.denom.metal];
    return `${color}${e.amount} ${e.amount === 1 ? e.denom.name : e.denom.plural}${RESET} ${DIM}(${e.denom.abbr})${RESET}`;
  });
  lines.push(`${BOLD}${inputParts.join(`${DIM} + ${RESET}`)}${RESET}`);

  lines.push(`${DIM}${'─'.repeat(40)}${RESET}`);
  lines.push(`${DIM}Base value: ${parsed.totalBase.toLocaleString()} units${RESET}`);

  const breakdowns = convertFromBase(parsed.totalBase, parsed.targetSystem);
  for (const bd of breakdowns) {
    lines.push(`${DIM}${bd.system.name}:${RESET} ${formatCoinList(bd)}`);
  }

  return lines.join('\r\n');
}
