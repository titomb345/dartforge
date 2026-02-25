import type { LimbAllocation, AllocSlot, MagicAllocation, MagicSlot } from '../types/alloc';
import {
  ALLOC_SLOTS,
  POINTS_PER_LIMB,
  SLOT_SHORT,
  MAGIC_SLOTS,
  MAGIC_POINTS,
  MAGIC_SLOT_SHORT,
} from '../types/alloc';

/** Regex for a limb name header line, e.g. "upper left hand:" or "tail:" */
const LIMB_HEADER_RE = /^(\w[\w\s]*?)\s*:\s*$/;

/** Regex for the allocation values line */
const VALUES_RE =
  /bonus:\s*(\d+)\s+daring:\s*(\d+)\s+speed:\s*(\d+)\s+aiming:\s*(\d+)\s+parry:\s*(\d+)\s+control:\s*(\d+)\s+null:\s*(\d+)/;

export interface ParsedLimb {
  limb: string;
  alloc: LimbAllocation;
  null: number;
}

export interface AllocParseResult {
  limbs: ParsedLimb[];
}

/**
 * State machine for multi-line allocation parsing.
 * Feed lines one at a time; returns parsed limbs when a non-matching line
 * arrives after accumulating at least one limb.
 *
 * Also supports a deferred flush: after the last values line, if no more
 * allocation data arrives within a short window, the accumulated data is
 * flushed via the onFlush callback.
 */
export class AllocLineParser {
  private pendingLimb: string | null = null;
  private accumulated: ParsedLimb[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private onFlush: ((result: AllocParseResult) => void) | null = null;

  /** True when the parser has seen at least one limb header or has accumulated limbs. */
  get isInBlock(): boolean {
    return this.pendingLimb !== null || this.accumulated.length > 0;
  }

  /** Register a callback for deferred (timer-based) flushes. */
  setFlushCallback(cb: (result: AllocParseResult) => void): void {
    this.onFlush = cb;
  }

  private cancelTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private startTimer(): void {
    this.cancelTimer();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const result = this.flush();
      if (result) {
        this.onFlush?.(result);
      }
    }, 600);
  }

  /** Feed a stripped line. Returns AllocParseResult when the block ends, else null. */
  feedLine(stripped: string): AllocParseResult | null {
    const headerMatch = LIMB_HEADER_RE.exec(stripped);
    if (headerMatch && !MAGIC_HEADER_RE.test(stripped)) {
      this.cancelTimer();
      this.pendingLimb = headerMatch[1].toLowerCase();
      return null;
    }

    if (this.pendingLimb) {
      // Tolerate empty lines between header and values (MUD may insert blank lines)
      if (stripped.trim() === '') return null;

      const valuesMatch = VALUES_RE.exec(stripped);
      if (valuesMatch) {
        this.accumulated.push({
          limb: this.pendingLimb,
          alloc: {
            bonus: parseInt(valuesMatch[1], 10),
            daring: parseInt(valuesMatch[2], 10),
            speed: parseInt(valuesMatch[3], 10),
            aiming: parseInt(valuesMatch[4], 10),
            parry: parseInt(valuesMatch[5], 10),
            control: parseInt(valuesMatch[6], 10),
          },
          null: parseInt(valuesMatch[7], 10),
        });
        this.pendingLimb = null;
        // Start a deferred flush — if no more limb headers arrive, flush after timeout
        this.startTimer();
        return null;
      }
      // Non-matching line after a header — probably end of block
      this.pendingLimb = null;
    }

    // Empty line inside allocation block — don't flush yet, restart timer
    if (stripped.trim() === '' && this.accumulated.length > 0) {
      this.startTimer();
      return null;
    }

    // Non-matching, non-empty line — flush immediately if we have data
    if (this.accumulated.length > 0) {
      this.cancelTimer();
      const result: AllocParseResult = { limbs: [...this.accumulated] };
      this.accumulated = [];
      return result;
    }

    return null;
  }

  /** Force-flush any accumulated limbs (e.g. on disconnect). */
  flush(): AllocParseResult | null {
    this.cancelTimer();
    if (this.accumulated.length > 0) {
      const result: AllocParseResult = { limbs: [...this.accumulated] };
      this.accumulated = [];
      this.pendingLimb = null;
      return result;
    }
    return null;
  }
}

/** Calculate null points for a limb allocation. */
export function calcNull(alloc: LimbAllocation): number {
  const sum = ALLOC_SLOTS.reduce((acc, slot) => acc + alloc[slot], 0);
  return Math.max(0, POINTS_PER_LIMB - sum);
}

