import { matchConcentrationLine, type ConcentrationMatch } from './concentrationPatterns';
import { matchHealthLine, type HealthMatch } from './healthPatterns';
import { matchNeedsLine, type NeedLevel } from './needsPatterns';
import { matchAuraLine, type AuraMatch } from './auraPatterns';
import { matchEncumbranceLine, type EncumbranceMatch } from './encumbrancePatterns';
import { matchMovementLine, type MovementMatch } from './movementPatterns';
import { matchAlignmentLine, type AlignmentMatch } from './alignmentPatterns';
import { matchChatLine, isIncompleteChatLine } from './chatPatterns';
import { transformBoardDateLine } from './boardDatePatterns';
import { isWhoHeaderLine, isWhoFinalLine, buildWhoSnapshot, type WhoSnapshot } from './whoPatterns';
import { isEquipHeldLine, isEquipNotHoldingLine } from './loadout';
import type { ChatMessage } from '../types/chat';
import { stripAnsi } from './ansiUtils';

/**
 * Anti-spam repeat window (ms). Identical lines only collapse when each
 * arrives within this window of the previous one; every occurrence restarts
 * the window. Once the window lapses with no repeat, the line is forgotten
 * and a later identical line is shown fresh instead of collapsed.
 */
const ANTI_SPAM_WINDOW_MS = 1000;

/** Sync gag flag keys. */
type SyncGagFlags = {
  hp: boolean;
  score: boolean;
  combatAlloc: boolean;
  magicAlloc: boolean;
  alignment: boolean;
  who: boolean;
  equip: boolean;
};

/** Default sync gag flags (all disabled). */
const SYNC_GAGS_CLEAR: SyncGagFlags = {
  hp: false,
  score: false,
  combatAlloc: false,
  magicAlloc: false,
  alignment: false,
  who: false,
  equip: false,
};

/*
 * ---- Equip response attribution ------------------------------------------
 * The `equip held` reply has no header or footer, and the app's silent
 * background re-syncs race the player's own eq commands — so deciding
 * gag-vs-show by line shape and timing is fundamentally ambiguous (it
 * leaked split responses AND swallowed manual eq output). Instead, every
 * outgoing equip command is queued in true send order, tagged 'gag'
 * (app-initiated re-sync) or 'show' (sent by the player), and each reply
 * block consumes exactly one entry — DartMUD answers commands strictly in
 * order. A manual eq can therefore never be swallowed by a background
 * gag, and every doubt (empty queue, expired entry) defaults to 'show'.
 */

/** A reply block is closed after this much quiet with no foreign line (a
 *  reply in an otherwise silent room has nothing to terminate it). The
 *  block itself survives chunk boundaries — replies regularly split
 *  across TCP reads, even mid-word. */
const EQUIP_BLOCK_IDLE_MS = 400;
/** Queue entries older than this are dropped: the reply would have long
 *  arrived, so a stale entry means it was lost — it must never claim a
 *  later reply. */
const EQUIP_ENTRY_TTL_MS = 10_000;
/** The startSync/startEquipSync "the next equip command is ours"
 *  handshake expires after this long, so an app send that never goes out
 *  can't tag a later manual command as gagged. */
const EQUIP_EXPECT_TTL_MS = 2_000;
/** Outgoing commands that produce equip-shaped replies. */
const EQUIP_CMD_RE = /^(?:eq|equip)\b/i;

/** Pre-compiled regexes for score block detection (avoid recompiling on every call) */
const SCORE_NAME_RE = /^You are .+ the .+\.\s+You are a /;
const SCORE_STATUS_RE = /^(Needs|Encumbrance|Concentration|Movement|Aura)\s*:/i;

/** Pre-compiled regexes for sync gagging of alloc/magic output */
const SYNC_LIMB_HEADER_RE = /^(\w[\w\s]*?)\s*:\s*$/;
const SYNC_ALLOC_VALUES_RE = /bonus:\s*\d+\s+daring:\s*\d+/;
const SYNC_MAGIC_HEADER_RE = /^elemental affinity:\s*$/i;
const SYNC_MAGIC_VALUES_RE = /air:\s*\d+\s+fire:\s*\d+/;

/**
 * Detect whether a stripped line belongs to a score block.
 * Score blocks contain: name/class, soul age, needs, encumbrance, movement, aura.
 */
function isScoreBlockLine(stripped: string): boolean {
  if (SCORE_NAME_RE.test(stripped)) return true;
  if (stripped.startsWith("Your soul's age")) return true;
  if (SCORE_STATUS_RE.test(stripped)) return true;
  return false;
}

