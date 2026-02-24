/** A player entry from the `who` output */
export interface WhoPlayer {
  /** Display name, e.g. "Braid the rowan" */
  name: string;
  /** Guild tag, e.g. "MG", "HG", or null */
  guild: string | null;
  /** Online or idle */
  state: 'online' | 'idle';
  /** Idle duration string, e.g. "28s", "5m", or null if online */
  idleTime: string | null;
}

/** A parsed snapshot of the full `who` output */
export interface WhoSnapshot {
  players: WhoPlayer[];
  /** "We extrapolate that there are N players on" */
  totalEstimated: number | null;
  /** "Only N returned their census forms" */
  censusReturned: number | null;
  /** "Estimated active characters: N this month" */
  activeThisMonth: number | null;
  /** "N today" */
  activeToday: number | null;
  /** "Ferdarchi was last renewed X ago" */
  renewedAgo: string | null;
  /** When this snapshot was captured */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Line matchers
// ---------------------------------------------------------------------------

const WHO_HEADER_RE = /^\s*Name\s+(?:Idle(?: Time)?|State)\s*$/;
const WHO_PLAYER_RE = /^\s*(?:\[(\w+)\]\s+)?(.+?)\s{2,}(Online|Idle(?:\s+\S+)*)\s*$/;

// Variation 1: "We extrapolate that there are N players/people on. Only N returned..."
// Also handles "...N players, but Only N..." alternative phrasing.
const WHO_EXTRAPOLATE_RE = /(\d+) (?:players?|people)(?:\s+on\.\s+|\s*,\s*but\s+)[Oo]nly (\d+)/;

// Variation 2: "...N players on. Strangely, that many are on who."
// All players returned census — censusReturned === totalEstimated.
const WHO_EXTRAPOLATE_ALL_RE = /(\d+) (?:players?|people)(?:\s+on\.\s+|\s*,\s*but\s+)Strangely/;

// Variation 3: "If a tree falls in the forest, and none of the roughly N..."
// No one returned census forms.
const WHO_EXTRAPOLATE_TREE_RE = /If a tree falls in the forest.*?roughly (\d+)/;

const WHO_ACTIVE_RE = /Estimated active characters:\s*(\d+)\s*this month,\s*(\d+)\s*today/;
const WHO_RENEWED_RE = /Ferdarchi was last renewed (.+?) ago/;
const WHO_WHERE_RE = /Most people seem to be in (?:the )?\w+ right now/;

/** Detect the who list header line */
export function isWhoHeaderLine(stripped: string): boolean {
  return WHO_HEADER_RE.test(stripped);
}

/** Parse a player row. Returns null if the line doesn't match. */
export function parseWhoPlayerLine(stripped: string): WhoPlayer | null {
  const m = WHO_PLAYER_RE.exec(stripped);
  if (!m) return null;
  const stateRaw = m[3].trim();
  const isIdle = stateRaw.startsWith('Idle');
  return {
    guild: m[1] ?? null,
    name: m[2].trim(),
    state: isIdle ? 'idle' : 'online',
    idleTime: isIdle ? stateRaw.replace(/^Idle\s*/, '') || null : null,
  };
}

/** Check if a line is part of the who footer block */
export function isWhoFooterLine(stripped: string): boolean {
  return (
    WHO_EXTRAPOLATE_RE.test(stripped) ||
    WHO_EXTRAPOLATE_ALL_RE.test(stripped) ||
    WHO_EXTRAPOLATE_TREE_RE.test(stripped) ||
    WHO_ACTIVE_RE.test(stripped) ||
    WHO_RENEWED_RE.test(stripped) ||
    WHO_WHERE_RE.test(stripped)
  );
}

/** Check if a line is the final footer line (Ferdarchi renewal) */
export function isWhoFinalLine(stripped: string): boolean {
  return WHO_RENEWED_RE.test(stripped);
}

/** Build a WhoSnapshot from accumulated lines between header and footer */
export function buildWhoSnapshot(lines: string[]): WhoSnapshot {
  const players: WhoPlayer[] = [];
  let totalEstimated: number | null = null;
  let censusReturned: number | null = null;
  let activeThisMonth: number | null = null;
  let activeToday: number | null = null;
  let renewedAgo: string | null = null;

  for (const line of lines) {
    const player = parseWhoPlayerLine(line);
    if (player) {
      players.push(player);
      continue;
    }

    // Variation 1: "N players on. Only N returned..."
    const extrapolateMatch = WHO_EXTRAPOLATE_RE.exec(line);
    if (extrapolateMatch) {
      totalEstimated = parseInt(extrapolateMatch[1], 10);
      censusReturned = parseInt(extrapolateMatch[2], 10);
      continue;
    }

    // Variation 2: "N players on. Strangely, that many are on who."
    const allMatch = WHO_EXTRAPOLATE_ALL_RE.exec(line);
    if (allMatch) {
      totalEstimated = parseInt(allMatch[1], 10);
      censusReturned = totalEstimated;
      continue;
    }

    // Variation 3: "If a tree falls in the forest... roughly N..."
    const treeMatch = WHO_EXTRAPOLATE_TREE_RE.exec(line);
    if (treeMatch) {
      totalEstimated = parseInt(treeMatch[1], 10);
      censusReturned = 0;
      continue;
    }

    const activeMatch = WHO_ACTIVE_RE.exec(line);
    if (activeMatch) {
      activeThisMonth = parseInt(activeMatch[1], 10);
      activeToday = parseInt(activeMatch[2], 10);
      continue;
    }

    const renewedMatch = WHO_RENEWED_RE.exec(line);
    if (renewedMatch) {
      renewedAgo = renewedMatch[1];
    }
  }

  return {
    players,
    totalEstimated,
    censusReturned,
    activeThisMonth,
    activeToday,
    renewedAgo,
    timestamp: Date.now(),
  };
}
