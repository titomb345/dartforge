/**
 * Shared replay plumbing for the town/hex replay scripts: turns a session
 * log's raw `>> input` line into the commands the live client would have
 * SENT (and therefore tracked), and parses log timestamps.
 *
 * Live, raw input goes through the alias engine (user aliases, speedwalks,
 * the `;;` separator) and alias-produced built-ins like `/door <dir>` are
 * dispatched — the session log only records the raw input. Replaying the
 * raw text would skip moves an alias hides (`door w` → .../w/...) and miss
 * commands an alias adds (`port` → "activate portal", "enter portal").
 */
import * as fs from 'fs';
import { expandInput } from '../../src/lib/aliasEngine';
import { buildDoorSequence } from '../../src/lib/doorSequence';
import { sanitizeRecordMap } from '../../src/lib/sanitizeRecords';
import type { Alias } from '../../src/types/alias';

export const ALIASES_FILE = 'C:/Users/titom/Dropbox/DM/Dartforge/aliases.json';
/** settings.json doorKeys — only changes how many unlock/lock lines a door sends */
export const DOOR_KEYS = 2;

/** The user's aliases.json: --aliases, then DF_ALIASES, then the live Dropbox file.
 *  Measurements pin a frozen copy — the live file drifts as Bill edits aliases. */
export function resolveAliasesFile(flag?: string): string {
  return (flag ?? process.env.DF_ALIASES ?? ALIASES_FILE).replace(/\\/g, '/');
}

/** The alias maps of an aliases.json: "global", plus one per character keyed
 *  by the lower-case name ("mazorn": {...}), like useAliases.ts */
export interface AliasSets {
  global: Alias[];
  byChar: Record<string, Alias[]>;
}

/**
 * Read an aliases.json. Throws when the file cannot be read or is not an
 * aliases.json: replaying without the aliases is a different experiment
 * that LOOKS like a normal run (a typo'd path measured expected 86.4% →
 * 77.2% and true wrong-room 40 → 255 on the frozen corpus).
 */
export function loadAliasSets(file = resolveAliasesFile()): AliasSets {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read aliases file ${file}: ${(e as Error).message}`);
  }
  const maps = raw as Record<string, unknown> | null;
  if (!maps || typeof maps !== 'object' || !maps.global || typeof maps.global !== 'object') {
    throw new Error(`${file} is not an aliases.json (no "global" alias map)`);
  }
  // Live drops malformed records on load (sanitizeRecordMap). Script-mode
  // aliases run JavaScript live (the user's are lock/unlock helpers that
  // never move the player) — text expansion would send their source code
  // as commands, so they're left out.
  const usable = (m: unknown) =>
    Object.values(sanitizeRecordMap<Alias>(m, 'pattern')).filter((a) => a.bodyMode !== 'script');
  const byChar: Record<string, Alias[]> = {};
  for (const [key, m] of Object.entries(maps)) {
    if (key !== 'global') byChar[key.toLowerCase()] = usable(m);
  }
  return { global: usable(maps.global), byChar };
}

/** loadAliasSets for the command-line tools: an unusable file ends the run (exit 2) */
export function loadAliasSetsOrExit(file: string): AliasSets {
  try {
    return loadAliasSets(file);
  } catch (e) {
    console.error(`ERROR: ${(e as Error).message}`);
    process.exit(2);
  }
}

/** "86 global, mazorn 27, trilok 4" */
export function describeAliasSets(sets: AliasSets): string {
  return [
    `${sets.global.length} global`,
    ...Object.entries(sets.byChar).map(([c, l]) => `${c} ${l.length}`),
  ].join(', ');
}

const SPEEDWALK_LINE = /^(?:\d+(?:n|s|e|w|ne|nw|se|sw|u|d))+$/i;
const SPEEDWALK_SEG = /(\d+)(n|s|e|w|ne|nw|se|sw|u|d)/gi;

/** The pre-alias-engine expansion: door aliases, speedwalks, ';' splits. */
export function legacyExpandInput(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(';')) {
    let p = part.trim();
    if (!p) continue;
    const door = /^\/?doorp?\s*(ne|se|nw|sw|n|s|e|w|d|u|in|out)\s*$/i.exec(p);
    if (door) p = door[1];
    if (SPEEDWALK_LINE.test(p)) {
      SPEEDWALK_SEG.lastIndex = 0;
      let m;
      while ((m = SPEEDWALK_SEG.exec(p)) !== null) {
        const count = Math.min(parseInt(m[1], 10), 50);
        for (let i = 0; i < count; i++) out.push(m[2]);
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

/** One expanded send → the command(s) the mapper would track live. */
function pushSend(text: string, out: string[]): void {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('/')) {
      // Built-ins are dispatched, not sent. Only /door moves the player.
      const door = /^\/door\s+(\S+)\s*$/i.exec(t);
      if (door) out.push(...(buildDoorSequence(door[1], DOOR_KEYS) ?? []));
      continue;
    }
    out.push(t);
  }
}

/** Raw logged input → live-sent commands (alias engine + /door built-in). */
export function makeExpander(aliases: Alias[]): (raw: string) => string[] {
  return (raw: string) => {
    const out: string[] = [];
    const res = expandInput(raw, aliases, { enableSpeedwalk: true, separator: ';;' });
    for (const c of res.commands) {
      if (c.type === 'send') pushSend(c.text, out);
      else if (c.type === 'spam') {
        for (let i = 0; i < Math.min(c.count, 50); i++) pushSend(c.command, out);
      }
    }
    return out;
  };
}

/**
 * Raw logged input → live-sent commands for the character whose session it
 * is: live expands with that character's aliases FIRST, then the global
 * ones (useAliases mergedAliases); no character yet → global only. On the
 * frozen corpus Bill's character aliases (combat/equipment) change the
 * expansion of 1,763 of 45,505 logged commands but not one tracked move.
 */
export function makeCharExpander(sets: AliasSets): (raw: string, char: string | null) => string[] {
  const global = makeExpander(sets.global);
  const byChar = new Map<string, (raw: string) => string[]>();
  return (raw, char) => {
    const own = char ? sets.byChar[char] : undefined;
    if (!char || !own?.length) return global(raw);
    let expand = byChar.get(char);
    if (!expand) byChar.set(char, (expand = makeExpander([...own, ...sets.global])));
    return expand(raw);
  };
}

/** "[2026-07-07 1:22:30 AM] text" → { t: epoch ms, text } (null if no stamp).
 *  The logger's 24-hour stamps ("[2026-07-07 01:22:30] text", the app's
 *  other timestamp setting — src/lib/sessionLog.ts formatLogStamp) read
 *  alike; they used to fall back to a fake clock. Every log in the corpus is
 *  12-hour.
 *  Stamps are zone-less LOCAL time: across a DST fall-back the hour repeats
 *  (the replay clock never runs backwards, so the localizer sees that hour
 *  squeezed, and nested-file spans are an hour off). The frozen corpus
 *  (June–October 2026) has no fall-back. */
const TS_RE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})(?: (AM|PM))?\] (.*)$/;
export function parseStamp(line: string): { t: number; text: string } | null {
  const ts = TS_RE.exec(line);
  if (!ts) return null;
  let h = parseInt(ts[4], 10);
  if (ts[7]) h = (h % 12) + (ts[7] === 'PM' ? 12 : 0);
  const t = new Date(
    parseInt(ts[1], 10),
    parseInt(ts[2], 10) - 1,
    parseInt(ts[3], 10),
    h,
    parseInt(ts[5], 10),
    parseInt(ts[6], 10)
  ).getTime();
  return { t, text: ts[8] };
}