/** Return value from the onLine callback — controls gag and highlight behavior */
export interface LineCallbackResult {
  /** If true, suppress this line from terminal output */
  gag: boolean;
  /** If set, wrap the line in this ANSI color code (e.g. "33" for yellow) */
  highlight: string | null;
  /** If set, replace the display segment with this string (preserves line ending) */
  replacement?: string;
}

export interface OutputFilterCallbacks {
  onConcentration?: (match: ConcentrationMatch) => void;
  onHealth?: (match: HealthMatch) => void;
  onHunger?: (level: NeedLevel) => void;
  onThirst?: (level: NeedLevel) => void;
  onAura?: (match: AuraMatch) => void;
  onEncumbrance?: (match: EncumbranceMatch) => void;
  onMovement?: (match: MovementMatch) => void;
  onAlignment?: (match: AlignmentMatch) => void;
  onChat?: (msg: ChatMessage) => void;
  onWho?: (snapshot: WhoSnapshot) => void;
  /** Fired for every complete line with stripped + raw text. Return gag/highlight directives. */
  onLine?: (stripped: string, raw: string) => LineCallbackResult | void;
  /**
   * Fired for every complete line with ANSI stripped but leading whitespace
   * PRESERVED (only trailing CR/LF removed). Required by the automapper —
   * hex art is column-aligned ASCII and trimming destroys it.
   * `raw` is the same line WITH ANSI codes, for color-based art parsing
   * (rivers and paths share the '*' char and differ only by color).
   */
  onMapLine?: (line: string, raw: string) => void;
}

/** Per-status filter flags — controls which status types get stripped from terminal. */
export interface FilterFlags {
  concentration: boolean;
  hunger: boolean;
  thirst: boolean;
  aura: boolean;
  encumbrance: boolean;
  movement: boolean;
  alignment: boolean;
}

export const DEFAULT_FILTER_FLAGS: FilterFlags = {
  concentration: false,
  hunger: false,
  thirst: false,
  aura: false,
  encumbrance: false,
  movement: false,
  alignment: false,
};

/**
 * Line-buffered output filter that removes tracked status messages from
 * raw MUD output before it reaches the terminal. Fires callbacks when
 * status changes are detected.
 */
export class OutputFilter {
  private buffer = '';
  private callbacks: OutputFilterCallbacks;
  /** Per-status filter flags — when true, matching messages are stripped from terminal. */
  filterFlags: FilterFlags = { ...DEFAULT_FILTER_FLAGS };
  /** Active character name for own-message detection in chat matching. */
  activeCharacter: string | null = null;
  /** Optional resolver for anonymous tell/SZ signatures → player names. */
  signatureResolver:
    | ((messageBody: string) => { playerName: string; message: string } | null)
    | null = null;
  /** When true, convert in-game bulletin board dates to real-world dates. */
  boardDatesEnabled = true;
  /** When true, strip server prompt prefix ("> ") from terminal output. */
  stripPrompts = true;
  /** When true, collapse consecutive identical lines with a repeat count. */
  antiSpamEnabled = false;
  /**
   * Number of identical occurrences before collapsing kicks in. Occurrences
   * below this count are shown in full (a few repeats are usually legitimate);
   * only from the Nth identical line onward are duplicates collapsed into the
   * `[repeated xN]` marker. Minimum 2 (collapse on the 2nd occurrence).
   */
  antiSpamThreshold = 4;
  /** Callback to write anti-spam flush output to the terminal asynchronously. */
  onAntiSpamFlush: ((text: string) => void) | null = null;
  /** Callback invoked when sync gagging completes (all login responses consumed). */
  onSyncEnd: (() => void) | null = null;

  /* ---- Sync gag state (pattern-based, NOT blanket suppression) ---- */
  private syncActive = false;
  private syncGags = { ...SYNC_GAGS_CLEAR };
  /** True while inside the multi-line score block during sync. */
  private syncInScoreBlock = false;
  /** True while a limb header was seen, waiting for its values line. */
  private syncAllocPending = false;
  /** True after at least one complete limb has been gagged. */
  private syncAllocHasData = false;
  /** True after "elemental affinity:" header seen, waiting for values. */
  private syncMagicPending = false;
  /* ---- Equip response attribution (always on, independent of sync) ---- */
  /** Pending equip commands in send order — each reply block pops one. */
  private equipQueue: { vis: 'gag' | 'show'; at: number }[] = [];
  /** Timestamp of a pending "next equip command is app-initiated"
   *  handshake (0 = none). Set by startSync/startEquipSync immediately
   *  before their own send, consumed by noteEquipCommand. */
  private equipExpectGaggedAt = 0;
  /** Limbs seen in the currently open reply block (null = no block open).
   *  A repeated limb means a NEW reply started with no separator line. */
  private equipBlockLimbs: Set<string> | null = null;
  /** Whether the currently open reply block is being gagged. */
  private equipBlockGagged = false;
  /** Closes an open reply block after a quiet period. */
  private equipBlockTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while inside the who list block during sync. */
  private syncInWhoBlock = false;
  /** Accumulated who list lines during sync (stripped). */
  private syncWhoLines: string[] = [];
  /** Accumulated who list raw lines during sync (with ANSI). */
  private syncWhoRawLines: string[] = [];
  /** Safety timer to auto-end sync. */
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  /* ---- Multi-line chat buffering ---- */
  private chatLineBuffer: string[] | null = null;
  /** Max continuation lines before discarding an incomplete chat buffer. */
  private static readonly CHAT_BUFFER_MAX = 5;

