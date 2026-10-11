/**
 * Server lines the town engine reads directly — everything it learns from
 * output that is not a room block. ONE dispatcher for both the live app
 * (useMapTracker's feedLine) and the replay engine (scripts/lib/townReplay.ts),
 * so the two can never be wired differently. They were: the replay handed
 * teleport, forced-move, pitch-black and "What ?" lines to the engine while
 * the live feed forwarded only portal transits, so every corpus measurement
 * of those fixes described a client nobody ran.
 *
 * Call it with every output line, BEFORE the line reaches the parsers (the
 * hex RoomParser, then the TownParser) — the order the corpus replay is
 * validated with. The order only matters when one of these lines arrives
 * while the TownParser is still collecting a wrapped exits sentence, which
 * never happened in either corpus (0 of 2,086 DF and 0 of 63,229 MUSH such
 * lines).
 *
 *   PORTAL_TRANSIT_RE   → onPortalTransit   ("You step into the north portal.")
 *   TELEPORT_TRANSIT_RE → onTeleport        (plane shift, temple pools)
 *   TOWN_FORCED_MOVE_RE → onForcedMove      ("Esira leads you up.")
 *   TOWN_DARK_RE        → onDarkArrival     ("It is pitch black.")
 *   UNKNOWN_COMMAND_RE  → onUnknownCommand  ("What ?" / "<Verb> what?",
 *                                            which fail dead named moves)
 *
 * The returned events tell the caller what the engine did with the line —
 * the live walk executor reacts to them (a transit or a forced move ends a
 * walk; a dark step is confirmed or ends it), the replay counts them.
 */

import type { DarkArrival, TownLocalizer } from './townLocalizer';
import {
  PORTAL_TRANSIT_RE,
  TELEPORT_TRANSIT_RE,
  TOWN_DARK_RE,
  TOWN_FORCED_MOVE_RE,
  UNKNOWN_COMMAND_RE,
} from './townParser';

export type TownLineEvent =
  /** A portal transit: the next room block is a fresh entry. `dirWord`
   *  names the portal ("north"; null on the spoke side) */
  | { kind: 'portal'; dirWord: string | null }
  /** A messaged teleport (plane shift, temple pool) */
  | { kind: 'teleport' }
  /** A group leader moved the player; `queued`: the town engine took the
   *  move (only while indoors) */
  | { kind: 'forced-move'; move: string; queued: boolean }
  /** "It is pitch black." in place of a room block. `wasActive`: the town
   *  engine was tracking a room when it arrived; `result`: what the line
   *  did to the position (see TownLocalizer.onDarkArrival) */
  | { kind: 'dark'; wasActive: boolean; result: DarkArrival }
  /** "What ?" (`verb` null) or "<Verb> what?"; `failed`: the reply failed a
   *  queued move */
  | { kind: 'unknown-command'; verb: string | null; failed: boolean };

/**
 * Hand one output line to the town engine. Returns the events it produced,
 * in the order the engine saw them (usually none).
 */
export function dispatchTownLine(
  line: string,
  localizer: TownLocalizer,
  now: number
): TownLineEvent[] {
  const events: TownLineEvent[] = [];
  const portal = PORTAL_TRANSIT_RE.exec(line);
  if (portal) {
    const dirWord = portal[1] ?? null;
    localizer.onPortalTransit(dirWord);
    events.push({ kind: 'portal', dirWord });
  }
  if (TELEPORT_TRANSIT_RE.test(line)) {
    localizer.onTeleport();
    events.push({ kind: 'teleport' });
  }
  const forced = TOWN_FORCED_MOVE_RE.exec(line);
  if (forced) {
    const queued = localizer.onForcedMove(forced[1], now);
    events.push({ kind: 'forced-move', move: forced[1], queued });
  }
  if (TOWN_DARK_RE.test(line)) {
    const wasActive = localizer.active;
    const result = localizer.onDarkArrival(now);
    events.push({ kind: 'dark', wasActive, result });
  }
  const unknown = UNKNOWN_COMMAND_RE.exec(line);
  if (unknown) {
    const verb = unknown[1] ?? null;
    const failed = localizer.onUnknownCommand(verb);
    events.push({ kind: 'unknown-command', verb, failed });
  }
  return events;
}
