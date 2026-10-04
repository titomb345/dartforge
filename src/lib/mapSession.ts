/**
 * Whose map the live mapper stores hold — the load/save lifecycle around
 * character switches. useMapTracker keeps one map-<character>.json (hex map
 * + town map) per character and swaps the stores when the active character
 * changes; this class decides which file a save may write and where input
 * goes while a character's map is loading. A plain class so the rules can
 * be tested without React (scripts/town-tests/test-map-session.ts); the
 * hook supplies the IO.
 *
 * The rules, and what each one stopped:
 *  - The stores belong to `owner`, set only once that character's load has
 *    landed. Saves write the owner's file and nothing else, never while a
 *    load is in flight. (The hook used to name the new character before its
 *    load swapped the stores, so a save in that window — or after a load
 *    that failed — wrote the previous character's maps into the new
 *    character's file; and the switch-time flush wrote whatever the stores
 *    held under the old name.)
 *  - Every load carries a generation: a load that lands after a newer
 *    switch is dropped (a slow first read of one character's 1.1 MB map
 *    could land after a quick switch back and install the wrong map).
 *  - A login switches synchronously, from the login line, BEFORE the rest
 *    of the login chunk reaches the parsers (useMapTracker.beginCharacter
 *    from App's onCharacterName). The settings write and the map read are
 *    async, and the login burst — the new character's first room block —
 *    arrived meanwhile and was resolved and saved in the PREVIOUS
 *    character's map (replayed with that race for the four typed-name
 *    logins alone, the stage-1 corpus replay gained 18 rooms and 18 true
 *    duplicates, Eris 9 -> 27; an auto-login whose slot differs from the
 *    active character raced the same way). Input that arrives while the map
 *    loads is held in ONE ordered queue (output lines, sent commands,
 *    logins) and replayed with its own timestamps once the map is
 *    installed, so the login block reaches the new character's localizer
 *    and resumes there.
 *  - A login as the character whose map is already loaded (or loading)
 *    swaps nothing — the live localizer carries on (most in-run re-logins
 *    are the same character). A data-dir change is a switch to the same
 *    character: flush, then reload from the new place. A load that failed
 *    leaves empty stores no file is written from, and is tried again at the
 *    character's next login.
 *  - Saves are debounced (2 s after the latest change) but never wait more
 *    than 10 s: continuous movement used to keep re-arming the timer for
 *    up to 75 s in the corpus, and a crash in that window loses the map's
 *    newest rooms and the position the next login resumes from.
 */

import { realTimers, type Timers } from './timers';

export type HeldMapInput =
  | { kind: 'line'; line: string; raw?: string; at: number }
  | { kind: 'command'; command: string; at: number }
  | { kind: 'login'; at: number };

export interface MapSessionIO<S> {
  /** Read a character's persisted stores. `stale()` turns true once a newer
   *  switch supersedes this load (stop early; the result is dropped anyway) */
  load(character: string, stale: () => boolean): Promise<S>;
  /** Make `stores` the live stores, with fresh localizers and parsers (null:
   *  empty stores — nothing of the previous owner's may be touched) */
  install(stores: S | null): void;
  /** Write the live stores to `character`'s file (always the owner) */
  save(character: string): void;
  /** Run one held input through the live pipeline, at its own time */
  replay(input: HeldMapInput): void;
  /** A load failed: the stores stay empty and are not saved */
  loadFailed?(character: string, error: unknown): void;
  timers?: Timers;
  now?(): number;
}

/** Quiet time before a save (ms) */
export const SAVE_DEBOUNCE_MS = 2_000;
/** ... but a change is never left unsaved longer than this (ms) */
export const SAVE_MAX_WAIT_MS = 10_000;
/** Held inputs kept while a map loads (a load takes milliseconds; a login
 *  burst is ~100 lines) — beyond it new input is dropped */
const HELD_MAX = 10_000;