  /* ---- Passive who tracking (captures manual `who` output without gagging) ---- */
  private passiveWhoActive = false;
  private passiveWhoLines: string[] = [];
  private passiveWhoRawLines: string[] = [];

  /* ---- Gag-adjacent blank line suppression ---- */
  private lastLineGagged = false;

  /* ---- Anti-spam state ---- */
  private prevStrippedLine: string | null = null;
  private repeatCount = 0;
  private antiSpamTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: OutputFilterCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /** Format the anti-spam count line. */
  private static antiSpamLine(count: number): string {
    return `\x1b[90m  [repeated x${count}]\x1b[0m\r\n`;
  }

  /**
   * Whether the accumulated repeats reached the collapse threshold — i.e.
   * whether at least one duplicate was actually collapsed and so a
   * `[repeated xN]` marker should be emitted. `repeatCount + 1` is the total
   * occurrence count (the first shown line plus each repeat).
   */
  private shouldEmitRepeat(): boolean {
    return this.repeatCount + 1 >= this.antiSpamThreshold;
  }

  /** Cancel the pending anti-spam flush timer. */
  private clearAntiSpamTimer(): void {
    if (this.antiSpamTimer) {
      clearTimeout(this.antiSpamTimer);
      this.antiSpamTimer = null;
    }
  }

  /**
   * Start (or restart) the anti-spam repeat window. Called whenever the
   * tracked line is set or matched, so the window slides forward with each
   * occurrence. When it lapses, flush any accumulated count and forget the
   * tracked line so a later identical line is shown fresh.
   */
  private startAntiSpamTimer(): void {
    this.clearAntiSpamTimer();
    this.antiSpamTimer = setTimeout(() => {
      this.antiSpamTimer = null;
      if (this.shouldEmitRepeat()) {
        const text = OutputFilter.antiSpamLine(this.repeatCount + 1);
        this.onAntiSpamFlush?.(text);
      }
      this.repeatCount = 0;
      this.prevStrippedLine = null;
    }, ANTI_SPAM_WINDOW_MS);
  }

  /** Reset all who-related tracking state (sync + passive). */
  private resetWhoState(): void {
    this.syncInWhoBlock = false;
    this.syncWhoLines = [];
    this.syncWhoRawLines = [];
    this.passiveWhoActive = false;
    this.passiveWhoLines = [];
    this.passiveWhoRawLines = [];
  }

  /**
   * Accumulate a who-list line and fire onWho when the footer is reached.
   * Returns true when the block is complete.
   */
  private accumulateWhoLine(
    stripped: string,
    raw: string,
    lines: string[],
    rawLines: string[]
  ): boolean {
    lines.push(stripped);
    rawLines.push(raw);
    if (isWhoFinalLine(stripped)) {
      this.callbacks.onWho?.(buildWhoSnapshot(lines, rawLines));
      return true;
    }
    return false;
  }

