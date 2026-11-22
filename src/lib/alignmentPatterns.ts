import type { ThemeColorKey } from './defaultTheme';
import { cleanLine } from './lineUtils';

/** Parsed alignment state with conviction strength and display metadata */
export interface AlignmentLevel {
  /** Machine key (e.g. 'fanatic', 'belief', 'none') */
  key: string;
  /** Display label for the status bar (e.g. "Fanatic: War") */
  label: string;
  /** Conviction descriptor (e.g. "fanatic", "belief", "moderate") */
  conviction: string;
  /** The alignment value from the MUD (e.g. "war", "peace", "renewal") */
  alignment: string;
  /** ANSI theme color key — fallback if color is not set */
  themeColor: ThemeColorKey;
  /** 0 = strongest (fanatic), 8 = weakest (none) */
  severity: number;
  /** Direct CSS color for the status bar readout — scaled by conviction */
  color: string;
}

/** Result from matching an alignment line */
export interface AlignmentMatch {
  level: AlignmentLevel;
  raw: string;
}

/** Conviction metadata (without alignment value, which is dynamic) */
interface ConvictionDef {
  key: string;
  convictionLabel: string;
  severity: number;
  /** 0.0 (gray) – 1.0 (full color) intensity for this conviction level */
  intensity: number;
}

/**
 * Conviction levels ordered from strongest to weakest. The adverb levels
 * (firmly, strongly, barely) are ordered from real session logs, where a
 * character climbed barely -> some -> moderately -> believe -> strongly -> firmly.
 */
const CONVICTION_DEFS: ConvictionDef[] = [
  { key: 'fanatic', convictionLabel: 'Fanatic', severity: 0, intensity: 1.0 },
  { key: 'zealot', convictionLabel: 'Zealot', severity: 1, intensity: 0.9 },
  { key: 'firmly', convictionLabel: 'Firm Belief', severity: 2, intensity: 0.8 },
  { key: 'strongly', convictionLabel: 'Strong Belief', severity: 3, intensity: 0.7 },
  { key: 'belief', convictionLabel: 'Belief', severity: 4, intensity: 0.6 },
  { key: 'moderate', convictionLabel: 'Moderate', severity: 5, intensity: 0.45 },
  { key: 'some', convictionLabel: 'Some Belief', severity: 6, intensity: 0.3 },
  { key: 'barely', convictionLabel: 'Faint Belief', severity: 7, intensity: 0.15 },
  { key: 'none', convictionLabel: 'None', severity: 8, intensity: 0.0 },
];

/** Lookup map for named convictions */
const CONVICTION_LOOKUP = new Map<string, ConvictionDef>();
for (const def of CONVICTION_DEFS) {
  CONVICTION_LOOKUP.set(def.key, def);
}

/* ── Alignment type colors ──────────────────────────────────── */

/**
 * DartMUD's six alignment beliefs arranged in a circle.
 * Each gets a thematic base color at full intensity.
 *
 *              War (fiery red)
 *                  ....
 * Destruction ..         .. Passion (warm amber)
 *           .                .
 *           .       0        .
 *           .                .
 * Fatalism  ..              .. Renewal (green)
 *   (purple)    ....    ....
 *              Peace (blue)
 */
interface AlignmentTypeDef {
  baseColor: [number, number, number]; // RGB at full intensity
  themeColor: ThemeColorKey;
}

const ALIGNMENT_TYPES: Record<string, AlignmentTypeDef> = {
  war: { baseColor: [230, 50, 50], themeColor: 'brightRed' },
  passion: { baseColor: [240, 160, 40], themeColor: 'brightYellow' },
  renewal: { baseColor: [50, 200, 80], themeColor: 'brightGreen' },
  peace: { baseColor: [60, 140, 240], themeColor: 'brightBlue' },
  fatalism: { baseColor: [160, 90, 220], themeColor: 'magenta' },
  destruction: { baseColor: [180, 50, 90], themeColor: 'red' },
};

/** Neutral gray when alignment is unknown or "none" */
const GRAY: [number, number, number] = [128, 128, 128];

/** Lerp a single channel toward gray based on intensity (0 = gray, 1 = full color) */
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Convert RGB tuple to hex color string */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Split a mixed alignment into its two sides. A belief that sits between two
 * points on the circle reads "a philosophy somewhere between war and passion".
 */