export class MapStoreSession<S> {
  /** The character whose map the live stores hold (null: none — loading,
   *  failed, or no character yet) */
  owner: string | null = null;
  /** The character the stores are being, or have been, switched to */
  wanted: string | null = null;
  private loading = false;
  private gen = 0;
  private held: HeldMapInput[] = [];
  private dropped = 0;
  private saveTimer: unknown = null;
  /** When the oldest unsaved change was made (null: nothing to save) */
  private dirtySince: number | null = null;
  private readonly timers: Timers;

  constructor(private readonly io: MapSessionIO<S>) {
    this.timers = io.timers ?? realTimers;
  }

  /** A load is in flight: input must be held (see hold) */
  get holding(): boolean {
    return this.loading;
  }

  /**
   * Switch the live stores to `character`'s map. A no-op (false) when they
   * hold it or are loading it already — unless `reload` (the data dir moved
   * under the same character). After a failed load the next login as that
   * character tries again.
   */
  begin(character: string, reload = false): boolean {
    const c = character.toLowerCase();
    if (!reload && c === this.wanted && (this.loading || this.owner === c)) return false;
    // The previous owner's pending changes go to ITS file, now
    this.flush();
    if (c !== this.wanted && this.held.length > 0) {
      // Held for a switch that never landed: it belongs to no loaded map
      this.held = [];
    }
    this.wanted = c;
    this.owner = null;
    this.loading = true;
    const gen = ++this.gen;
    const stale = () => gen !== this.gen;
    this.io.install(null);
    let loaded: Promise<S>;
    try {
      loaded = this.io.load(c, stale);
    } catch (e) {
      loaded = Promise.reject(e);
    }
    loaded.then(
      (stores) => {
        if (stale()) return;
        try {
          this.io.install(stores);
          this.owner = c;
        } catch (error) {
          this.io.loadFailed?.(c, error);
        }
        this.settle();
      },
      (error: unknown) => {
        if (stale()) return;
        this.io.loadFailed?.(c, error);
        this.settle();
      }
    );
    return true;
  }

  /** Keep `input` for replay while a map loads. False: process it now. */
  hold(input: HeldMapInput): boolean {
    if (!this.loading) return false;
    if (this.held.length < HELD_MAX) this.held.push(input);
    else if (this.dropped++ === 0) console.warn('[Map] map load is slow; dropping input');
    return true;
  }

  /** A map change: save the owner's file soon (see SAVE_MAX_WAIT_MS) */
  scheduleSave(): void {
    // Stores no character owns (loading, failed) are never saved
    if (this.owner === null) return;
    const now = this.io.now ? this.io.now() : Date.now();
    if (this.dirtySince === null) this.dirtySince = now;
    if (this.saveTimer !== null) this.timers.clear(this.saveTimer);
    const due = Math.min(now + SAVE_DEBOUNCE_MS, this.dirtySince + SAVE_MAX_WAIT_MS);
    this.saveTimer = this.timers.set(
      () => {
        this.saveTimer = null;
        this.flush();
      },
      Math.max(0, due - now)
    );
  }

  /** Write pending changes now — to the owner's file only. Nothing pending:
   *  nothing written (a switch or an unmount after the last save is free). */
  flush(): void {
    if (this.saveTimer !== null) {
      this.timers.clear(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirtySince === null) return;
    this.dirtySince = null;
    if (this.owner !== null && !this.loading) this.io.save(this.owner);
  }

  /** The load landed (or failed): replay what arrived meanwhile, in order */
  private settle(): void {
    this.loading = false;
    this.dropped = 0;
    const held = this.held;
    this.held = [];
    for (const input of held) {
      try {
        this.io.replay(input);
      } catch (error) {
        // One bad input must not strand the rest (live, it would have thrown
        // in the output handler and the next line gone on regardless)
        console.error('[Map] replaying held input failed:', error);
      }
    }
  }
}