  /** Clear any pending sync safety timer. */
  private clearSyncTimer(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** Start (or restart) the sync safety timer. */
  private startSyncTimer(ms: number): void {
    this.clearSyncTimer();
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.endSync();
    }, ms);
  }

  /**
   * Record an outgoing command in true send order (the caller taps both
   * the direct send path and the action-blocker flush). Equip commands
   * are queued for reply attribution; everything else is ignored.
   */
  noteEquipCommand(cmd: string): void {
    if (!EQUIP_CMD_RE.test(cmd.trim())) return;
    const now = Date.now();
    const gagged =
      this.equipExpectGaggedAt > 0 && now - this.equipExpectGaggedAt < EQUIP_EXPECT_TTL_MS;
    this.equipExpectGaggedAt = 0;
    this.equipQueue.push({ vis: gagged ? 'gag' : 'show', at: now });
  }

  /** Pop the visibility for a reply block that just started. Expired
   *  entries are dropped first; an empty queue means the reply wasn't
   *  ours to track — show it. */
  private shiftEquipVis(): 'gag' | 'show' {
    const now = Date.now();
    while (this.equipQueue.length && now - this.equipQueue[0].at > EQUIP_ENTRY_TTL_MS) {
      this.equipQueue.shift();
    }
    return this.equipQueue.shift()?.vis ?? 'show';
  }

  /** Cancel the pending equip block idle timer. */
  private clearEquipBlockTimer(): void {
    if (this.equipBlockTimer) {
      clearTimeout(this.equipBlockTimer);
      this.equipBlockTimer = null;
    }
  }

  /** (Re)arm the equip block idle timer — closes the block when no
   *  foreign line arrives to end it (quiet room). */
  private armEquipBlockTimer(): void {
    this.clearEquipBlockTimer();
    this.equipBlockTimer = setTimeout(() => {
      this.equipBlockTimer = null;
      if (this.equipBlockLimbs) this.closeEquipBlock();
    }, EQUIP_BLOCK_IDLE_MS);
  }

  /** Close the open reply block, and release the equip sync flag once no
   *  app-initiated reply remains outstanding (lets a login or background
   *  sync complete). */
  private closeEquipBlock(): void {
    this.equipBlockLimbs = null;
    this.equipBlockGagged = false;
    this.clearEquipBlockTimer();
    if (
      this.syncGags.equip &&
      this.equipExpectGaggedAt === 0 &&
      !this.equipQueue.some((e) => e.vis === 'gag')
    ) {
      this.syncGags.equip = false;
      this.checkSyncDone();
    }
  }

  /**
   * Always-on equip reply tracker — runs on every line, independent of
   * sync state. Returns true when the line belongs to an app-initiated
   * reply and must be suppressed. Blocks survive chunk boundaries; they
   * end at the first foreign line, at a repeated limb (a new reply
   * starting back-to-back with no separator), or on the idle timer.
   */
  private trackEquipLine(stripped: string): boolean {
    if (isEquipNotHoldingLine(stripped)) {
      // Single-line "nothing held" reply — a complete reply on its own.
      if (this.equipBlockLimbs) this.closeEquipBlock();
      const gag = this.shiftEquipVis() === 'gag';
      this.closeEquipBlock(); // release the sync flag if that was the last one
      return gag;
    }
    if (isEquipHeldLine(stripped)) {
      const limb = stripped.slice(0, stripped.indexOf(':'));
      if (this.equipBlockLimbs?.has(limb)) {
        // eq lists each limb once — a repeat means a new reply started
        this.closeEquipBlock();
      }
      if (!this.equipBlockLimbs) {
        this.equipBlockLimbs = new Set();
        this.equipBlockGagged = this.shiftEquipVis() === 'gag';
      }
      this.equipBlockLimbs.add(limb);
      this.armEquipBlockTimer();
      return this.equipBlockGagged;
    }
    // Foreign line — replies are contiguous, so it ends any open block
    if (this.equipBlockLimbs) this.closeEquipBlock();
    return false;
  }

  /**
   * Begin sync gagging for login command responses.
   * Only specific patterns (hp, score, alloc, magic) are suppressed.
   * All other MUD output passes through immediately.
   */
  startSync(): void {
    this.syncActive = true;
    this.syncGags = {
      hp: true,
      score: true,
      combatAlloc: true,
      magicAlloc: true,
      alignment: true,
      who: true,
      equip: true,
    };
    this.syncInScoreBlock = false;
    this.syncAllocPending = false;
    this.syncAllocHasData = false;
    this.syncMagicPending = false;
    // The caller sends LOGIN_COMMANDS (which include one `equip held`)
    // immediately after — tag that send as app-initiated.
    this.equipExpectGaggedAt = Date.now();
    this.resetWhoState();
    this.startSyncTimer(5000);
  }

  /**
   * Begin sync gagging for just the `who` command response.
   * Used for periodic background refreshes (not full login sync).
   */
  startWhoSync(): void {
    this.syncActive = true;
    this.syncGags.who = true;
    this.resetWhoState();
    this.startSyncTimer(5000);
  }

  /**
   * Begin a silent `equip held` re-sync — the Loadout panel's background
   * timer, delta auto-verify, and re-sync button. The caller MUST send the
   * equip command immediately after (same tick): this arms a handshake
   * that tags the next observed equip send as app-initiated ('gag').
   * Gagged lines still reach onLine, so the tracker parses them normally.
   */
  startEquipSync(): void {
    this.syncActive = true;
    this.syncGags.equip = true;
    this.equipExpectGaggedAt = Date.now();
    this.startSyncTimer(5000);
  }

  /** End sync gagging. */
  endSync(): void {
    const wasActive = this.syncActive;
    this.syncActive = false;
    this.syncGags = { ...SYNC_GAGS_CLEAR };
    this.syncInScoreBlock = false;
    this.syncAllocPending = false;
    this.syncAllocHasData = false;
    this.syncMagicPending = false;
    this.equipExpectGaggedAt = 0;
    // Drop app-initiated entries — their replies were consumed or lost
    // (safety timeout); a stale 'gag' must never claim a later manual
    // reply. Player entries stay: they default to 'show' anyway.
    this.equipQueue = this.equipQueue.filter((e) => e.vis === 'show');
    this.resetWhoState();
    this.clearSyncTimer();
    if (wasActive) this.onSyncEnd?.();
  }

  /** True while sync is active (some gags still pending). */
  get isSyncing(): boolean {
    return this.syncActive;
  }

  /** Check if all sync gags are consumed and end sync after a short grace period for the trailing prompt. */
  private checkSyncDone(): void {
    const allDone = Object.values(this.syncGags).every((v) => !v);
    if (allDone) {
      // Brief delay so the trailing ">" prompt from the last command gets gagged too
      this.startSyncTimer(250);
    }
  }

  /**
   * Track who list output passively (no gagging).
   * Used for manual `who` typed by the player — updates the panel without suppressing output.
   */
  private trackPassiveWho(stripped: string, raw: string): void {
    if (!this.passiveWhoActive) {
      if (isWhoHeaderLine(stripped)) {
        this.passiveWhoActive = true;
        this.passiveWhoLines = [];
        this.passiveWhoRawLines = [];
      }
      return;
    }

    if (this.accumulateWhoLine(stripped, raw, this.passiveWhoLines, this.passiveWhoRawLines)) {
      this.passiveWhoActive = false;
      this.passiveWhoLines = [];
      this.passiveWhoRawLines = [];
    }
  }

  /**
   * Check if a line should be gagged as part of a sync command response.
   * Returns true if the line should be suppressed.
   */
  private shouldSyncGag(stripped: string, raw: string, healthMatch: HealthMatch | null): boolean {
    if (!this.syncActive) return false;

    // Bare prompt lines ("> " → empty after stripping) between sync command responses
    if (stripped === '') {
      return true;
    }

    // HP response — single health line
    if (this.syncGags.hp && healthMatch) {
      this.syncGags.hp = false;
      this.checkSyncDone();
      return true;
    }

    // Score block — multi-line
    if (this.syncGags.score) {
      if (isScoreBlockLine(stripped)) {
        this.syncInScoreBlock = true;
        // Aura is the last line of the score block
        if (/^Aura\s*:/i.test(stripped)) {
          this.syncGags.score = false;
          this.syncInScoreBlock = false;
          this.checkSyncDone();
        }
        return true;
      }
      // Empty line while in score block — could be separator
      if (this.syncInScoreBlock && stripped === '') {
        return true;
      }
      // Non-matching line while in score block — block ended
      if (this.syncInScoreBlock) {
        this.syncInScoreBlock = false;
        this.syncGags.score = false;
        this.checkSyncDone();
        // Don't gag this non-score line
      }
    }

    // Combat alloc block — multi-line (limb headers + values)
    if (this.syncGags.combatAlloc) {
      // Limb header (exclude magic header — it matches the generic limb pattern too)
      if (SYNC_LIMB_HEADER_RE.test(stripped) && !SYNC_MAGIC_HEADER_RE.test(stripped)) {
        this.syncAllocPending = true;
        return true;
      }
      // Values line after header
      if (this.syncAllocPending && SYNC_ALLOC_VALUES_RE.test(stripped)) {
        this.syncAllocPending = false;
        this.syncAllocHasData = true;
        return true;
      }
      // Empty line between limb entries
      if (this.syncAllocHasData && !this.syncAllocPending && stripped === '') {
        return true;
      }
      // Non-matching line after we have data and no pending header → alloc block done
      if (this.syncAllocHasData && !this.syncAllocPending && stripped !== '') {
        // Check if this is the magic header (next command) — if so, alloc is done
        if (SYNC_MAGIC_HEADER_RE.test(stripped)) {
          this.syncGags.combatAlloc = false;
          this.syncAllocHasData = false;
          // Fall through to magic check below
        }
        // Otherwise, if the line doesn't match alloc patterns, alloc block is done
        else if (!SYNC_LIMB_HEADER_RE.test(stripped)) {
          this.syncGags.combatAlloc = false;
          this.syncAllocHasData = false;
          this.checkSyncDone();
          // Don't gag this line
        }
      }
    }

    // Magic alloc block — 2 lines (header + values)
    if (this.syncGags.magicAlloc) {
      if (SYNC_MAGIC_HEADER_RE.test(stripped)) {
        this.syncMagicPending = true;
        // Also mark combatAlloc as done if it was still expected
        if (this.syncGags.combatAlloc) {
          this.syncGags.combatAlloc = false;
          this.syncAllocPending = false;
          this.syncAllocHasData = false;
        }
        return true;
      }
      if (this.syncMagicPending && SYNC_MAGIC_VALUES_RE.test(stripped)) {
        this.syncMagicPending = false;
        this.syncGags.magicAlloc = false;
        this.checkSyncDone();
        return true;
      }
    }

    // Alignment response — single line
    if (this.syncGags.alignment && matchAlignmentLine(stripped)) {
      this.syncGags.alignment = false;
      this.checkSyncDone();
      return true;
    }

    // Who list block — multi-line (header → player rows → footer)
    if (this.syncGags.who) {
      if (!this.syncInWhoBlock && isWhoHeaderLine(stripped)) {
        this.syncInWhoBlock = true;
        this.syncWhoLines = [];
        this.syncWhoRawLines = [];
        return true;
      }
      if (this.syncInWhoBlock) {
        if (this.accumulateWhoLine(stripped, raw, this.syncWhoLines, this.syncWhoRawLines)) {
          this.syncInWhoBlock = false;
          this.syncWhoLines = [];
          this.syncGags.who = false;
          this.checkSyncDone();
        }
        return true;
      }
    }

    // Equip replies are NOT handled here — the always-on attribution
    // tracker (trackEquipLine) runs before this and claims them, keyed by
    // the queued send order rather than sync state. `syncGags.equip` only
    // marks that an app-initiated reply is still outstanding, so login /
    // background syncs end at the right moment (see closeEquipBlock).
    return false;
  }

  /**
   * Filter a chunk of raw MUD data. Returns the data with status
   * lines removed. Fires callbacks for any matches.
   */
  filter(data: string): string {
    this.buffer += data;

    // Extract complete lines (preserving original line endings).
    // Uses an index cursor to avoid O(n²) substring copies.
    const segments: string[] = [];
    let start = 0;
    const buf = this.buffer;
    while (true) {
      const idx = buf.indexOf('\n', start);
      if (idx < 0) break;
      segments.push(buf.substring(start, idx + 1));
      start = idx + 1;
    }
    this.buffer = buf.substring(start);

    let output = '';

    for (const segment of segments) {
      // Strip embedded server prompt prefix ("> ") from content lines.
      // When prompt + response arrive in the same TCP chunk, the prompt
      // gets prepended to the next response line, e.g. "> There is no exit."
      let seg = segment;
      const rawStripped = stripAnsi(segment);
      if (this.stripPrompts && /^> \S/.test(rawStripped)) {
        seg = segment.replace(/^((?:\x1b\[[0-9;]*m)*)> /, '$1');
      }

      // Reuse rawStripped when segment wasn't modified; otherwise re-strip
      const strippedFull = seg === segment ? rawStripped : stripAnsi(seg);

      // Automapper feed — untrimmed (leading whitespace is significant in hex art)
      this.callbacks.onMapLine?.(strippedFull.replace(/[\r\n]+$/, ''), seg);

      let stripped = strippedFull.trim();
      // Always strip server prompt prefix for parsing, even when display keeps it.
      // Without this, "> upper left hand:" won't match limb/magic header regexes.
      // A bare "> " prompt (no content) becomes just ">" after trim — normalize to "".
      if (stripped.startsWith('> ')) {
        stripped = stripped.substring(2);
      } else if (stripped === '>') {
        stripped = '';
      }

      // --- Run matchers and fire callbacks ---
      // Quick pre-check: status lines always start with known prefixes.
      // Skip all 7 matchers (~95% of lines) when the line can't match.
      const maybeStatus =
        stripped.length > 0 &&
        (stripped.charCodeAt(0) ===
          89 /* 'Y' — "You are/have/believe", "Your", "You're", "You fall" */ ||
          stripped.charCodeAt(0) === 78 /* 'N' — "Needs :" */ ||
          stripped.charCodeAt(0) === 65 /* 'A' — "Aura :" */ ||
          stripped.charCodeAt(0) === 69 /* 'E' — "Encumbrance :" */ ||
          stripped.charCodeAt(0) === 67 /* 'C' — "Concentration :" */ ||
          stripped.charCodeAt(0) === 77); /* 'M' — "Movement :" */

      let concMatch: ConcentrationMatch | null = null;
      let needsMatch: ReturnType<typeof matchNeedsLine> = null;
      let auraMatch: AuraMatch | null = null;
      let encumbranceMatch: EncumbranceMatch | null = null;
      let movementMatch: MovementMatch | null = null;
      let healthMatch: HealthMatch | null = null;
      let alignmentMatch: AlignmentMatch | null = null;

      if (maybeStatus) {
        concMatch = matchConcentrationLine(stripped);
        if (concMatch) this.callbacks.onConcentration?.(concMatch);

        needsMatch = matchNeedsLine(stripped);
        if (needsMatch) {
          if (needsMatch.hunger) this.callbacks.onHunger?.(needsMatch.hunger);
          if (needsMatch.thirst) this.callbacks.onThirst?.(needsMatch.thirst);
        }

        auraMatch = matchAuraLine(stripped, seg);
        if (auraMatch) this.callbacks.onAura?.(auraMatch);

        encumbranceMatch = matchEncumbranceLine(stripped);
        if (encumbranceMatch) this.callbacks.onEncumbrance?.(encumbranceMatch);

        movementMatch = matchMovementLine(stripped);
        if (movementMatch) this.callbacks.onMovement?.(movementMatch);

        healthMatch = matchHealthLine(stripped);
        if (healthMatch) this.callbacks.onHealth?.(healthMatch);

        alignmentMatch = matchAlignmentLine(stripped);
        if (alignmentMatch) this.callbacks.onAlignment?.(alignmentMatch);
      }

      // --- Chat detection (observational — never strips) ---
      // Supports multi-line messages: when a say/ask/exclaim wraps across lines,
      // we buffer until the closing quote is found, then match the combined text.
      if (this.chatLineBuffer !== null) {
        this.chatLineBuffer.push(stripped);
        if (stripped.endsWith("'") || this.chatLineBuffer.length > OutputFilter.CHAT_BUFFER_MAX) {
          const combined = this.chatLineBuffer.join(' ');
          const chatMatch = matchChatLine(combined, this.activeCharacter);
          if (chatMatch) {
            chatMatch.raw = combined;
            this.fireChatCallback(chatMatch);
          }
          this.chatLineBuffer = null;
        }
      } else {
        const chatMatch = matchChatLine(stripped, this.activeCharacter);
        if (chatMatch) {
          this.fireChatCallback(chatMatch);
        } else if (isIncompleteChatLine(stripped)) {
          this.chatLineBuffer = [stripped];
        }
      }

      // --- Equip reply attribution (always on) ---
      // Decides per queued equip command whether a reply block is an
      // app-initiated silent re-sync (gagged) or the player's own (shown).
      // Must run on EVERY line: foreign lines close open blocks.
      if (this.trackEquipLine(stripped)) {
        // Fire onLine so the loadout tracker still parses the reply
        this.callbacks.onLine?.(stripped, seg);
        output += '\x1b[0m'; // reset color state so gagged line doesn't bleed
        this.lastLineGagged = true;
        continue;
      }

      // --- Sync gagging (pattern-based, only login command responses) ---
      // Check if this line is a sync response that should be suppressed.
      // Callbacks (onLine, etc.) still fire so parsers always run.
      if (this.syncActive && this.shouldSyncGag(stripped, seg, healthMatch)) {
        // Fire onLine so alloc/magic parsers and triggers still process
        this.callbacks.onLine?.(stripped, seg);
        output += '\x1b[0m'; // reset color state so gagged line doesn't bleed
        this.lastLineGagged = true;
        continue; // suppress only this specific sync response line
      }

      // --- Passive who tracking (manual `who` → updates panel without gagging) ---
      this.trackPassiveWho(stripped, seg);

      // --- Trigger / onLine callback ---
      // Fired BEFORE compact-mode gagging so auto-inscriber/auto-caster
      // always see concentration lines even when they're filtered from display.
      const lineResult = this.callbacks.onLine?.(stripped, seg);

      // --- Compact mode: strip status lines from terminal ---

      if (
        !isScoreBlockLine(stripped) &&
        ((this.filterFlags.concentration && concMatch) ||
          (this.filterFlags.hunger && needsMatch?.hunger) ||
          (this.filterFlags.thirst && needsMatch?.thirst) ||
          (this.filterFlags.aura && auraMatch) ||
          (this.filterFlags.encumbrance && encumbranceMatch) ||
          (this.filterFlags.movement && movementMatch) ||
          (this.filterFlags.alignment && alignmentMatch))
      ) {
        output += '\x1b[0m'; // reset color state so gagged line doesn't bleed
        this.lastLineGagged = true;
        continue;
      }

      // --- Board date transformation ---
      let displaySegment = seg;
      if (this.boardDatesEnabled) {
        const transformed = transformBoardDateLine(stripped, seg);
        if (transformed !== null) displaySegment = transformed;
      }
      // --- onLine replacement (e.g. skill count injection) ---
      if (lineResult?.replacement) {
        displaySegment = lineResult.replacement;
      }
      if (lineResult?.gag) {
        output += '\x1b[0m'; // reset color state so gagged line doesn't bleed
        this.lastLineGagged = true;
        continue; // suppress this line from terminal output
      }

      if (lineResult?.highlight) {
        // Flush any pending anti-spam count before the highlighted line
        if (this.repeatCount > 0) {
          this.clearAntiSpamTimer();
          if (this.shouldEmitRepeat()) output += OutputFilter.antiSpamLine(this.repeatCount + 1);
          this.repeatCount = 0;
        }
        this.prevStrippedLine = stripped;
        // Open the repeat window so this tracked line is forgotten if no
        // identical line follows it before the window lapses.
        if (this.antiSpamEnabled) this.startAntiSpamTimer();
        this.lastLineGagged = false;
        output += `\x1b[${lineResult.highlight}m${displaySegment}\x1b[0m`;
        continue;
      }

      // --- Suppress blank lines left behind by gagged content ---
      if (stripped === '' && this.lastLineGagged) {
        continue;
      }
      // Non-gagged, non-empty line clears the gag-adjacent flag
      if (stripped !== '') {
        this.lastLineGagged = false;
      }

      // --- Anti-spam: collapse identical lines within a sliding window ---
      if (this.antiSpamEnabled && stripped !== '') {
        if (stripped === this.prevStrippedLine) {
          // Match while the window is still open — count it and slide it forward.
          this.repeatCount++;
          this.startAntiSpamTimer();
          if (this.shouldEmitRepeat()) {
            // Threshold reached — collapse this and every later duplicate.
            output += '\x1b[0m'; // reset color state so gagged line doesn't bleed
            continue; // suppress duplicate
          }
          // Below threshold — a few repeats are legitimate, so show this one
          // in full. Once the count reaches the threshold, later copies collapse.
          output += displaySegment;
          continue;
        }
        // Different line — flush any collapsed count
        if (this.repeatCount > 0) {
          this.clearAntiSpamTimer();
          if (this.shouldEmitRepeat()) output += OutputFilter.antiSpamLine(this.repeatCount + 1);
          this.repeatCount = 0;
        }
        // Track this line and open its window; if no repeat arrives before the
        // window lapses, the timer forgets it so a later copy shows fresh.
        this.prevStrippedLine = stripped;
        this.startAntiSpamTimer();
      }

      output += displaySegment;
    }

    // Note: anti-spam count is NOT flushed at chunk boundaries.
    // The count accumulates across filter() calls and flushes when
    // a different line arrives, ensuring a single accurate total.

    // Flush remaining buffer if it looks like a prompt or is empty.
    if (this.buffer) {
      const strippedRemaining = stripAnsi(this.buffer).trim();
      const isLoginPrompt = /^(Name|Password)\s*:$/i.test(strippedRemaining);
      if (strippedRemaining === '' || strippedRemaining.endsWith('>') || isLoginPrompt) {
        if ((this.stripPrompts || this.syncActive) && strippedRemaining === '>') {
          // Preserve ANSI codes (especially color resets) from the stripped prompt
          const ansiCodes = this.buffer.match(/\x1b\[[0-9;]*m/g);
          this.buffer = '';
          if (ansiCodes) output += ansiCodes.join('');
        } else {
          output += this.buffer;
          this.buffer = '';
        }
      }
    }

    return output;
  }

  /** Resolve anonymous sender and fire onChat callback. */
  private fireChatCallback(chatMatch: ChatMessage): void {
    if (chatMatch.sender === 'Unknown' && this.signatureResolver) {
      const resolved = this.signatureResolver(chatMatch.message);
      if (resolved) {
        chatMatch.sender = resolved.playerName;
        chatMatch.message = resolved.message;
      }
    }
    this.callbacks.onChat?.(chatMatch);
  }

  /** Reset buffer state (call on disconnect/reconnect) */
  reset(): void {
    this.buffer = '';
    this.chatLineBuffer = null;
    this.equipQueue = [];
    this.equipExpectGaggedAt = 0;
    this.equipBlockLimbs = null;
    this.equipBlockGagged = false;
    this.clearEquipBlockTimer();
    this.passiveWhoActive = false;
    this.passiveWhoLines = [];
    this.passiveWhoRawLines = [];
    this.lastLineGagged = false;
    this.prevStrippedLine = null;
    this.repeatCount = 0;
    this.clearAntiSpamTimer();
    this.endSync();
  }
}
