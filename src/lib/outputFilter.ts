import { matchConcentrationLine, type ConcentrationMatch } from './concentrationPatterns';
import { matchHealthLine, type HealthMatch } from './healthPatterns';
import { matchNeedsLine, type NeedLevel } from './needsPatterns';
import { matchAuraLine, type AuraMatch } from './auraPatterns';
import { matchEncumbranceLine, type EncumbranceMatch } from './encumbrancePatterns';
import { matchMovementLine, type MovementMatch } from './movementPatterns';
import { matchChatLine } from './chatPatterns';
import type { ChatMessage } from '../types/chat';
import { stripAnsi } from './ansiUtils';

/** Pre-compiled regexes for score block detection (avoid recompiling on every call) */
const SCORE_NAME_RE = /^You are .+ the .+\.\s+You are a /;
const SCORE_STATUS_RE = /^(Needs|Encumbrance|Concentration|Movement|Aura)\s*:/i;

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
}

export const DEFAULT_FILTER_FLAGS: FilterFlags = {
  concentration: false,
  hunger: false,
  thirst: false,
  aura: false,
  encumbrance: false,
  movement: false,
};

/**
 * Line-buffered output filter that removes tracked status messages from
 * raw MUD output before it reaches the terminal. Fires callbacks when
 * status changes are detected.
 */
export class OutputFilter {
  private buffer = '';
  private callbacks: OutputFilterCallbacks;
  /**
   * Number of sync-command responses still expected.
   * While > 0, recognized status lines, score-block lines, and prompts
   * are suppressed from terminal output. Callbacks still fire.
   * Each server prompt ("> ") decrements the counter.
   */
  private syncRemaining = 0;
  /** Per-status filter flags — when true, matching messages are stripped from terminal. */
  filterFlags: FilterFlags = { ...DEFAULT_FILTER_FLAGS };
  /** Active character name for own-message detection in chat matching. */
  activeCharacter: string | null = null;
  /** Optional resolver for anonymous tell/SZ signatures → player names. */
  signatureResolver: ((messageBody: string) => { playerName: string; message: string } | null) | null = null;

  constructor(callbacks: OutputFilterCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Begin suppressing output for the next N sync commands.
   * Each server prompt ("> ") decrements the counter.
   * While syncing, recognized status/score lines are hidden but callbacks fire.
   */
  startSync(commandCount: number): void {
    this.syncRemaining = commandCount;
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
      const stripped = stripAnsi(segment).trim();

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

      // --- Sync suppression (login/reconnect auto-send) ---

      if (this.syncRemaining > 0) {
        if (
          healthMatch ||
          concMatch ||
          needsMatch ||
          auraMatch ||
          encumbranceMatch ||
          movementMatch ||
          isScoreBlockLine(stripped)
        ) {
          continue; // suppress — callback already fired above
        }

        // Suppress bare prompt lines ("> " on its own line)
        if (stripped === '>' || stripped === '> ') {
          this.syncRemaining--;
          continue;
        }

        // Unrecognized non-empty line during sync — let it through
        // (game events that happen to interleave with sync output)
      }

      // --- Compact mode: strip status lines from terminal ---

      if (
        !isScoreBlockLine(stripped) && (
          (this.filterFlags.concentration && concMatch) ||
          (this.filterFlags.hunger && needsMatch?.hunger) ||
          (this.filterFlags.thirst && needsMatch?.thirst) ||
          (this.filterFlags.aura && auraMatch) ||
          (this.filterFlags.encumbrance && encumbranceMatch) ||
          (this.filterFlags.movement && movementMatch)
        )
      ) {
        continue;
      }

      // --- Trigger / onLine callback ---
      const lineResult = this.callbacks.onLine?.(stripped, segment);
      if (lineResult?.gag) {
        continue; // suppress this line from terminal output
      }
      if (lineResult?.highlight) {
        output += `\x1b[${lineResult.highlight}m${segment}\x1b[0m`;
        continue;
      }

      output += segment;
    }

    // Flush remaining buffer if it looks like a prompt or is empty.
    // Prompts don't end with newlines — they wait for input. Covers:
    //   ">"  / "> "   (game prompt)
    //   "Name:"       (login prompt)
    //   "Password:"   (login prompt)
    if (this.buffer) {
      const strippedRemaining = stripAnsi(this.buffer).trim();
      if (strippedRemaining === '' || strippedRemaining.endsWith('>') || strippedRemaining.endsWith(':')) {
        if (this.syncRemaining > 0 && strippedRemaining.endsWith('>')) {
          // Suppress the prompt and decrement sync counter
          this.syncRemaining--;
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
    this.syncRemaining = 0;
  }
}