/**
 * Build the MUD command to set a single limb's allocation.
 * Format: set combat allocation = <limb>,b,<val>,d,<val>,s,<val>,a,<val>,p,<val>,c,<val>,n,<null>
 *
 * Defensively ensures all 7 values sum to exactly POINTS_PER_LIMB.
 * If the 6 slots already exceed the limit, they're proportionally scaled down.
 */
export function buildAllocCommand(limb: string, alloc: LimbAllocation): string {
  // Work with a safe copy — ensure 6-slot sum doesn't exceed POINTS_PER_LIMB
  const safe = { ...alloc };
  const sum = ALLOC_SLOTS.reduce((acc, s) => acc + safe[s], 0);
  if (sum > POINTS_PER_LIMB) {
    // Proportionally scale down to fit
    const scale = POINTS_PER_LIMB / sum;
    let adjusted = 0;
    for (const s of ALLOC_SLOTS) {
      safe[s] = Math.floor(safe[s] * scale);
      adjusted += safe[s];
    }
    // Distribute rounding remainder to the largest slot
    const remainder = POINTS_PER_LIMB - adjusted;
    if (remainder > 0) {
      const largest = ALLOC_SLOTS.reduce((a, b) => (safe[a] >= safe[b] ? a : b));
      safe[largest] += remainder;
    }
  }
  const parts = ALLOC_SLOTS.map((slot) => `${SLOT_SHORT[slot]},${safe[slot]}`);
  return `set combat allocation = ${limb},${parts.join(',')},n,${POINTS_PER_LIMB}`;
}

/**
 * A parsed slot update — either absolute (p,140) or relative (p,+1 / c,-5).
 */
export interface SlotUpdate {
  slot: AllocSlot;
  value: number;
  relative: boolean;
}

export interface ParsedAllocCommand {
  limb: string;
  updates: SlotUpdate[];
}

/**
 * Parse an outgoing "set combat allocation = ..." command string.
 * Handles slots in any order, absolute values (p,140), and relative values (p,+1 / c,-5).
 * Handles both bare commands and "say <target> set combat allocation = ..." format.
 */
const SET_ALLOC_PREFIX_RE = /set combat allocation\s*=\s*(.+)/i;
const SHORT_TO_SLOT: Record<string, AllocSlot> = {
  b: 'bonus',
  d: 'daring',
  s: 'speed',
  a: 'aiming',
  p: 'parry',
  c: 'control',
};

export function parseAllocCommand(cmd: string): ParsedAllocCommand | null {
  const m = SET_ALLOC_PREFIX_RE.exec(cmd);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim());
  // First part(s) are the limb name — ends where the first slot abbreviation appears
  const limbParts: string[] = [];
  let i = 0;
  while (
    i < parts.length &&
    !SHORT_TO_SLOT[parts[i].toLowerCase()] &&
    parts[i].toLowerCase() !== 'n'
  ) {
    limbParts.push(parts[i]);
    i++;
  }
  if (limbParts.length === 0) return null;
  const limb = limbParts.join(' ').toLowerCase();
  const updates: SlotUpdate[] = [];
  // Parse slot,value pairs — value can be "140", "+1", "-5"
  while (i < parts.length - 1) {
    const key = parts[i].toLowerCase();
    const rawVal = parts[i + 1];
    const slot = SHORT_TO_SLOT[key];
    if (slot && rawVal) {
      const relative = rawVal.startsWith('+') || rawVal.startsWith('-');
      const value = parseInt(rawVal, 10);
      if (!isNaN(value)) {
        updates.push({ slot, value, relative });
      }
    }
    // skip 'n' (null) — we don't track it
    i += 2;
  }
  if (updates.length === 0) return null;
  return { limb, updates };
}

/**
 * Apply parsed slot updates to an existing allocation.
 * Absolute values replace, relative values add. Result is clamped to POINTS_PER_LIMB.
 */
