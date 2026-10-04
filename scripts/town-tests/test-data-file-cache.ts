/**
 * Regression test: the data store's file cache (src/lib/dataFileCache.ts),
 * which TauriDataStoreProvider reads and writes every data file through —
 * the map files included (Oct 2026 deep dive, persistence lens; app-wiring
 * stage).
 *
 *  A. Concurrent first reads of a file share one read and one object. Each
 *     used to read on its own and install its own object, the last read to
 *     land won, and a key set through the other object never reached disk:
 *     the map tracker sets mapData and townData back to back, so a save to a
 *     map file not yet read this run lost one of them.
 *  B. A file read once is served from memory; a failed read is not cached
 *     (the next caller reads again).
 *  C. A data-dir change (reset) while a read is in flight: the read was the
 *     OLD dir's — it answers its caller (a get asked before the move) but is
 *     not cached, and the next caller reads the new dir. A change waiting
 *     on that read (forChange: set / delete) reads the file again, from the
 *     new dir: given the old dir's object, the change's write put the old
 *     dir's whole file over the new one's.
 *  D. During the move itself (moveTo: the provider saves the dir list, then
 *     Rust resolves the new dir) a read still gets the OLD dir: the cache is
 *     dropped again once the move lands. The provider dropped it only
 *     before, so a map save in that window read the old dir's map file and
 *     its write put that whole file, with the change, over the new dir's
 *     (reproduced with the real provider on a fake backend, HEAD and this
 *     stage alike, before this fix).
 */
import { DataFileCache, type FileCache } from '../../src/lib/dataFileCache';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

/** Let pending promise callbacks run */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Read {
  file: string;
  dir: string;
  done: boolean;
  answer(): void;
  fail(e: unknown): void;
}

/** Two data dirs on a fake disk; every read waits until the test answers it */
function fakeDisk() {
  const dirs: Record<string, Record<string, FileCache>> = {
    old: {
      'map-mazorn.json': { mapData: 'OLD' },
      'map-trilok.json': { mapData: 'OLD-TRILOK' },
      'settings.json': { a: 1 },
      'chat.json': { a: 'old' },
    },
    new: {
      'map-mazorn.json': { mapData: 'NEW' },
      'map-trilok.json': { mapData: 'NEW-TRILOK' },
      'settings.json': { a: 2 },
      'chat.json': { a: 'new' },
    },
  };
  const disk = {
    dir: 'old',
    reads: [] as Read[],
    read: (file: string) =>
      new Promise<FileCache | null>((resolve, reject) => {
        // Rust reads the dir that is active at the call
        const dir = disk.dir;
        const r: Read = {
          file,
          dir,
          done: false,
          answer: () => {
            r.done = true;
            const data = dirs[dir][file];
            resolve(data ? JSON.parse(JSON.stringify(data)) : null);
          },
          fail: (e) => {
            r.done = true;
            reject(e);
          },
        };
        disk.reads.push(r);
      }),
    /** Answer every read still waiting, oldest first, and let them land */
    async answerAll() {
      for (const r of disk.reads) if (!r.done) r.answer();
      await settle();
    },
  };
  return disk;
}

// --- A: one read, one object ---------------------------------------------------------------
{
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  // useMapTracker's save: set(mapData) and set(townData) back to back
  const first = cache.forChange('map-mazorn.json');
  const second = cache.forChange('map-mazorn.json');
  check(disk.reads.length === 1, `A: concurrent first reads share one read (${disk.reads.length})`);
  await disk.answerAll();
  const [a, b] = await Promise.all([first, second]);
  check(a === b, 'A: ... and one object');
  a.mapData = 'hex';
  b.townData = 'towns';
  check(
    JSON.stringify(cache.peek('map-mazorn.json')) === '{"mapData":"hex","townData":"towns"}',
    `A: both keys reach the cached file (${JSON.stringify(cache.peek('map-mazorn.json'))})`
  );
  const got = cache.load('map-mazorn.json');
  const reads = disk.reads.length;
  await disk.answerAll();
  check(
    reads === 1 && (await got) === cache.peek('map-mazorn.json'),
    'B: a file read once is served from memory'
  );
  check(
    JSON.stringify(cache.loadedFiles()) === '["map-mazorn.json"]',
    `B: it is a loaded file (flushAll writes it) (${cache.loadedFiles()})`
  );
}
{
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  const missing = cache.load('aliases.json');
  await disk.answerAll();
  check(
    JSON.stringify(await missing) === '{}' && cache.loadedFiles().includes('aliases.json'),
    'B: a file that does not exist reads as empty'
  );
}

// --- B: a failed read ---------------------------------------------------------------------
{
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  const one = cache.load('settings.json');
  const two = cache.load('settings.json');
  for (const r of disk.reads) r.fail(new Error('disk'));
  const results = await Promise.allSettled([one, two]);
  check(
    results.every((r) => r.status === 'rejected'),
    'B: a failed read fails every caller waiting on it'
  );
  check(cache.peek('settings.json') === undefined, 'B: ... and caches nothing');
  const failed = disk.reads.length;
  const again = cache.load('settings.json');
  check(disk.reads.length === failed + 1, 'B: the next caller reads again');
  await disk.answerAll();
  check((await again).a === 1, 'B: ... and gets the file');
}

