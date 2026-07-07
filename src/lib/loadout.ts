/**
 * Loadout tracker — live model of what each limb holds and what is worn,
 * built entirely from output the game already prints (no polling).
 *
 * Sources, in decreasing authority:
 *  - `x me` examine block: full snapshot — limb roster, per-limb health,
 *    held items, `(worn)` items, plus the "He is wearing ..." clothing
 *    prose. Captured only when we saw the player SEND an examine-self
 *    command (the block itself is third person and would otherwise be
 *    indistinguishable from examining another character of the same race).
 *  - `equip held` block: authoritative for HELD items — `<limb>: <item>`
 *    lines; limbs not listed are empty.
 *  - `show health` block: per-limb health adjectives.
 *  - Delta lines: wear/remove, summon appears/dissolves/disintegrates,
 *    put/take/drop, and `hold <item> in <limbs>` command echoes confirmed
 *    by the game's "Okay." reply.
 *
 * `take X from ...` never names the receiving hand, so taken items land in
 * an "unassigned held" bucket and the hands section is flagged approximate
 * (`handsStale`) until the next `equip held` / `x me` snapshot re-syncs it.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeldItem {
  name: string;
  /** Arrived via "You gesture and X appears ..." — vanishes when dismissed */
  summoned: boolean;
}

export interface LimbState {
  /** e.g. "upper left hand", "left foreleg" */
  limb: string;
  /** Health adjective from `x me` / `show health` ("in perfect health") */
  health: string | null;
  /** Held (non-worn) items on this limb */
  held: HeldItem[];
  /** Worn items attributed to this limb by `x me` */
  worn: string[];
}

export interface LoadoutState {
  /** Limb roster in server print order (learned, race-agnostic) */
  limbs: LimbState[];
  /** Worn items not attributed to a limb (clothing prose + live wear events) */
  wornLoose: string[];
  /** Held somewhere, hand unknown (take/remove events) */
  unassigned: string[];
  /** Hands section is an estimate — a take/remove happened since last sync */
  handsStale: boolean;
  /** Timestamps of the last authoritative syncs (0 = never) */
  fullSyncAt: number;
  heldSyncAt: number;
}

export type LoadoutChange = 'snapshot' | 'held' | 'worn' | 'health' | 'none';

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