export function applyAllocUpdates(base: LimbAllocation, updates: SlotUpdate[]): LimbAllocation {
  const result = { ...base };
  for (const u of updates) {
    result[u.slot] = u.relative ? result[u.slot] + u.value : u.value;
    result[u.slot] = Math.max(0, result[u.slot]);
  }
  // If total exceeds the cap and all updates were relative, the MUD rejects
  // the command — return the original base unchanged.
  const sum = ALLOC_SLOTS.reduce((acc, s) => acc + result[s], 0);
  if (sum > POINTS_PER_LIMB) {
    const allRelative = updates.every((u) => u.relative);
    if (allRelative) return { ...base };
    // Absolute sets: scale down proportionally to fit
    const scale = POINTS_PER_LIMB / sum;
    let adjusted = 0;
    for (const s of ALLOC_SLOTS) {
      result[s] = Math.floor(result[s] * scale);
      adjusted += result[s];
    }
    const remainder = POINTS_PER_LIMB - adjusted;
    if (remainder > 0) {
      const largest = ALLOC_SLOTS.reduce((a, b) => (result[a] >= result[b] ? a : b));
      result[largest] += remainder;
    }
  }
  return result;
}

/** Clamp a slot value to valid range (0 to POINTS_PER_LIMB). */
export function clampSlotValue(value: number): number {
  return Math.max(0, Math.min(POINTS_PER_LIMB, Math.round(value)));
}

/** Update a single slot in a limb allocation, clamping the total to POINTS_PER_LIMB. */
export function updateSlot(
  alloc: LimbAllocation,
  slot: AllocSlot,
  newValue: number
): LimbAllocation {
  const clamped = clampSlotValue(newValue);
  const updated = { ...alloc, [slot]: clamped };
  // If total exceeds POINTS_PER_LIMB, clamp this slot back
  const sum = ALLOC_SLOTS.reduce((acc, s) => acc + updated[s], 0);
  if (sum > POINTS_PER_LIMB) {
    updated[slot] = Math.max(0, clamped - (sum - POINTS_PER_LIMB));
  }
  return updated;
}

/* ------------------------------------------------------------------ */
/*  Magic allocation parsing & commands                                 */
/* ------------------------------------------------------------------ */

/** Regex for the magic affinity header line */
const MAGIC_HEADER_RE = /^elemental affinity:\s*$/i;

/** Regex for the magic values line */
const MAGIC_VALUES_RE =
  /air:\s*(\d+)\s+fire:\s*(\d+)\s+water:\s*(\d+)\s+earth:\s*(\d+)\s+arcane:\s*(\d+)/;

export interface MagicParseResult {
  alloc: MagicAllocation;
  arcane: number;
}

/**
 * Two-line magic allocation parser.
 * Feed lines one at a time. When the header is seen, the next matching line
 * produces a MagicParseResult.
 */
export class MagicLineParser {
  private awaitingValues = false;

  feedLine(stripped: string): MagicParseResult | null {
    if (MAGIC_HEADER_RE.test(stripped)) {
      this.awaitingValues = true;
      return null;
    }
    if (this.awaitingValues) {
      this.awaitingValues = false;
      const m = MAGIC_VALUES_RE.exec(stripped);
      if (m) {
        return {
          alloc: {
            air: parseInt(m[1], 10),
            fire: parseInt(m[2], 10),
            water: parseInt(m[3], 10),
            earth: parseInt(m[4], 10),
          },
          arcane: parseInt(m[5], 10),
        };
      }
    }
    return null;
  }
}

/** Calculate arcane points (auto = 100 - sum of 4 elements). */
export function calcArcane(alloc: MagicAllocation): number {
  const sum = MAGIC_SLOTS.reduce((acc, slot) => acc + alloc[slot], 0);
  return Math.max(0, MAGIC_POINTS - sum);
}

/**
 * Build the MUD command to set magic allocation.
 * Format: set magic allocation = a,<val>,f,<val>,w,<val>,e,<val>
 */
export function buildMagicAllocCommand(alloc: MagicAllocation): string {
  const safe = { ...alloc };
  const sum = MAGIC_SLOTS.reduce((acc, s) => acc + safe[s], 0);
  if (sum > MAGIC_POINTS) {
    const scale = MAGIC_POINTS / sum;
    let adjusted = 0;
    for (const s of MAGIC_SLOTS) {
      safe[s] = Math.floor(safe[s] * scale);
      adjusted += safe[s];
    }
    const remainder = MAGIC_POINTS - adjusted;
    if (remainder > 0) {
      const largest = MAGIC_SLOTS.reduce((a, b) => (safe[a] >= safe[b] ? a : b));
      safe[largest] += remainder;
    }
  }
  const parts = MAGIC_SLOTS.map((slot) => `${MAGIC_SLOT_SHORT[slot]},${safe[slot]}`);
  return `set magic allocation = ${parts.join(',')},n`;
}