// --- C: the data dir moves while a read is in flight ---------------------------------------------
{
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  const asked = cache.load('settings.json');
  const change = cache.forChange('map-mazorn.json');
  check(disk.reads.length === 2, 'C: two reads in flight from the old dir');
  // reloadFromDir: flush, drop every cached file, then the new dir is active
  cache.reset();
  disk.dir = 'new';
  await disk.answerAll();
  check((await asked).a === 1, 'C: a get asked before the move gets its answer');
  check(
    cache.peek('settings.json') === undefined && !cache.loadedFiles().includes('settings.json'),
    'C: ... but the old dir is not cached'
  );
  const reread = disk.reads.slice(2);
  check(
    reread.length === 1 && reread[0].dir === 'new' && reread[0].file === 'map-mazorn.json',
    `C: a change waiting on the old read reads the file again, from the new dir (${JSON.stringify(disk.reads.map((r) => `${r.dir}/${r.file}`))})`
  );
  await disk.answerAll();
  const target = await change;
  check(
    target.mapData === 'NEW' && cache.peek('map-mazorn.json') === target,
    `C: ... and changes the new dir's file (${JSON.stringify(target)})`
  );
  const before = disk.reads.length;
  const fresh = cache.load('settings.json');
  check(
    disk.reads.length === before + 1 && disk.reads[before].dir === 'new',
    'C: the next get reads the new dir'
  );
  await disk.answerAll();
  check((await fresh).a === 2, "C: ... and gets the new dir's file");
}
{
  // A get and a change share the read the move strands
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  const asked = cache.load('map-mazorn.json');
  const change = cache.forChange('map-mazorn.json');
  check(disk.reads.length === 1, 'C: a get and a change share one read');
  cache.reset();
  disk.dir = 'new';
  await disk.answerAll();
  await disk.answerAll();
  check((await asked).mapData === 'OLD', 'C: the get gets the old answer it asked for');
  check((await change).mapData === 'NEW', "C: the change goes into the new dir's file");
}
{
  // A get after the move does not join a read the move stranded
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  const stranded = cache.load('settings.json');
  cache.reset();
  disk.dir = 'new';
  const after = cache.load('settings.json');
  check(
    disk.reads.length === 2 && disk.reads[1].dir === 'new',
    `C: a get after the move reads the new dir (${JSON.stringify(disk.reads.map((r) => r.dir))})`
  );
  await disk.answerAll();
  check(
    (await stranded).a === 1 && (await after).a === 2,
    "C: ... and gets the new dir's file, not the stranded read's"
  );
}
{
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  const loaded = cache.load('settings.json');
  await disk.answerAll();
  await loaded;
  cache.reset();
  check(
    cache.peek('settings.json') === undefined && cache.loadedFiles().length === 0,
    'C: a reset drops every cached file'
  );
}

// --- D: reads while the move is under way ----------------------------------------------------
{
  const disk = fakeDisk();
  const cache = new DataFileCache(disk.read);
  const settled = cache.load('settings.json');
  await disk.answerAll();
  await settled;
  let during: Promise<FileCache> | null = null;
  let quick: Promise<FileCache> | null = null;
  let slow: Promise<FileCache> | null = null;
  const moved = await cache.moveTo(async () => {
    check(cache.peek('settings.json') === undefined, 'D: the move drops every file first');
    // (the dir list being saved) a get, a map save whose read lands at
    // once, and one whose read is still out when the move lands
    during = cache.load('chat.json');
    quick = cache.forChange('map-mazorn.json');
    await disk.answerAll();
    // set(): the change goes into the object it was handed, which goes back
    // into the cache, and a write is due
    const target = await quick;
    target.mapData = 'SAVED-IN-THE-WINDOW';
    cache.set('map-mazorn.json', target);
    slow = cache.forChange('map-trilok.json');
    disk.dir = 'new'; // resolve_data_dir
    return 'C:/new';
  });
  check(moved === 'C:/new', 'D: moveTo answers what the move did');
  check(
    (await during!).a === 'old' &&
      cache.peek('chat.json') === undefined &&
      !cache.loadedFiles().includes('chat.json'),
    'D: a file read during the move (the old dir) is not cached'
  );
  check(
    cache.peek('map-mazorn.json') === undefined,
    "D: a change made on the old dir's file during the move is dropped with it, not written over the new dir's"
  );
  await disk.answerAll();
  await disk.answerAll();
  const trilok = await slow!;
  check(
    trilok.mapData === 'NEW-TRILOK' && cache.peek('map-trilok.json') === trilok,
    `D: a change whose read was still out when the move landed goes into the new dir's file (${JSON.stringify(trilok)})`
  );
  const after = cache.load('map-mazorn.json');
  await disk.answerAll();
  check((await after).mapData === 'NEW', "D: the next get reads the new dir's file");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS — data file cache (shared first reads, data-dir moves)');
