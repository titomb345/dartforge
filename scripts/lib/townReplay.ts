/**
 * Live-faithful replay engine for the town mapper — the part of
 * replay-town.ts and replay-town-file.ts that decides WHAT the live app
 * would have seen and done. The tools only add metrics or tracing through
 * the hooks.
 *
 * It mirrors the live useMapTracker wiring through the REAL production code:
 *
 *   TownParser → TownLocalizer → TownMapStore      (towns)
 *   RoomParser → HexLocalizer  → HexMapStore       (wilderness, anchors)
 *
 * plus the server lines the town engine reads directly (portal and
 * teleport transits, forced moves, "It is pitch black.", "What ?"), handed
 * over by src/lib/townLineEvents.ts — the SAME dispatcher the live feedLine
 * calls, in the same place (before the hex parser, then the town parser) —
 * and at every login line (useMudConnection's onCharacterName / onLogin:
 * "Running under version" / "reconnecting to old object"), before the login
 * burst, TownLocalizer.onLogin on the localizer that resolves the burst —
 * after a character switch, the new character's (live: noteLogin, held with
 * the burst until the new map has loaded).
 *
 * Fidelity rules, each a replay artifact that once posed as an engine bug:
 *  - Log timestamps drive the localizer clock (continuity gaps, queue
 *    expiry). Each session log is one app run: between files the stores
 *    round-trip serialize → deserialize (load-time cleanses included) and
 *    the localizers start fresh.
 *  - What live TRACKED: a log written since Oct 2026 records every command
 *    as it was sent (`>> [sent] lead n` — src/lib/sessionLog.ts), the walk's
 *    steps and door sequences, trigger and timer sends and the login sync
 *    included; those lines are tracked as they stand and the typed `>> input`
 *    lines are not. An older log has only the typed input: it goes through
 *    the real alias engine (replayInput.ts), with the active character's
 *    aliases first, then the global ones (today's aliases, Leading mode not
 *    applied, walks invisible — see the harness's known gaps).
 *  - TCP fragments are rejoined (rejoin.ts): live, OutputFilter buffers to
 *    the newline. A log written since Oct 2026 has whole lines (the logger
 *    cuts the stream by the OutputFilter's own rule) and blank lines; it is
 *    read as it stands.
 *  - The pager's prompt (PAGER_PROMPT) never reaches the parsers live: it
 *    ends a read with no newline and goes to the screen only (see
 *    partialLine.ts). The loggers wrote it as a line of its own, and a
 *    MUSHclient log glues the next page's first line onto it; the replay
 *    drops it.
 *  - PER-CHARACTER STORES (default): live keeps map-<char>.json (hex +
 *    town) per character and swaps both at login (useMudConnection fires
 *    onCharacterName on "Running under version" / "reconnecting to old
 *    object"; useMapTracker loads the file and makes fresh localizers). One
 *    shared store let Trilok's Soriktos position swallow Mazorn's next
 *    login (session_2026-08-17T16-59-49-147.log:4114: the keep Bedchamber
 *    filed as a floater INTO Soriktos, later merged — Soriktos ended up
 *    inside Eris at z=1..7). A same-character re-login resets nothing.
 *    Only MAZORN's numbers are live-faithful: a new character's replay
 *    store starts empty, but live map-trilok.json was hand-copied from
 *    Mazorn's map (Bill, 2026-10-02; the copy dates between Aug 16 23:01
 *    and Aug 17 16:08), so Trilok's rooms and his share of the ground-truth
 *    and link numbers describe a map the live app never had.
 *  - switchLate models the login race of the app BEFORE Oct 2026 (the
 *    login hold, mapSession.ts, closed it: today the stores switch at the
 *    login line, like the default mode): when the name was TYPED at the
 *    Name: prompt, onCharacterName → setActiveCharacter awaited a settings
 *    write and the map load was async, while the login chunk was filtered
 *    synchronously — the burst's first room block / survey landed in the
 *    PREVIOUS character's stores (and was saved there by the effect
 *    cleanup). Only typed logins are deferred (the verified scope), so the
 *    mode was a LOWER bound of that race: the character-switch button
 *    swapped stores before reconnecting (PR #77), but an AUTO-login raced
 *    the same way whenever App.tsx's auto-login slot
 *    (autoLoginCharacters[autoLoginActiveSlot]) was not the active character
 *    (session_2026-08-17T02-35-53-777.log:664, trilok → mazorn right after
 *    a typed trilok login; deferring that one too added 17 new rooms and 7
 *    true duplicates, Eris 27 → 34, on the stage-1 engine).
 */
