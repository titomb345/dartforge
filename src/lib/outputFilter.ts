import { matchConcentrationLine, type ConcentrationMatch } from './concentrationPatterns';
import { matchHealthLine, type HealthMatch } from './healthPatterns';
import { matchNeedsLine, type NeedLevel } from './needsPatterns';
import { matchAuraLine, type AuraMatch } from './auraPatterns';
import { matchEncumbranceLine, type EncumbranceMatch } from './encumbrancePatterns';
import { matchMovementLine, type MovementMatch } from './movementPatterns';
import { matchAlignmentLine, type AlignmentMatch } from './alignmentPatterns';
import { matchChatLine } from './chatPatterns';
import { transformBoardDateLine } from './boardDatePatterns';
import type { ChatMessage } from '../types/chat';
import { stripAnsi } from './ansiUtils';

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
  /** Fired for every complete line with stripped + raw text. Return gag/highlight directives. */
  onLine?: (stripped: string, raw: string) => LineCallbackResult | void;
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
  signatureResolver: ((messageBody: string) => { playerName: string; message: string } | null) | null = null;
  /** When true, convert in-game bulletin board dates to real-world dates. */
  boardDatesEnabled = true;
  /** When true, strip server prompt prefix ("> ") from terminal output. */
  stripPrompts = true;
  /** Callback invoked when sync gagging completes (all login responses consumed). */
  onSyncEnd: (() => void) | null = null;

  /* ---- Sync gag state (pattern-based, NOT blanket suppression) ---- */
  private syncActive = false;
  private syncGags = { hp: false, score: false, combatAlloc: false, magicAlloc: false, alignment: false };
  /** True while inside the multi-line score block during sync. */
  private syncInScoreBlock = false;
  /** True while a limb header was seen, waiting for its values line. */
  private syncAllocPending = false;
  /** True after at least one complete limb has been gagged. */
  private syncAllocHasData = false;
  /** True after "elemental affinity:" header seen, waiting for values. */
  private syncMagicPending = false;
  /** Safety timer to auto-end sync. */
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: OutputFilterCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Begin sync gagging for login command responses.
   * Only specific patterns (hp, score, alloc, magic) are suppressed.
   * All other MUD output passes through immediately.
   */
  startSync(): void {
    this.syncActive = true;
    this.syncGags = { hp: true, score: true, combatAlloc: true, magicAlloc: true, alignment: true };
    this.syncInScoreBlock = false;
    this.syncAllocPending = false;
    this.syncAllocHasData = false;
    this.syncMagicPending = false;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.endSync();
    }, 5000);
  }

  /** End sync gagging. */
  endSync(): void {
    this.syncActive = false;
    this.syncGags = { hp: false, score: false, combatAlloc: false, magicAlloc: false, alignment: false };
    this.syncInScoreBlock = false;
    this.syncAllocPending = false;
    this.syncAllocHasData = false;
    this.syncMagicPending = false;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.onSyncEnd?.();
  }

  /** True while sync is active (some gags still pending). */
  get isSyncing(): boolean {
    return this.syncActive;
  }

  /** Check if all sync gags are consumed and end sync after a short grace period for the trailing prompt. */
  private checkSyncDone(): void {
    if (!this.syncGags.hp && !this.syncGags.score && !this.syncGags.combatAlloc && !this.syncGags.magicAlloc && !this.syncGags.alignment) {
      // Brief delay so the trailing ">" prompt from the last command gets gagged too
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        this.endSync();
      }, 250);
    }
  }

  /**
   * Check if a line should be gagged as part of a sync command response.
   * Returns true if the line should be suppressed.
   */
  private shouldSyncGag(stripped: string, healthMatch: HealthMatch | null): boolean {
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

    return false;
  }

  /**
   * Filter a chunk of raw MUD data. Returns the data with status
   * lines removed. Fires callbacks for any matches.
   */
  filter(data: string): string {
    this.buffer += data;

    // Extract complete lines (preserving original line endings)
    const segments: string[] = [];
    let remaining = this.buffer;

    while (true) {
      const idx = remaining.indexOf('\n');
      if (idx < 0) break;
      segments.push(remaining.substring(0, idx + 1));
      remaining = remaining.substring(idx + 1);
    }

    this.buffer = remaining;

    let output = '';

    for (const segment of segments) {
      // Strip embedded server prompt prefix ("> ") from content lines.
      // When prompt + response arrive in the same TCP chunk, the prompt
      // gets prepended to the next response line, e.g. "> There is no exit."
      let seg = segment;
      if (this.stripPrompts) {
        const rawStripped = stripAnsi(segment);
        if (/^> \S/.test(rawStripped)) {
          seg = segment.replace(/^(?:\x1b\[[0-9;]*m)*> /, '');
        }
      }

      let stripped = stripAnsi(seg).trim();
      // Always strip server prompt prefix for parsing, even when display keeps it.
      // Without this, "> upper left hand:" won't match limb/magic header regexes.
      // A bare "> " prompt (no content) becomes just ">" after trim — normalize to "".
      if (stripped.startsWith('> ')) {
        stripped = stripped.substring(2);
      } else if (stripped === '>') {
        stripped = '';
      }

      // --- Always run matchers and fire callbacks ---

      const concMatch = matchConcentrationLine(stripped);
      if (concMatch) {
        this.callbacks.onConcentration?.(concMatch);
      }

      const needsMatch = matchNeedsLine(stripped);
      if (needsMatch) {
        if (needsMatch.hunger) this.callbacks.onHunger?.(needsMatch.hunger);
        if (needsMatch.thirst) this.callbacks.onThirst?.(needsMatch.thirst);
      }

      const auraMatch = matchAuraLine(stripped);
      if (auraMatch) {
        this.callbacks.onAura?.(auraMatch);
      }

      const encumbranceMatch = matchEncumbranceLine(stripped);
      if (encumbranceMatch) {
        this.callbacks.onEncumbrance?.(encumbranceMatch);
      }

      const movementMatch = matchMovementLine(stripped);
      if (movementMatch) {
        this.callbacks.onMovement?.(movementMatch);
      }

      const healthMatch = matchHealthLine(stripped);
      if (healthMatch) {
        this.callbacks.onHealth?.(healthMatch);
      }

      const alignmentMatch = matchAlignmentLine(stripped);
      if (alignmentMatch) {
        this.callbacks.onAlignment?.(alignmentMatch);
      }

      // --- Chat detection (observational — never strips) ---
      const chatMatch = matchChatLine(stripped, this.activeCharacter);
      if (chatMatch) {
        if (chatMatch.sender === 'Unknown' && this.signatureResolver) {
          const resolved = this.signatureResolver(chatMatch.message);
          if (resolved) {
            chatMatch.sender = resolved.playerName;
            chatMatch.message = resolved.message;
          }
        }
        this.callbacks.onChat?.(chatMatch);
      }

      // --- Sync gagging (pattern-based, only login command responses) ---
      // Check if this line is a sync response that should be suppressed.
      // Callbacks (onLine, etc.) still fire so parsers always run.
      if (this.syncActive && this.shouldSyncGag(stripped, healthMatch)) {
        // Fire onLine so alloc/magic parsers and triggers still process
        this.callbacks.onLine?.(stripped, seg);
        continue; // suppress only this specific sync response line
      }

      // --- Compact mode: strip status lines from terminal ---

      if (
        !isScoreBlockLine(stripped) && (
          (this.filterFlags.concentration && concMatch) ||
          (this.filterFlags.hunger && needsMatch?.hunger) ||
          (this.filterFlags.thirst && needsMatch?.thirst) ||
          (this.filterFlags.aura && auraMatch) ||
          (this.filterFlags.encumbrance && encumbranceMatch) ||
          (this.filterFlags.movement && movementMatch) ||
          (this.filterFlags.alignment && alignmentMatch)
        )
      ) {
        continue;
      }

      // --- Board date transformation ---
      let displaySegment = seg;
      if (this.boardDatesEnabled) {
        const transformed = transformBoardDateLine(stripped, seg);
        if (transformed !== null) displaySegment = transformed;
      }

      // --- Trigger / onLine callback ---
      const lineResult = this.callbacks.onLine?.(stripped, seg);
      if (lineResult?.gag) {
        continue; // suppress this line from terminal output
      }
      if (lineResult?.highlight) {
        output += `\x1b[${lineResult.highlight}m${displaySegment}\x1b[0m`;
        continue;
      }

      output += displaySegment;
    }

    // Flush remaining buffer if it looks like a prompt or is empty.
    if (this.buffer) {
      const strippedRemaining = stripAnsi(this.buffer).trim();
      const isLoginPrompt = /^(Name|Password)\s*:$/i.test(strippedRemaining);
      if (strippedRemaining === '' || strippedRemaining.endsWith('>') || isLoginPrompt) {
        if ((this.stripPrompts || this.syncActive) && strippedRemaining === '>') {
          this.buffer = '';
        } else {
          output += this.buffer;
          this.buffer = '';
        }
      }
    }

    return output;
  }

  /** Reset buffer state (call on disconnect/reconnect) */
  reset(): void {
    this.buffer = '';
    this.endSync();
  }
}