/** Canonical item name: articles/possessives and state suffixes stripped. */
export function canonItem(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(?:a|an|the|your|my|some) /, '')
    .replace(/\s*\((?:worn|held|lit|open|closed)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameItem(a: string, b: string): boolean {
  const ca = canonItem(a);
  const cb = canonItem(b);
  return ca === cb || ca.endsWith(cb) || cb.endsWith(ca);
}

/** Substring containment either way — for events that name the limb, where
 *  our recorded name may be the player's shorthand ("chain" vs the full
 *  "blackened bronze chain with a malachite key on it"). */
function sameItemLoose(a: string, b: string): boolean {
  if (sameItem(a, b)) return true;
  const ca = canonItem(a);
  const cb = canonItem(b);
  return ca.length >= 3 && cb.length >= 3 && (ca.includes(cb) || cb.includes(ca));
}

/** A limb name is a hand slot if it can hold things. */
export function isHandLimb(limb: string): boolean {
  return /\bhands?\b/.test(limb);
}

// ---------------------------------------------------------------------------
// Line patterns
// ---------------------------------------------------------------------------

/** "He is in perfect health.  He has:" — starts the itemized limb list */
const XME_LIST_START =
  /^(?:He|She|It) is in [a-z][a-z -]*(?: health| condition)?\.\s+(?:He|She|It) has:$/;
/** "upper left hand  (in perfect health):" — limb section header */
const LIMB_HEADER = /^([a-z][a-z ]*?)\s+\(([a-z][a-z ]*)\):\s*$/;
/** "                   - a bloody axe" / "- an amulet (worn)" */
const LIMB_ITEM = /^\s*- (.+)$/;
/** "He is wearing a sash ..., an iron torc, and a pair of boots." */
const WEARING_PROSE_START = /(?:He|She) is wearing (.+)$/;
/** `equip held` line: "upper left hand: a large black steel great chain" */
const EQ_LINE = /^([a-z][a-z ]*hands?[a-z ]*): (.+)$/;
/** `show health` line: " upper left hand (very healthy)" — also "overall" */
const HEALTH_LINE = /^\s*([a-z][a-z ]*?)\s+\(([a-z][a-z ]*)\)\s*$/;

/** Examine-self commands (post-alias-expansion), e.g. "x me", "look at me" */
const EXAMINE_SELF_CMD = /^(?:x|ex|exa|exam|examine|l|look)(?: at)? me$/i;
const EQUIP_CMD = /^(?:eq|equip)(?: held)?$/i;
const SHOW_HEALTH_CMD = /^(?:sh|show health)$/i;
/** "hold chain in upper left hand and upper right hand" (also plain hold) */
const HOLD_CMD = /^(?:hold|wield) (.+?)(?: in ((?:[a-z ]*hand)(?: and [a-z ]*hand)*))?$/i;

// Delta lines (no command context needed)
const APPEARS = /^(?:> )?You gesture and (.+?) appears in your (.+?)!/;
const DISSOLVES = /^(?:> )?You gesture and (.+?) dissolves into mist and vanishes!/;
const DISINTEGRATES = /^(?:> )?(.+?) disintegrates from your (.+?)\./;
const WEAR = /^(?:> )?You wear (.+?)\.\s*$/;
/** "You remove your hood and put it in the chest." — worn → container */
const REMOVE_AND_PUT = /^(?:> )?You remove (.+?) and put (?:it|them) in (.+?)\.\s*$/;
/** "You remove your pants." — worn → a hand (which one is not named) */
const REMOVE = /^(?:> )?You remove (.+?)\.\s*$/;
const PUT = /^(?:> )?You put (.+?) (?:in|on) (.+?)\.?\s*$/;
const TAKE = /^(?:> )?You take (.+?) from (.+?)\.?\s*$/;
const DROP = /^(?:> )?You drop (.+?)\.\s*$/;
/** "You eat 8 bananas." / "You drink ..." — consumes from a hand */
const CONSUME = /^(?:> )?You (?:eat|drink|chug|quaff) (.+?)\.\s*$/;

/** How long a pending block capture / hold confirmation stays armed */
const CAPTURE_TTL_MS = 10_000;
/** Non-matching lines tolerated before an armed capture gives up */
const CAPTURE_GRACE_LINES = 30;

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

type Capture =
  | {
      kind: 'examine';
      at: number;
      misses: number;
      inList: boolean;
      prose: string | null;
      seen: Map<string, LimbState>;
    }
  | { kind: 'equip'; at: number; misses: number; seen: Map<string, string> }
  | { kind: 'health'; at: number; misses: number; seen: Map<string, string> };

interface PendingHold {
  item: string;
  limbs: string[] | null;
  at: number;
  misses: number;
}

export class LoadoutTracker {
  state: LoadoutState = emptyState();
  private capture: Capture | null = null;
  private pendingHold: PendingHold | null = null;

  /** Called for every command the player sends (post alias expansion). */
  onCommand(cmd: string, now: number): void {
    const c = cmd.trim();
    if (EXAMINE_SELF_CMD.test(c)) {
      this.capture = {
        kind: 'examine',
        at: now,
        misses: 0,
        inList: false,
        prose: null,
        seen: new Map(),
      };
      return;
    }
    if (EQUIP_CMD.test(c)) {
      this.capture = { kind: 'equip', at: now, misses: 0, seen: new Map() };
      return;
    }
    if (SHOW_HEALTH_CMD.test(c)) {
      this.capture = { kind: 'health', at: now, misses: 0, seen: new Map() };
      return;
    }
    const hold = HOLD_CMD.exec(c);
    if (hold) {
      const limbs = hold[2] ? hold[2].split(/ and /).map((l) => l.trim()) : null;
      this.pendingHold = { item: hold[1].trim(), limbs, at: now, misses: 0 };
    }
  }

  /**
   * Feed one output line. Returns what part of the state changed so the
   * context can re-render (and persist) only when something happened.
   */
  onLine(rawLine: string, now: number): LoadoutChange {
    const line = rawLine.replace(/^> /, '');

    // --- Armed block captures --------------------------------------------
    // The TTL measures INACTIVITY (refreshed on every consumed line), not
    // total age — a long examine block on a slow link must not expire
    // half-captured.
    if (this.capture && now - this.capture.at > CAPTURE_TTL_MS) this.capture = null;
    if (this.capture) {
      const cap = this.capture;
      const consumed = this.feedCapture(cap, line, now);
      if (consumed) {
        cap.at = now;
        return consumed === 'done' ? 'snapshot' : 'none';
      }
    }

    // --- Hold confirmation -------------------------------------------------
    if (this.pendingHold && now - this.pendingHold.at > CAPTURE_TTL_MS) this.pendingHold = null;
    if (this.pendingHold) {
      if (/^Okay\.\s*$/.test(line)) {
        const { item, limbs } = this.pendingHold;
        this.pendingHold = null;
        this.applyHold(item, limbs);
        return 'held';
      }
      if (/^(?:What \?|You can't|You don't|You aren't|You are not)/.test(line)) {
        this.pendingHold = null;
      } else if (++this.pendingHold.misses > CAPTURE_GRACE_LINES) {
        this.pendingHold = null;
      }
    }

    // --- Delta lines --------------------------------------------------------
    let m: RegExpExecArray | null;
    if ((m = APPEARS.exec(line))) {
      const limbs = m[2].split(/ and /).map((l) => l.trim());
      for (const limbName of limbs) {
        const limb = this.limbFor(limbName);
        if (limb) {
          limb.held = limb.held.filter((h) => !sameItem(h.name, m![1]));
          limb.held.push({ name: m[1], summoned: true });
        }
      }
      return 'held';
    }
    if ((m = DISSOLVES.exec(line))) {
      this.removeHeldByName(m[1]);
      return 'held';
    }
    if ((m = DISINTEGRATES.exec(line))) {
      // The limb is explicitly named, so a LOOSE match is safe: what we
      // recorded there may be the player's shorthand ("chain") while the
      // vanish line prints the item's full name.
      const limb = this.limbFor(m[2]);
      if (limb) limb.held = limb.held.filter((h) => !sameItemLoose(h.name, m![1]));
      else this.removeHeldByName(m[1]);
      return 'held';
    }
    if ((m = WEAR.exec(line))) {
      // Wearing consumes the item from a hand (or the unassigned bucket)
      this.removeHeldByName(m[1]);
      this.addWorn(m[1]);
      return 'worn';
    }
    if ((m = REMOVE_AND_PUT.exec(line))) {
      this.removeWornByName(m[1]);
      return 'worn';
    }
    if ((m = REMOVE.exec(line))) {
      // Removed into a hand the game doesn't name
      this.removeWornByName(m[1]);
      this.state.unassigned.push(m[1]);
      this.state.handsStale = true;
      return 'worn';
    }
    if ((m = PUT.exec(line))) {
      // "(worn)" in the item text = stowing a worn container. Either way
      // the item left the hand (or the unassigned bucket, when the stow
      // sequence's bare "You remove X." parked it there moments earlier).
      if (/\(worn\)/.test(m[1])) this.removeWornByName(m[1]);
      this.removeHeldByName(m[1]);
      return 'held';
    }
    if ((m = TAKE.exec(line))) {
      this.state.unassigned.push(m[1]);
      this.state.handsStale = true;
      return 'held';
    }
    if ((m = DROP.exec(line))) {
      this.removeHeldByName(m[1]);
      return 'held';
    }
    if ((m = CONSUME.exec(line))) {
      // Loose match: "You eat 8 bananas." vs the taken "bananas"
      this.removeHeldLoose(m[1]);
      return 'held';
    }

    return 'none';
  }

  // -------------------------------------------------------------------------
  // Block captures
  // -------------------------------------------------------------------------

  /** Returns 'done' when the block completed, true when the line was
   *  consumed, false when it didn't belong to the capture. */
  private feedCapture(cap: Capture, line: string, now: number): 'done' | boolean {
    if (cap.kind === 'examine') return this.feedExamine(cap, line, now);
    if (cap.kind === 'equip') return this.feedEquip(cap, line, now);
    return this.feedHealth(cap, line, now);
  }

  private feedExamine(
    cap: Extract<Capture, { kind: 'examine' }>,
    line: string,
    now: number
  ): 'done' | boolean {
    // Clothing prose — may start mid-line inside the description paragraph
    // and wrap; collect until the sentence's period.
    if (!cap.inList && cap.prose !== null && !/\.\s*$/.test(cap.prose)) {
      if (XME_LIST_START.test(line)) {
        cap.inList = true;
        return true;
      }
      cap.prose += ' ' + line.trim();
      return true;
    }
    if (!cap.inList) {
      const w = WEARING_PROSE_START.exec(line);
      if (w) {
        cap.prose = w[1];
        return true;
      }
      if (XME_LIST_START.test(line)) {
        cap.inList = true;
        return true;
      }
      // Description prose before the list — tolerate a bounded number
      if (++cap.misses > CAPTURE_GRACE_LINES) this.capture = null;
      return true;
    }
    // Inside the itemized list
    const header = LIMB_HEADER.exec(line);
    if (header && !/^overall$/.test(header[1].trim())) {
      cap.seen.set(header[1].trim(), {
        limb: header[1].trim(),
        health: header[2].trim(),
        held: [],
        worn: [],
      });
      return true;
    }
    const item = LIMB_ITEM.exec(line);
    if (item && cap.seen.size > 0) {
      const last = [...cap.seen.values()][cap.seen.size - 1];
      const text = item[1].trim();
      if (/\(worn\)/.test(text)) last.worn.push(text.replace(/\s*\(worn\)/, '').trim());
      else last.held.push({ name: text, summoned: this.wasSummoned(text) });
      return true;
    }
    if (line.trim() === '') return true; // blank inside the block
    // First foreign line ends the block — commit the snapshot.
    this.commitExamine(cap, now);
    this.capture = null;
    return false;
  }

  private feedEquip(
    cap: Extract<Capture, { kind: 'equip' }>,
    line: string,
    now: number
  ): 'done' | boolean {
    const m = EQ_LINE.exec(line);
    if (m) {
      cap.seen.set(m[1].trim(), m[2].trim());
      return true;
    }
    if (/^You (?:are not|aren't) (?:holding|wielding)/.test(line)) {
      this.commitEquip(cap, now);
      this.capture = null;
      return 'done';
    }
    if (cap.seen.size > 0) {
      // Block ended at the first non-matching line
      this.commitEquip(cap, now);
      this.capture = null;
      return false;
    }
    if (++cap.misses > CAPTURE_GRACE_LINES) this.capture = null;
    return false;
  }

  private feedHealth(
    cap: Extract<Capture, { kind: 'health' }>,
    line: string,
    _now: number
  ): 'done' | boolean {
    const m = HEALTH_LINE.exec(line);
    if (m && m[1].trim() !== 'overall') {
      cap.seen.set(m[1].trim(), m[2].trim());
      return true;
    }
    if (m) return true; // overall line
    if (cap.seen.size > 0) {
      for (const [limbName, health] of cap.seen) {
        const limb = this.limbFor(limbName, true);
        if (limb) limb.health = health;
      }
      this.capture = null;
      return false;
    }
    if (++cap.misses > CAPTURE_GRACE_LINES) this.capture = null;
    return false;
  }

  private commitExamine(cap: Extract<Capture, { kind: 'examine' }>, now: number): void {
    if (cap.seen.size === 0) return;
    const s = this.state;
    s.limbs = [...cap.seen.values()];
    // The wearing sentence usually ends mid-line ("...leather boots.  He is
    // a middle aged spyder...") — everything after its first period is the
    // next description sentence, not clothing.
    s.wornLoose = cap.prose ? splitProseList(cap.prose.replace(/\..*$/, '')) : s.wornLoose;
    s.unassigned = [];
    s.handsStale = false;
    s.fullSyncAt = now;
    s.heldSyncAt = now;
  }

  private commitEquip(cap: Extract<Capture, { kind: 'equip' }>, now: number): void {
    const s = this.state;
    // Limbs named by eq exist even if x me was never run
    for (const limbName of cap.seen.keys()) this.limbFor(limbName, true);
    for (const limb of s.limbs) {
      if (!isHandLimb(limb.limb)) continue;
      const item = cap.seen.get(limb.limb);
      if (item === undefined) {
        limb.held = [];
      } else {
        limb.held = [{ name: item, summoned: this.wasSummoned(item) }];
      }
    }
    s.unassigned = [];
    s.handsStale = false;
    s.heldSyncAt = now;
  }

  // -------------------------------------------------------------------------
  // State mutation helpers
  // -------------------------------------------------------------------------

  private limbFor(name: string, createIfMissing = false): LimbState | null {
    const key = name.trim();
    let limb = this.state.limbs.find((l) => l.limb === key) ?? null;
    if (!limb) {
      // Lenient: "right hand" matches "upper right hand" for two-handed races
      limb = this.state.limbs.find((l) => l.limb.endsWith(key)) ?? null;
    }
    if (!limb && (createIfMissing || isHandLimb(key))) {
      limb = { limb: key, health: null, held: [], worn: [] };
      this.state.limbs.push(limb);
    }
    return limb;
  }

  private applyHold(item: string, limbs: string[] | null): void {
    // The item leaves wherever it was
    this.removeHeldByName(item);
    if (!limbs) {
      this.state.unassigned.push(item);
      this.state.handsStale = true;
      return;
    }
    for (const limbName of limbs) {
      const limb = this.limbFor(limbName, true);
      if (limb) limb.held.push({ name: item, summoned: this.wasSummoned(item) });
    }
  }

  /** Was an item with this name summoned per current state? (keeps the
   *  badge across re-syncs — eq output doesn't say). */
  private wasSummoned(name: string): boolean {
    return this.state.limbs.some((l) => l.held.some((h) => h.summoned && sameItem(h.name, name)));
  }

  private removeHeldByName(name: string): void {
    for (const limb of this.state.limbs) {
      limb.held = limb.held.filter((h) => !sameItem(h.name, name));
    }
    this.state.unassigned = this.state.unassigned.filter((n) => !sameItem(n, name));
  }

  private removeHeldLoose(name: string): void {
    for (const limb of this.state.limbs) {
      limb.held = limb.held.filter((h) => !sameItemLoose(h.name, name));
    }
    this.state.unassigned = this.state.unassigned.filter((n) => !sameItemLoose(n, name));
  }

  private addWorn(name: string): void {
    if (
      !this.state.wornLoose.some((n) => sameItem(n, name)) &&
      !this.state.limbs.some((l) => l.worn.some((n) => sameItem(n, name)))
    ) {
      this.state.wornLoose.push(name.replace(/^(?:a|an|the|your|my) /, ''));
    }
  }

  private removeWornByName(name: string): void {
    this.state.wornLoose = this.state.wornLoose.filter((n) => !sameItem(n, name));
    for (const limb of this.state.limbs) {
      limb.worn = limb.worn.filter((n) => !sameItem(n, name));
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  serialize(): unknown {
    return { v: 1, state: this.state };
  }

  static deserialize(data: unknown): LoadoutTracker {
    const t = new LoadoutTracker();
    if (!data || typeof data !== 'object') return t;
    const d = data as { v?: number; state?: LoadoutState };
    if (!d.state || !Array.isArray(d.state.limbs)) return t;
    t.state = {
      ...emptyState(),
      ...d.state,
      limbs: d.state.limbs.map((l) => ({
        limb: l.limb,
        health: l.health ?? null,
        held: Array.isArray(l.held) ? l.held : [],
        worn: Array.isArray(l.worn) ? l.worn : [],
      })),
      wornLoose: Array.isArray(d.state.wornLoose) ? d.state.wornLoose : [],
      unassigned: Array.isArray(d.state.unassigned) ? d.state.unassigned : [],
      // A reload means we missed output — never trust hands blindly
      handsStale: true,
    };
    return t;
  }

  reset(): void {
    this.state = emptyState();
    this.capture = null;
    this.pendingHold = null;
  }
}

function emptyState(): LoadoutState {
  return {
    limbs: [],
    wornLoose: [],
    unassigned: [],
    handsStale: false,
    fullSyncAt: 0,
    heldSyncAt: 0,
  };
}

/** "a sash ..., an iron torc, a shirt, and a pair of boots" → items */
function splitProseList(prose: string): string[] {
  return prose
    .split(/, and |, |and (?=a |an |the )/)
    .map((s) => s.replace(/^(?:a|an|the) /, '').trim())
    .filter((s) => s.length > 0);
}