import * as fs from 'fs';
import * as path from 'path';
import { RoomParser } from '../../src/lib/roomParser';
import { HexLocalizer } from '../../src/lib/hexLocalizer';
import { HexMapStore } from '../../src/lib/hexMap';
import { dispatchTownLine } from '../../src/lib/townLineEvents';
import { TownParser, type TownRoomBlock } from '../../src/lib/townParser';
import { TownLocalizer, type DarkArrival, type TownResolution } from '../../src/lib/townLocalizer';
import { TownMapStore, hexAnchorKey, type Town, type TownRoom } from '../../src/lib/townMap';
import {
  isMarkedLog,
  liveLines,
  loggedCommand,
  loginInfos,
  parserText,
  readSessionLog,
  type LoginInfo,
  type SessionLine,
} from './replayCorpus';
import { EXITS_START_RE, NO_EXITS_RE } from './serverLines';

/** Fallback for a late switch whose login burst never shows a room */
const LATE_SWITCH_MAX_MS = 30_000;

export interface ReplayOptions {
  /** Raw logged input → the commands live sent, for the active character
   *  (replayInput.makeCharExpander; null before the first identified login) */
  expand: (raw: string, char: string | null) => string[];
  /** One map store per character, swapped at logins (default true) */
  perChar?: boolean;
  /** Model the pre-hold login race for typed-name logins (default false) */
  switchLate?: boolean;
  /** Rejoin logger-split lines (default true) */
  rejoin?: boolean;
  /** Round-trip the stores between session files like an app restart (default true) */
  restart?: boolean;
}

export interface BlockEvent {
  block: TownRoomBlock;
  res: TownResolution;
  /** The room the player was in before the block resolved */
  before: TownRoom | undefined;
  /** Town ids before the block (new towns = the rest) */
  townsBefore: Set<number>;
  /** Room count per town before the block */
  sizeBefore: Map<number, number>;
  wasActive: boolean;
  /** First room block after a login line */
  afterLogin: boolean;
}

export interface SwitchEvent {
  from: string | null;
  to: string;
  login: LoginInfo;
  /** Applied after the burst's first room/survey (switchLate) */
  late: boolean;
  /** `to` had no persisted stores: it starts with an empty map */
  fresh: boolean;
}

/** Stores in the live map-<char>.json format */
export interface MapFile {
  mapData: unknown;
  townData: unknown;
}

/** load() / snapshot() format: the live character's map file, plus every
 *  other character's persisted stores so a replay can resume mid-corpus */
export interface Snapshot extends MapFile {
  character: string | null;
  characters?: Record<string, MapFile>;
}

/**
 * The rooms a structural merge COPIED into its target town (provenance for
 * --tag-origins). mergeTowns allocates the copies' ids last, one per copy,
 * so they are the target's `placed` newest ids. A room the same block
 * filed in the target before the probe merged is older: it keeps its own
 * origin (counting every id past the block's start tagged it as a merge
 * copy). A same-town merge copies nothing; it re-places the duplicate
 * component's own rooms.
 */
export function mergeCopyIds(
  map: TownMapStore,
  merged: NonNullable<TownResolution['merged']>
): number[] {
  const into = map.get(merged.into);
  if (!into || merged.from === merged.into) return [];
  const first = into.nextRoomId - merged.placed;
  return [...into.rooms.keys()].filter((id) => id >= first).sort((a, b) => a - b);
}

/** The character a live map file belongs to — only its NAME says so
 *  (useMapTracker saves map-<character>.json; the content has no owner).
 *  A prefixed copy counts too ("live-map-mazorn.json"). */
