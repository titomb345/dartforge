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
 * Hands are never guessed at between snapshots: the game usually doesn't
 * say which hand an event touched, so any hand-affecting delta just flags
 * `handsStale` and the hook fires a silent gagged `equip held` to re-sync
 * with truth moments later.
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
  /** Hands shown are from the last snapshot and something has changed since
   *  — the auto-verify eq clears this moments later */
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

/** A limb name is a hand slot if it can hold things. */
export function isHandLimb(limb: string): boolean {
  return /\bhands?\b/.test(limb);
}

/** Line-shape tests for `equip held` output, used by the OutputFilter's
 *  sync gag so background hand re-syncs don't spam the terminal. */
export function isEquipHeldLine(stripped: string): boolean {
  return EQ_LINE.test(stripped);
}
export function isEquipNotHoldingLine(stripped: string): boolean {
  // "No equipment to show." is the live empty-hands reply to `equip held`;
  // the "not holding/wielding" shape covers other equip variants.
  return /^(?:No equipment to show\.|You (?:are not|aren't) (?:holding|wielding))/.test(stripped);
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

/** Examine-self commands (post-alias-expansion). DartMUD's native command
 *  is `view` (Bill's `x` is an alias for it); the others are tolerated. */
const EXAMINE_SELF_CMD = /^(?:view|x|ex|exa|exam|examine|l|look)(?: at)? me$/i;
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

export class LoadoutTracker {
  state: LoadoutState = emptyState();
  private capture: Capture | null = null;
  /** Set by the commit* methods so onLine/flush can REPORT the change —
   *  a commit that isn't reported never reaches React and the panel
   *  silently stays stale (the original live bug). */
  private lastCommit: LoadoutChange = 'none';
  /** Canonical names of items seen arriving via a summon — held items
   *  matching one get the ✦ badge when snapshots rebuild the hands
   *  (eq output can't tell summoned from real). Pruned on snapshots. */
  private summonedNames = new Set<string>();

  /**
   * Called for every command the player sends (post alias expansion).
   * Returns true when the command may have changed what the hands hold
   * without any parseable echo ("hold X in ..." replies just "Okay."),
   * so the caller should schedule a verify re-sync.
   */
  onCommand(cmd: string, now: number): boolean {
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
      return false;
    }
    if (EQUIP_CMD.test(c)) {
      this.capture = { kind: 'equip', at: now, misses: 0, seen: new Map() };
      return false;
    }
    if (SHOW_HEALTH_CMD.test(c)) {
      this.capture = { kind: 'health', at: now, misses: 0, seen: new Map() };
      return false;
    }
    if (HOLD_CMD.test(c)) {
      this.state.handsStale = true;
      return true;
    }
    return false;
  }

  /**
   * Feed one output line. Returns what part of the state changed so the
   * context can re-render (and persist) only when something happened.
   */
  onLine(rawLine: string, now: number): LoadoutChange {
    // Queued commands can stack several prompts before a line ("> > ...")
    const line = rawLine.replace(/^(?:> )+/, '');

    // --- Armed block captures --------------------------------------------
    // The TTL measures INACTIVITY (refreshed on every consumed line), not
    // total age — a long examine block on a slow link must not expire
    // half-captured.
    if (this.capture && now - this.capture.at > CAPTURE_TTL_MS) this.capture = null;
    if (this.capture) {
      const cap = this.capture;
      this.lastCommit = 'none';
      const consumed = this.feedCapture(cap, line, now);
      const committed = this.lastCommit;
      if (consumed) {
        cap.at = now;
        return committed;
      }
      if (committed !== 'none') {
        // The block committed because THIS foreign line ended it — the
        // line may itself be a delta, so parse it too, but never report
        // less than the commit.
        const rest = this.parseStream(line, now);
        return rest === 'none' ? committed : rest;
      }
    }

    return this.parseStream(line, now);
  }

  /**
   * Commit a block capture that is still open but has content — called by
   * the hook after a quiet period. Without this, an `equip held` block sent
   * in a lull only commits when the NEXT unrelated server line arrives.
   */
  flush(now: number): LoadoutChange {
    const cap = this.capture;
    if (!cap) return 'none';
    this.lastCommit = 'none';
    if (cap.kind === 'examine' && cap.inList && cap.seen.size > 0) this.commitExamine(cap, now);
    else if (cap.kind === 'equip' && cap.seen.size > 0) this.commitEquip(cap, now);
    else if (cap.kind === 'health' && cap.seen.size > 0) this.commitHealth(cap);
    if (this.lastCommit !== 'none') this.capture = null;
    return this.lastCommit;
  }

  /** True while a block capture is armed (the hook uses this to schedule
   *  an idle flush). */
  get hasPendingCapture(): boolean {
    return this.capture !== null;
  }

  /**
   * Delta lines. Hands are NEVER guessed at: the game usually doesn't say
   * which hand ("hold X in right hand" on a four-handed race, one of three
   * identical tonfas dissolving), and per Bill the interim guesses were
   * pure visual noise. Any hand-affecting event just flags the hands
   * unverified — the caller's auto-verify eq replaces that with truth
   * moments later. Worn tracking stays live: wear/remove echoes name the
   * item exactly and involve no limb guessing.
   */
  private parseStream(line: string, _now: number): LoadoutChange {
    let m: RegExpExecArray | null;
    if ((m = APPEARS.exec(line))) {
      // Remember the name for the ✦ badge — snapshots can't tell summoned
      // gear from real gear on their own.
      this.summonedNames.add(canonItem(m[1]));
      this.state.handsStale = true;
      return 'held';
    }
    if (DISSOLVES.test(line) || DISINTEGRATES.test(line)) {
      this.state.handsStale = true;
      return 'held';
    }
    if ((m = WEAR.exec(line))) {
      this.addWorn(m[1]);
      this.state.handsStale = true; // it left a hand
      return 'worn';
    }
    if ((m = REMOVE_AND_PUT.exec(line))) {
      this.removeWornByName(m[1]); // straight into a container, hands untouched
      return 'worn';
    }
    if ((m = REMOVE.exec(line))) {
      this.removeWornByName(m[1]);
      this.state.handsStale = true; // removed INTO an unnamed hand
      return 'worn';
    }
    if ((m = PUT.exec(line))) {
      if (/\(worn\)/.test(m[1])) this.removeWornByName(m[1]);
      this.state.handsStale = true;
      return 'held';
    }
    if (TAKE.test(line) || DROP.test(line) || CONSUME.test(line)) {
      this.state.handsStale = true;
      return 'held';
    }

    return 'none';
  }

  // -------------------------------------------------------------------------
  // Block captures
  // -------------------------------------------------------------------------

  /** Returns true when the line was consumed, false when it didn't belong
   *  to the capture. Commits are reported through this.lastCommit. */
  private feedCapture(cap: Capture, line: string, now: number): boolean {
    if (cap.kind === 'examine') return this.feedExamine(cap, line, now);
    if (cap.kind === 'equip') return this.feedEquip(cap, line, now);
    return this.feedHealth(cap, line);
  }

  private feedExamine(
    cap: Extract<Capture, { kind: 'examine' }>,
    line: string,
    now: number
  ): boolean {
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
      else last.held.push({ name: text, summoned: false }); // marked on commit
      return true;
    }
    if (line.trim() === '') return true; // blank inside the block
    // First foreign line ends the block — commit the snapshot.
    this.commitExamine(cap, now);
    this.capture = null;
    return false;
  }

  private feedEquip(cap: Extract<Capture, { kind: 'equip' }>, line: string, now: number): boolean {
    const m = EQ_LINE.exec(line);
    if (m) {
      cap.seen.set(m[1].trim(), m[2].trim());
      return true;
    }
    if (isEquipNotHoldingLine(line)) {
      // Empty-hands reply — commits with nothing seen, clearing every hand
      this.commitEquip(cap, now);
      this.capture = null;
      return true;
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

  private feedHealth(cap: Extract<Capture, { kind: 'health' }>, line: string): boolean {
    const m = HEALTH_LINE.exec(line);
    if (m && m[1].trim() !== 'overall') {
      cap.seen.set(m[1].trim(), m[2].trim());
      return true;
    }
    if (m) return true; // overall line
    if (cap.seen.size > 0) {
      this.commitHealth(cap);
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
    for (const limb of s.limbs) {
      for (const h of limb.held) h.summoned = this.isSummonedName(h.name);
    }
    // The wearing sentence usually ends mid-line ("...leather boots.  He is
    // a middle aged spyder...") — everything after its first period is the
    // next description sentence, not clothing.
    s.wornLoose = cap.prose ? splitProseList(cap.prose.replace(/\..*$/, '')) : s.wornLoose;
    s.handsStale = false;
    s.fullSyncAt = now;
    s.heldSyncAt = now;
    this.pruneSummonedNames();
    this.lastCommit = 'snapshot';
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
        limb.held = [{ name: item, summoned: this.isSummonedName(item) }];
      }
    }
    s.handsStale = false;
    s.heldSyncAt = now;
    this.pruneSummonedNames();
    this.lastCommit = 'snapshot';
  }

  private commitHealth(cap: Extract<Capture, { kind: 'health' }>): void {
    for (const [limbName, health] of cap.seen) {
      const limb = this.limbFor(limbName, true);
      if (limb) limb.health = health;
    }
    this.lastCommit = 'health';
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

  /** Does this held-item name match one seen arriving via a summon? */
  private isSummonedName(name: string): boolean {
    const c = canonItem(name);
    for (const s of this.summonedNames) {
      if (c === s || c.endsWith(s) || s.endsWith(c)) return true;
    }
    return false;
  }

  /** Forget summoned names no longer held anywhere (called on snapshots —
   *  summoned gear vanishes rather than being put down, so absence from a
   *  snapshot means it's gone for good). */
  private pruneSummonedNames(): void {
    for (const s of [...this.summonedNames]) {
      const stillHeld = this.state.limbs.some((l) =>
        l.held.some((h) => {
          const c = canonItem(h.name);
          return c === s || c.endsWith(s) || s.endsWith(c);
        })
      );
      if (!stillHeld) this.summonedNames.delete(s);
    }
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
    return { v: 1, state: this.state, summoned: [...this.summonedNames] };
  }

  static deserialize(data: unknown): LoadoutTracker {
    const t = new LoadoutTracker();
    if (!data || typeof data !== 'object') return t;
    const d = data as { v?: number; state?: LoadoutState; summoned?: unknown };
    if (!d.state || !Array.isArray(d.state.limbs)) return t;
    t.state = {
      limbs: d.state.limbs.map((l) => ({
        limb: l.limb,
        health: l.health ?? null,
        held: Array.isArray(l.held) ? l.held : [],
        worn: Array.isArray(l.worn) ? l.worn : [],
      })),
      wornLoose: Array.isArray(d.state.wornLoose) ? d.state.wornLoose : [],
      // A reload means we missed output — never trust hands blindly
      handsStale: true,
      fullSyncAt: d.state.fullSyncAt ?? 0,
      heldSyncAt: d.state.heldSyncAt ?? 0,
    };
    if (Array.isArray(d.summoned)) {
      for (const s of d.summoned) if (typeof s === 'string') t.summonedNames.add(s);
    }
    return t;
  }

  reset(): void {
    this.state = emptyState();
    this.capture = null;
    this.summonedNames.clear();
  }
}

function emptyState(): LoadoutState {
  return {
    limbs: [],
    wornLoose: [],
    handsStale: false,
    fullSyncAt: 0,
    heldSyncAt: 0,
  };
}

/**
 * "a sash ..., an iron torc, a shirt, and a pair of boots" → items.
 *
 * Item names themselves contain comma lists ("a sash ... with silver, iron,
 * copper, steel, gold, and brass medals pinned to it" is ONE item), so a
 * naive comma split shreds them. Every item in the wearing sentence starts
 * with an article, so only a comma FOLLOWED BY an article is an item
 * boundary — the medals list never is.
 */
function splitProseList(prose: string): string[] {
  return prose
    .split(/,\s+(?:and\s+)?(?=(?:a|an|the|some)\s)/i)
    .map((s) => s.replace(/^(?:a|an|the|some) /, '').trim())
    .filter((s) => s.length > 0);
}
