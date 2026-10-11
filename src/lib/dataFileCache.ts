/**
 * The data store's in-memory copy of its JSON data files (settings.json,
 * map-<character>.json, ...): each file is read from disk once, then get /
 * set / delete work on the cached object and a debounced write puts the
 * whole object back. TauriDataStoreProvider owns one and supplies the read;
 * the rules live here so they can be tested without React
 * (scripts/town-tests/test-data-file-cache.ts).
 *
 *  - Concurrent first reads of a file share one read. Each used to install
 *    its own cache object and the last read to land won, so a key set
 *    through the losing object never reached disk (the map tracker sets
 *    mapData and townData back to back: a save to a map file not yet read
 *    this run lost one of them).
 *  - A data-dir change drops every cached file (reset). A read still in
 *    flight then belongs to the OLD dir: it is not cached, and a change
 *    waiting on it reads the file again from the new dir — installed, the
 *    old dir's object would have been written over the new dir's file.
 *  - The move itself takes a while (the provider saves the dir list, then
 *    Rust resolves the new dir), and until it lands Rust still reads the
 *    old dir: a file read in that window was the old dir's too, so the
 *    cache is dropped again once the move lands (moveTo). The provider used
 *    to drop it only before: a map save in the window read the old dir's
 *    map file, and its write put that whole file, with the change, over the
 *    new dir's.
 */

export type FileCache = Record<string, unknown>;

export class DataFileCache {
  private readonly files = new Map<string, FileCache>();
  /** Files read from disk since the last reset (their object is the file) */
  private readonly loaded = new Set<string>();
  /** First reads in flight: concurrent callers share one */
  private readonly inflight = new Map<string, Promise<FileCache>>();
  /** Bumped by reset: a read started before it is the old dir's */
  private gen = 0;

  /** `read`: a data file's contents, null when it does not exist */
  constructor(private readonly read: (filename: string) => Promise<FileCache | null>) {}

  /** The file's cached object, without reading (undefined: none yet) */
  peek(filename: string): FileCache | undefined {
    return this.files.get(filename);
  }

  /** Every file read from disk since the last reset */
  loadedFiles(): string[] {
    return [...this.loaded];
  }

  /** The file's object, read from disk first if it has not been */
  load(filename: string): Promise<FileCache> {
    if (this.loaded.has(filename)) return Promise.resolve(this.files.get(filename) ?? {});
    const pending = this.inflight.get(filename);
    if (pending) return pending;
    const gen = this.gen;
    const read = (async () => {
      const cache = (await this.read(filename)) ?? {};
      // (Read from a data dir that has since been replaced: not cached)
      if (gen === this.gen) {
        this.files.set(filename, cache);
        this.loaded.add(filename);
      }
      return cache;
    })();
    this.inflight.set(filename, read);
    // Settled either way: the next caller finds the cache, or reads again
    read
      .finally(() => {
        if (this.inflight.get(filename) === read) this.inflight.delete(filename);
      })
      .catch(() => {});
    return read;
  }

  /**
   * The object a change goes into: the file as read from the CURRENT data
   * dir — a read that was in flight across a reset is read again.
   */
  async forChange(filename: string): Promise<FileCache> {
    for (;;) {
      const gen = this.gen;
      const cache = await this.load(filename);
      if (gen === this.gen) return cache;
    }
  }

  /** Make `cache` the file's object (a change went into it) */
  set(filename: string, cache: FileCache): void {
    this.files.set(filename, cache);
  }

  /** The data dir moved: drop every file (reads in flight are the old dir's) */
  reset(): void {
    this.files.clear();
    this.loaded.clear();
    this.inflight.clear();
    this.gen++;
  }

  /**
   * Move to another data dir: `move` makes it the active one. Every file is
   * dropped before the move and again once it has landed — a file read
   * while it was under way came from the old dir (see the module comment).
   */
  async moveTo<T>(move: () => Promise<T>): Promise<T> {
    this.reset();
    try {
      return await move();
    } finally {
      this.reset();
    }
  }
}