export function mapFileOwner(file: string): string | null {
  const m = /(?:^|[-_. ])map-([a-z]+)\.json$/i.exec(path.basename(file));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Grid integrity of one town, for the layout gate. `sharedCells` counts the
 * rooms beyond the first on any (x,y,z) cell; `gridErrors` counts the index
 * entries that disagree with the rooms (a key naming a missing room or a
 * room standing elsewhere, and a room its own cell does not name). Both
 * are 0 on a sound map, and no localization count sees either: with the
 * stretch looking for the occupant on floor 0 whatever the arrival's floor,
 * the frozen-corpus replay printed the same numbers (one stretch fewer)
 * while its end state held two rooms in one cell.
 */
export function gridAudit(town: Town): { sharedCells: number; gridErrors: number } {
  // town.grid's key format (townMap.ts gridKey)
  const cellOf = (r: TownRoom) => `${r.x},${r.y},${r.z}`;
  const perCell = new Map<string, number>();
  for (const r of town.rooms.values()) perCell.set(cellOf(r), (perCell.get(cellOf(r)) ?? 0) + 1);
  let sharedCells = 0;
  for (const count of perCell.values()) sharedCells += count - 1;
  let gridErrors = 0;
  for (const [key, id] of town.grid) {
    const r = town.rooms.get(id);
    if (!r || cellOf(r) !== key) gridErrors++;
  }
  for (const r of town.rooms.values()) if (town.grid.get(cellOf(r)) !== r.id) gridErrors++;
  return { sharedCells, gridErrors };
}

export interface ReplayHooks {
  /** Before the localizer resolves a block (e.g. to look at entry candidates) */
  beforeBlock?(block: TownRoomBlock): void;
  onBlock?(ev: BlockEvent): void;
  /**
   * A logged command line. Older logs: `raw` is the typed input and `sent`
   * its alias expansion. Logs with sent lines (`>> [sent] cmd`): a sent
   * line comes as raw = cmd, sent = [cmd]; a typed line as sent = [] with
   * `typed` true (its sends are the sent lines after it).
   */
  onCommand?(raw: string, sent: string[], tracked: number, typed?: boolean): void;
  onPortal?(dirWord: string | null): void;
  /** A plane shift / temple pool transit line */
  onTeleport?(): void;
  /** "<Leader> leads you <move>." — `queued`: the town engine took it */
  onForcedMove?(move: string, queued: boolean): void;
  /** "It is pitch black." in place of a room block */
  onDarkArrival?(result: DarkArrival): void;
  /** A "What ?" / "<Verb> what?" reply (`verb` null for "What ?"); `failed`:
   *  it failed a queued move */
  onUnknownCommand?(verb: string | null, failed: boolean): void;
  onSurvey?(): void;
  onMoveFailed?(inTown: boolean): void;
  /** An exits line (1-based `line`) produced no room block */
  onLostBlock?(line: number, text: string, context: string[]): void;
  onLogin?(login: LoginInfo, switching: boolean): void;
  onSwitch?(ev: SwitchEvent): void;
  /** The live stores were replaced (restart, character switch) */
  onStoresChanged?(): void;
}

interface Counters {
  linkMisses: number;
  linkHeals: number;
  nudges: number;
  stretches: number;
}
const zero = (): Counters => ({ linkMisses: 0, linkHeals: 0, nudges: 0, stretches: 0 });

interface LateSwitch {
  login: LoginInfo;
  char: string;
  /** Clock time after which the switch lands even without a room/survey */
  deadline: number;
}

export interface CharacterStore {
  town: TownMapStore;
  hex: HexMapStore;
}

export class TownReplay {
  hexMap = new HexMapStore();
  hexLocalizer = new HexLocalizer(this.hexMap);
  townMap = new TownMapStore();
  townLocalizer = new TownLocalizer(this.townMap);
  clock = 1_000_000;
  /** Basename of the file being replayed and the 1-based line being processed */
  file = '';
  line = 0;
  /** Character whose stores are live (null until the first identified login) */
  char: string | null = null;
  /** --single-store: the character of the latest identified login (aliases) */
  private loginChar: string | null = null;

  readonly stats = {
    files: 0,
    /** Files whose log records every command as sent (`>> [sent] cmd`) */
    markedFiles: 0,
    lines: 0,
    exitsLines: 0,
    blocks: 0,
    /** Exits lines that produced no room block */
    lostBlocks: 0,
    /** "There are no obvious exits." lines (rooms without exits; exitsLines
     *  counts them too) */
    noExitsRooms: 0,
    rejoins: 0,
    cmdTracked: 0,
    moveFails: 0,
    /** Queued moves failed by a "What ?" / "<Verb> what?" reply */
    replyFails: 0,
    merges: 0,
    portals: 0,
    /** Plane shift / temple pool transit lines */
    teleports: 0,
    /** Forced moves the town engine queued (indoors) */
    forcedMoves: 0,
    /** "It is pitch black." lines while the town engine was active */
    darkArrivals: 0,
    logins: 0,
    loginsTyped: 0,
    loginsUnidentified: 0,
    switches: 0,
    lateSwitches: 0,
  };
  readonly kinds: Record<string, number> = {};
  readonly kindsByChar: Record<string, Record<string, number>> = {};
  readonly switchLog: string[] = [];

  private readonly opts: Required<ReplayOptions>;
  /** Persisted stores of characters that are not live (JSON, like map-<char>.json) */
  private readonly saved = new Map<string, string>();
  /** Their in-memory stores as they were at the switch (end-state reporting) */
  private readonly retired = new Map<string, CharacterStore>();
  /** Counters of retired localizer/store instances */
  private readonly acc: Counters = zero();
  private readonly accByChar = new Map<string, Counters>();
  private firstFile = true;

  constructor(
    opts: ReplayOptions,
    private readonly hooks: ReplayHooks = {}
  ) {
    this.opts = { perChar: true, switchLate: false, rejoin: true, restart: true, ...opts };
  }

  /** The live activeCharacter (whose aliases expand the input): the store
   *  owner, which in switchLate mode changes only when the late switch lands */
  get activeChar(): string | null {
    return this.opts.perChar ? this.char : this.loginChar;
  }

  /** Hex anchor the town engine receives (null while the hex localizer is lost) */
  currentAnchor(): string | null {
    const pos = this.hexMap.pos;
    if (!pos || this.hexLocalizer.lost) return null;
    return hexAnchorKey(pos.island, pos.q, pos.r);
  }

  /** Start from a saved store: a replay-town.ts --snapshot-out file (every
   *  character's stores), a live map-<char>.json, a replay-town --out store
   *  or a bare TownMapStore.serialize() object. `owner` names the character
   *  of a file that does not say (a live map file: mapFileOwner); with
   *  neither, the first identified login adopts the stores. */
  load(data: unknown, owner: string | null = null): void {
    const d = data as Partial<Snapshot> | null;
    if (owner !== null) this.char = this.loginChar = owner;
    if (d && typeof d === 'object' && 'townData' in d) {
      this.townMap = TownMapStore.deserialize(d.townData);
      if (d.mapData) this.hexMap = HexMapStore.deserialize(d.mapData);
      if (typeof d.character === 'string') this.char = this.loginChar = d.character;
      for (const [c, s] of Object.entries(d.characters ?? {})) {
        if (c === this.char) continue;
        this.saved.set(c, JSON.stringify({ town: s.townData, hex: s.mapData ?? null }));
        this.retired.set(c, this.restore(c)!);
      }
    } else {
      this.townMap = TownMapStore.deserialize(data);
    }
    this.freshLocalizers();
  }

  /** The live character's stores in the live map-file format, plus every
   *  other character's persisted stores (load() takes it back) */
  snapshot(): Snapshot {
    const characters: Record<string, MapFile> = {};
    for (const [c, json] of this.saved) {
      if (c === (this.char ?? 'unknown')) continue; // stale: that character is live
      const s = JSON.parse(json) as { town: unknown; hex: unknown };
      characters[c] = { mapData: s.hex, townData: s.town };
    }
    return {
      character: this.char,
      mapData: this.hexMap.serialize(),
      townData: this.townMap.serialize(),
      characters,
    };
  }

  /** Link misses / heals / nudges / stretches so far (all instances) */
  totals(char?: string): Counters {
    const base = char === undefined ? this.acc : (this.accByChar.get(char) ?? zero());
    const live =
      char === undefined || char === (this.char ?? 'unknown') ? this.liveCounters() : zero();
    return {
      linkMisses: base.linkMisses + live.linkMisses,
      linkHeals: base.linkHeals + live.linkHeals,
      nudges: base.nudges + live.nudges,
      stretches: base.stretches + live.stretches,
    };
  }

  /** End state per character: the live stores plus every retired character's */
  stores(): Map<string, CharacterStore> {
    const out = new Map<string, CharacterStore>();
    out.set(this.char ?? 'unknown', { town: this.townMap, hex: this.hexMap });
    for (const [c, s] of this.retired) if (c !== (this.char ?? 'unknown')) out.set(c, s);
    return out;
  }

  // -------------------------------------------------------------------------
  // Store lifecycle
  // -------------------------------------------------------------------------

  private liveCounters(): Counters {
    return {
      linkMisses: this.townLocalizer.linkMisses,
      linkHeals: this.townLocalizer.linkHeals,
      nudges: this.townMap.nudges,
      stretches: this.townMap.stretches,
    };
  }

  /** Bank the live instances' counters before they are replaced */
  private retireCounters(): void {
    const c = this.liveCounters();
    const key = this.char ?? 'unknown';
    const byChar = this.accByChar.get(key) ?? zero();
    for (const k of Object.keys(c) as (keyof Counters)[]) {
      this.acc[k] += c[k];
      byChar[k] += c[k];
    }
    this.accByChar.set(key, byChar);
  }

  private freshLocalizers(): void {
    this.townLocalizer = new TownLocalizer(this.townMap);
    this.hexLocalizer = new HexLocalizer(this.hexMap);
    this.hooks.onStoresChanged?.();
  }

  /** App restart: persist + reload the live character's stores, fresh localizers */
  restart(): void {
    this.retireCounters();
    this.townMap = TownMapStore.deserialize(JSON.parse(JSON.stringify(this.townMap.serialize())));
    this.hexMap = HexMapStore.deserialize(JSON.parse(JSON.stringify(this.hexMap.serialize())));
    this.freshLocalizers();
  }

  /** A character's persisted stores, loaded like map-<char>.json (undefined: none yet) */
  private restore(char: string): CharacterStore | undefined {
    const json = this.saved.get(char);
    if (!json) return undefined;
    const data = JSON.parse(json) as { town: unknown; hex: unknown };
    return {
      town: TownMapStore.deserialize(data.town),
      hex: data.hex ? HexMapStore.deserialize(data.hex) : new HexMapStore(),
    };
  }

  /** Swap to another character's stores (live: map-<char>.json) */
  private switchTo(next: string, login: LoginInfo, late: boolean): void {
    const from = this.char;
    this.retireCounters();
    const key = from ?? 'unknown';
    this.saved.set(
      key,
      JSON.stringify({ town: this.townMap.serialize(), hex: this.hexMap.serialize() })
    );
    this.retired.set(key, { town: this.townMap, hex: this.hexMap });
    const restored = this.restore(next);
    this.townMap = restored?.town ?? new TownMapStore();
    this.hexMap = restored?.hex ?? new HexMapStore();
    this.retired.delete(next);
    this.char = next;
    this.stats.switches++;
    if (late) this.stats.lateSwitches++;
    this.switchLog.push(
      `${this.file}:${login.index + 1} ${from ?? '?'} -> ${next}${login.typed ? ' (typed)' : ''}${late ? ` (late, at :${this.line})` : ''}${restored ? '' : ' (new map)'}`
    );
    this.freshLocalizers();
    this.hooks.onSwitch?.({ from, to: next, login, late, fresh: !restored });
  }

  // -------------------------------------------------------------------------
  // Replay
  // -------------------------------------------------------------------------

  /**
   * Replay one log as one app run. `mush` = a MUSHclient log (no stamps, no
   * commands, line-intact): parser validation only, no character handling.
   */
  replayLog(filePath: string, mush = false): void {
    this.stats.files++;
    if (!this.firstFile && !mush && this.opts.restart) this.restart();
    this.firstFile = false;
    this.file = path.basename(filePath);

    let lines: (SessionLine | null)[];
    /** The log records every command as sent (see the module comment) */
    let marked = false;
    if (mush) {
      lines = fs
        .readFileSync(filePath, 'latin1')
        .split('\n')
        .map((l) => ({ text: l.replace(/\r$/, ''), t: null }));
    } else {
      const logged = readSessionLog(filePath);
      marked = isMarkedLog(logged.map((l) => l.text));
      if (marked) this.stats.markedFiles++;
      // (A marked log's lines are whole: nothing to rejoin)
      const live = liveLines(logged, this.opts.rejoin && !marked);
      lines = live.lines;
      this.stats.rejoins += live.joins.length;
    }
    this.stats.lines += lines.length;
    const logins = new Map<number, LoginInfo>();
    if (!mush) for (const l of loginInfos(lines)) logins.set(l.index, l);

    // Per-file parsers (live: one pipeline per app run). Block/survey
    // bookkeeping for lost blocks and the late character switch.
    let emitted = 0;
    let sawRoomOrSurvey = false;
    let afterLogin = false;
    const townParser = new TownParser((block) => {
      emitted++;
      sawRoomOrSurvey = true;
      this.onBlock(block, afterLogin);
      afterLogin = false;
    });
    const hexParser = new RoomParser((event) => {
      // Live wiring: hex events drive the hex localizer; wilderness surveys
      // deactivate the town engine; move failures indoors pop the town queue.
      switch (event.type) {
        case 'survey':
          sawRoomOrSurvey = true;
          afterLogin = false;
          this.townLocalizer.onWilderness();
          this.hexLocalizer.onSurvey({
            art: event.art,
            description: event.description,
            now: this.clock,
          });
          this.townLocalizer.noteOutdoorPosition(this.currentAnchor());
          this.hooks.onSurvey?.();
          break;
        case 'move-failed':
          this.stats.moveFails++;
          if (this.townLocalizer.active) this.townLocalizer.onMoveFailed();
          else this.hexLocalizer.onMoveFailed(event.hard);
          this.hooks.onMoveFailed?.(this.townLocalizer.active);
          break;
        case 'forced-move':
          this.hexLocalizer.trackForcedMove(event.dir, this.clock);
          break;
        case 'town-room':
          this.hexLocalizer.onTownRoom(this.clock);
          break;
      }
    });

    this.hexLocalizer.reset();
    this.townLocalizer.reset();

    let pendingExits = -1;
    let pendingExitsText = '';
    let emittedAtPending = 0;
    const recent: string[] = [];
    let pendingContext: string[] = [];
    let late: LateSwitch | null = null;
    const closeExits = () => {
      if (pendingExits >= 0 && emitted === emittedAtPending) {
        this.stats.lostBlocks++;
        this.hooks.onLostBlock?.(pendingExits + 1, pendingExitsText, pendingContext);
      }
      pendingExits = -1;
    };
    const applyLate = () => {
      if (!late) return;
      const l = late;
      late = null;
      if (l.char === this.char) return;
      this.switchTo(l.char, l.login, true);
      // The new character's localizer starts after its login too
      this.townLocalizer.onLogin();
    };

    for (let i = 0; i < lines.length; i++) {
      const entry = lines[i];
      if (!entry) continue; // a TCP fragment rejoined into a later line
      this.line = i + 1;
      // The pager's prompt is screen-only live (see the module comment);
      // null: the prompt alone
      const parsed = parserText(entry.text);
      const text = parsed ?? '';
      if (mush) this.clock += 100;
      else if (entry.t !== null) this.clock = entry.t > this.clock ? entry.t : this.clock + 1;
      else this.clock += 100;

      if (late && this.clock > late.deadline) applyLate();
      const login = logins.get(i);
      if (login) {
        applyLate(); // an earlier login's store load has long finished
        late = this.onLogin(login);
        afterLogin = true;
      }

      if (!mush) {
        const cmd = loggedCommand(text);
        if (cmd) {
          // A sent line is what live tracked; a typed line is tracked only
          // in a log without sent lines, through the alias engine
          const raw = cmd.command;
          const typed = !cmd.sent && marked;
          const sent = cmd.sent ? [raw] : typed ? [] : this.opts.expand(raw, this.activeChar);
          let tracked = 0;
          for (const c of sent) {
            // Live wiring: every send goes to both localizers; each gates itself
            if (this.townLocalizer.trackCommand(c, this.clock)) tracked++;
            else if (this.hexLocalizer.trackCommand(c, this.clock)) tracked++;
          }
          this.stats.cmdTracked += tracked;
          this.hooks.onCommand?.(raw, sent, tracked, typed);
          continue;
        }
      }
      if (parsed === null) continue; // a pager prompt alone

      // The server lines the town engine reads directly — the live
      // feedLine's own dispatcher, at the same point (before the parsers)
      for (const e of dispatchTownLine(text, this.townLocalizer, this.clock)) {
        switch (e.kind) {
          case 'portal':
            this.stats.portals++;
            this.hooks.onPortal?.(e.dirWord);
            break;
          case 'teleport':
            this.stats.teleports++;
            this.hooks.onTeleport?.();
            break;
          case 'forced-move':
            if (e.queued) this.stats.forcedMoves++;
            this.hooks.onForcedMove?.(e.move, e.queued);
            break;
          case 'dark':
            if (e.wasActive) this.stats.darkArrivals++;
            this.hooks.onDarkArrival?.(e.result);
            break;
          case 'unknown-command':
            if (e.failed) this.stats.replyFails++;
            this.hooks.onUnknownCommand?.(e.verb, e.failed);
            break;
        }
      }
      if (NO_EXITS_RE.test(text)) this.stats.noExitsRooms++;
      hexParser.feedLine(text);
      if (EXITS_START_RE.test(text)) {
        // feedLine would finish a pending wrapped exits sentence first anyway;
        // flushing here attributes that block to ITS exits line
        townParser.flushPending();
        closeExits();
        this.stats.exitsLines++;
        pendingExits = i;
        pendingExitsText = text;
        pendingContext = recent.slice(-6);
        emittedAtPending = emitted;
      }
      townParser.feedLine(text);
      recent.push(text);
      if (recent.length > 8) recent.shift();
      if (late && sawRoomOrSurvey) applyLate();
      sawRoomOrSurvey = false;
    }
    townParser.flushPending();
    closeExits();
    applyLate();
    if (mush) this.clock += 60_000; // gap between MUSH logs (no timestamps)
  }

  /**
   * Handle a login line: swap stores on a character switch, then reset the
   * town localizer that will resolve the login burst (onLogin — in
   * switchLate mode, the previous character's: the race files the burst
   * there). Returns the switch to apply late (switchLate).
   */
  private onLogin(login: LoginInfo): LateSwitch | null {
    const late = this.switchAtLogin(login);
    this.townLocalizer.onLogin();
    return late;
  }

  private switchAtLogin(login: LoginInfo): LateSwitch | null {
    this.stats.logins++;
    if (login.typed) this.stats.loginsTyped++;
    if (!login.char) this.stats.loginsUnidentified++;
    const next = login.char;
    const switching =
      this.opts.perChar && next !== null && this.char !== null && next !== this.char;
    this.hooks.onLogin?.(login, switching);
    if (next !== null) this.loginChar = next;
    if (!this.opts.perChar || next === null) return null;
    if (this.char === null) {
      // The first identified login names whoever the store belonged to
      this.char = next;
      return null;
    }
    if (!switching) return null; // same-character re-login: live resets nothing
    if (this.opts.switchLate && login.typed) {
      return { login, char: next, deadline: this.clock + LATE_SWITCH_MAX_MS };
    }
    this.switchTo(next, login, false);
    return null;
  }

  private onBlock(block: TownRoomBlock, afterLogin: boolean): void {
    this.stats.blocks++;
    this.hooks.beforeBlock?.(block);
    const before = this.townMap.room(this.townMap.pos);
    const townsBefore = new Set(this.townMap.towns.keys());
    const sizeBefore = new Map([...this.townMap.towns.values()].map((t) => [t.id, t.rooms.size]));
    const wasActive = this.townLocalizer.active;
    const res = this.townLocalizer.onRoomBlock(block, this.currentAnchor(), this.clock);
    this.kinds[res.kind] = (this.kinds[res.kind] ?? 0) + 1;
    const byChar = (this.kindsByChar[this.char ?? 'unknown'] ??= {});
    byChar[res.kind] = (byChar[res.kind] ?? 0) + 1;
    if (res.merged) this.stats.merges++;
    this.hooks.onBlock?.({
      block,
      res,
      before,
      townsBefore,
      sizeBefore,
      wasActive,
      afterLogin,
    });
  }
}