function splitMixedAlignment(alignment: string): [string, string] | null {
  const m = alignment.match(/^(?:an? [\w-]+ )?somewhere between (.+?) and (.+)$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

/**
 * Look up the alignment type from the raw alignment text. For a mixed
 * alignment this is the first side named; otherwise the first recognized
 * keyword in the text.
 */
function resolveAlignmentType(alignment: string): AlignmentTypeDef | null {
  const lower = alignment.toLowerCase();
  if (ALIGNMENT_TYPES[lower]) return ALIGNMENT_TYPES[lower];
  const mixed = splitMixedAlignment(lower);
  if (mixed) {
    const def = ALIGNMENT_TYPES[mixed[0]] ?? ALIGNMENT_TYPES[mixed[1]];
    if (def) return def;
  }
  for (const [name, def] of Object.entries(ALIGNMENT_TYPES)) {
    if (lower.includes(name)) return def;
  }
  return null;
}

/** Full-intensity color for an alignment. A mixed one sits halfway between its two sides. */
function resolveBaseColor(alignment: string): [number, number, number] | null {
  const mixed = splitMixedAlignment(alignment.toLowerCase());
  if (mixed) {
    const a = ALIGNMENT_TYPES[mixed[0]];
    const b = ALIGNMENT_TYPES[mixed[1]];
    if (a && b) {
      return [
        lerp(a.baseColor[0], b.baseColor[0], 0.5),
        lerp(a.baseColor[1], b.baseColor[1], 0.5),
        lerp(a.baseColor[2], b.baseColor[2], 0.5),
      ];
    }
  }
  return resolveAlignmentType(alignment)?.baseColor ?? null;
}

/** Compute the display color for an alignment + conviction combination */
function computeColor(alignment: string, intensity: number): string {
  const base = resolveBaseColor(alignment);
  if (!base) return rgbToHex(...GRAY);
  const [br, bg, bb] = base;
  return rgbToHex(
    lerp(GRAY[0], br, intensity),
    lerp(GRAY[1], bg, intensity),
    lerp(GRAY[2], bb, intensity)
  );
}

/** Resolve the theme color for an alignment type */
function resolveThemeColor(alignment: string): ThemeColorKey {
  return resolveAlignmentType(alignment)?.themeColor ?? 'brightBlack';
}

/** Capitalize first letter of each word */
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Short display name: "a philosophy somewhere between war and passion" -> "War/Passion" */
function displayAlignment(alignment: string): string {
  const mixed = splitMixedAlignment(alignment);
  return mixed ? `${titleCase(mixed[0])}/${titleCase(mixed[1])}` : titleCase(alignment);
}

/** Build an AlignmentLevel from a conviction def and alignment value */
function buildLevel(def: ConvictionDef, alignment: string): AlignmentLevel {
  return {
    key: def.key,
    label: alignment
      ? `${def.convictionLabel}: ${displayAlignment(alignment)}`
      : def.convictionLabel,
    conviction: def.convictionLabel,
    alignment,
    themeColor: resolveThemeColor(alignment),
    severity: def.severity,
    color: computeColor(alignment, def.intensity),
  };
}

/**
 * Match a single ANSI-stripped line against known alignment messages.
 *
 * Handles (from DartMudlet triggers_alignment.lua):
 * - "You are a fanatic in <alignment>."
 * - "You are a zealot in <alignment>."
 * - "You (firmly|strongly|barely) believe in <alignment>."
 * - "You believe in <alignment>."
 * - "You believe moderately in <alignment>."
 * - "You have some belief in <alignment>."
 * - "You don't feel strongly about anything."
 *
 * <alignment> can be mixed ("a philosophy somewhere between war and passion"),
 * which the label shortens to "War/Passion".
 *
 * Specific patterns are tried before the catch-all verb pattern.
 */
export function matchAlignmentLine(line: string): AlignmentMatch | null {
  const cleaned = cleanLine(line);
  if (!cleaned) return null;

  // "You don't feel strongly about anything."
  if (cleaned === "You don't feel strongly about anything.") {
    const def = CONVICTION_LOOKUP.get('none')!;
    return { level: buildLevel(def, ''), raw: cleaned };
  }

  // "You are a (fanatic|zealot) in <alignment>."
  const zealotMatch = cleaned.match(/^You are a (zealot|fanatic) in (.+)\.$/);
  if (zealotMatch) {
    const conviction = zealotMatch[1].toLowerCase();
    const def = CONVICTION_LOOKUP.get(conviction);
    if (def) return { level: buildLevel(def, zealotMatch[2]), raw: cleaned };
  }

  // "You believe moderately in <alignment>." — must come before generic "believe"
  const moderateMatch = cleaned.match(/^You believe moderately in (.+)\.$/);
  if (moderateMatch) {
    const def = CONVICTION_LOOKUP.get('moderate')!;
    return { level: buildLevel(def, moderateMatch[1]), raw: cleaned };
  }

  // "You have some belief in <alignment>."
  const someMatch = cleaned.match(/^You have some belief in (.+)\.$/);
  if (someMatch) {
    const def = CONVICTION_LOOKUP.get('some')!;
    return { level: buildLevel(def, someMatch[1]), raw: cleaned };
  }

  // "You believe in <alignment>." — plain belief, no adverb
  const beliefMatch = cleaned.match(/^You believe in (.+)\.$/);
  if (beliefMatch) {
    const def = CONVICTION_LOOKUP.get('belief')!;
    return { level: buildLevel(def, beliefMatch[1]), raw: cleaned };
  }

  // "You <adverb> believe in <alignment>." — each adverb is its own level.
  // An adverb we haven't seen yet still shows its own word ("deeply" ->
  // "Deep Belief") at plain-belief strength rather than borrowing another label.
  const verbMatch = cleaned.match(/^You (\w+) believe in (.+)\.$/);
  if (verbMatch) {
    const adverb = verbMatch[1].toLowerCase();
    const def = CONVICTION_LOOKUP.get(adverb) ?? {
      ...CONVICTION_LOOKUP.get('belief')!,
      key: adverb,
      convictionLabel: `${titleCase(adverb.replace(/ly$/, ''))} Belief`,
    };
    return { level: buildLevel(def, verbMatch[2]), raw: cleaned };
  }

  return null;
}