/** A parsed magic slot update. */
export interface MagicSlotUpdate {
  slot: MagicSlot;
  value: number;
  relative: boolean;
}

export interface ParsedMagicAllocCommand {
  updates: MagicSlotUpdate[];
  reset: boolean;
}

const SET_MAGIC_PREFIX_RE = /set magic allocation\s*=\s*(.+)/i;
const SHORT_TO_MAGIC_SLOT: Record<string, MagicSlot> = {
  a: 'air',
  air: 'air',
  f: 'fire',
  fire: 'fire',
  w: 'water',
  water: 'water',
  e: 'earth',
  earth: 'earth',
};

/**
 * Parse an outgoing "set magic allocation = ..." command.
 * Supports: element abbreviations (a/f/w/e) or full names,
 * absolute values, relative (+/-), omitted amount (= shift all 100),
 * trailing ,n for reset-first.
 */
export function parseMagicAllocCommand(cmd: string): ParsedMagicAllocCommand | null {
  const m = SET_MAGIC_PREFIX_RE.exec(cmd);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim());

  // Check for trailing ,n (reset flag)
  const reset = parts.length > 0 && parts[parts.length - 1].toLowerCase() === 'n';
  if (reset) parts.pop();

  const updates: MagicSlotUpdate[] = [];
  let i = 0;
  while (i < parts.length) {
    const key = parts[i].toLowerCase();
    const slot = SHORT_TO_MAGIC_SLOT[key];
    if (slot) {
      // Check if next part is a numeric value
      if (i + 1 < parts.length && /^[+-]?\d+$/.test(parts[i + 1])) {
        const rawVal = parts[i + 1];
        const relative = rawVal.startsWith('+') || rawVal.startsWith('-');
        const value = parseInt(rawVal, 10);
        if (!isNaN(value)) {
          updates.push({ slot, value, relative });
        }
        i += 2;
      } else {
        // No amount — shift all 100 to this element
        updates.push({ slot, value: MAGIC_POINTS, relative: false });
        i++;
      }
    } else {
      i++;
    }
  }

  if (updates.length === 0) return null;
  return { updates, reset };
}

/**
 * Apply parsed magic slot updates to a base allocation.
 * If reset is true, start from all-zero (arcane). Then apply updates.
 */
export function applyMagicAllocUpdates(
  base: MagicAllocation,
  updates: MagicSlotUpdate[],
  reset: boolean
): MagicAllocation {
  const result = reset ? { air: 0, fire: 0, water: 0, earth: 0 } : { ...base };
  for (const u of updates) {
    result[u.slot] = u.relative ? result[u.slot] + u.value : u.value;
    result[u.slot] = Math.max(0, result[u.slot]);
  }
  // If total exceeds the cap and all updates were relative (no reset),
  // the MUD rejects the command — return the original base unchanged.
  const sum = MAGIC_SLOTS.reduce((acc, s) => acc + result[s], 0);
  if (sum > MAGIC_POINTS) {
    const allRelative = !reset && updates.every((u) => u.relative);
    if (allRelative) return { ...base };
    // Absolute sets or reset: scale down proportionally to fit
    const scale = MAGIC_POINTS / sum;
    let adjusted = 0;
    for (const s of MAGIC_SLOTS) {
      result[s] = Math.floor(result[s] * scale);
      adjusted += result[s];
    }
    const remainder = MAGIC_POINTS - adjusted;
    if (remainder > 0) {
      const largest = MAGIC_SLOTS.reduce((a, b) => (result[a] >= result[b] ? a : b));
      result[largest] += remainder;
    }
  }
  return result;
}

/** Clamp a magic slot value to valid range (0 to MAGIC_POINTS). */
export function clampMagicSlotValue(value: number): number {
  return Math.max(0, Math.min(MAGIC_POINTS, Math.round(value)));
}

/** Update a single slot in a magic allocation, clamping the total to MAGIC_POINTS. */
export function updateMagicSlot(
  alloc: MagicAllocation,
  slot: MagicSlot,
  newValue: number
): MagicAllocation {
  const clamped = clampMagicSlotValue(newValue);
  const updated = { ...alloc, [slot]: clamped };
  const sum = MAGIC_SLOTS.reduce((acc, s) => acc + updated[s], 0);
  if (sum > MAGIC_POINTS) {
    updated[slot] = Math.max(0, clamped - (sum - MAGIC_POINTS));
  }
  return updated;
}
