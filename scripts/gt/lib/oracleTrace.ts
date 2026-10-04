/**
 * Oracle-backed metrics INSIDE a replay (replay-town.ts --oracle): the true
 * wrong-room count next to the description-disagreement proxy.
 *
 * WRONG-ROOM: a mapped room's identity is the oracle class of the block that
 * created it (or first touched it). A later block of a DIFFERENT class
 * resolved onto it is a true wrong-room assignment — the same name + canon
 * text with other exits counts as the same room (door / portcullis state).
 * Word-identical twins are invisible to it, so it is a LOWER bound; unlike
 * the proxy it never counts day/night, crowd, weather or portal-fire prose
 * (the proxy's 1,616 "disagreements" in the legacy baseline were 58 real).
 *
 * GLUE: a block of oracle place P filed into a town whose majority place is
 * Q != P (towns with 5+ placed blocks; the first time P shows up there).
 */
import type { TownRoomBlock } from '../../../src/lib/townParser';
import type { TownResolution } from '../../../src/lib/townLocalizer';
import type { TownRoom } from '../../../src/lib/townMap';
import { OracleIndex, type OracleClass } from './oracle';

export interface WrongRoom {
  file: string;
  line: number;
  char: string;
  kind: string;
  block: number;
  room: number;
  town: number;
  roomId: number;
  moved: unknown;
  from: number | null;
}

export class OracleTrace {
  readonly wrong: Record<string, number> = {};
  readonly checked: Record<string, number> = {};
  unclassified = 0;
  glueEvents = 0;
  readonly glueLines: string[] = [];
  readonly wrongList: WrongRoom[] = [];
  private readonly roomClass = new Map<string, OracleClass>();
  private readonly townPlaces = new Map<string, Map<number, number>>();
  private readonly glueReported = new Map<string, number>();

  constructor(readonly index: OracleIndex) {}

  classOfBlock(block: TownRoomBlock): OracleClass | undefined {
    return this.index.classOf(block.name, block.exits.dirs, block.exits.named, block.desc);
  }

  observe(
    char: string,
    block: TownRoomBlock,
    res: TownResolution,
    before: TownRoom | undefined,
    file: string,
    line: number
  ): void {
    if (!res.pos) return;
    const bc = this.classOfBlock(block);
    if (!bc) {
      this.unclassified++;
      return;
    }
    const key = `${char}:${res.pos.townId}:${res.pos.roomId}`;
    const rc = this.roomClass.get(key);
    if (rc === undefined || res.kind === 'new-room' || res.kind === 'jumped') {
      this.roomClass.set(key, bc);
    } else {
      this.checked[res.kind] = (this.checked[res.kind] ?? 0) + 1;
      const same = rc.id === bc.id || (rc.name === bc.name && rc.canon === bc.canon);
      if (!same) {
        this.wrong[res.kind] = (this.wrong[res.kind] ?? 0) + 1;
        this.wrongList.push({
          file,
          line,
          char,
          kind: res.kind,
          block: bc.id,
          room: rc.id,
          town: res.pos.townId,
          roomId: res.pos.roomId,
          moved: res.moved ?? null,
          from: before?.id ?? null,
        });
      }
    }
    this.notePlace(char, bc, block, res, before, file, line);
  }

  private notePlace(
    char: string,
    bc: OracleClass,
    block: TownRoomBlock,
    res: TownResolution,
    before: TownRoom | undefined,
    file: string,
    line: number
  ): void {
    const p = OracleIndex.placeOf(bc);
    if (p < 0 || !res.pos) return;
    const tk = `${char}:${res.pos.townId}`;
    const hist = this.townPlaces.get(tk) ?? new Map<number, number>();
    this.townPlaces.set(tk, hist);
    let major = -1;
    let majorN = 0;
    let total = 0;
    for (const [k, v] of hist) {
      total += v;
      if (v > majorN) [major, majorN] = [k, v];
    }
    if (total >= 5 && major !== p && !hist.has(p)) {
      this.glueEvents++;
      const gk = `${tk}:${p}`;
      const n = this.glueReported.get(gk) ?? 0;
      if (n < 3) {
        this.glueReported.set(gk, n + 1);
        const places = this.index.oracle.places;
        this.glueLines.push(
          `  [GLUE] ${file}:${line} ${char} town ${res.pos.townId} (majority ${places[major].label}) <- ` +
            `"${block.name}" of ${places[p].label} via ${res.kind} ` +
            `moved=${res.moved ? JSON.stringify(res.moved) : '-'} from="${before?.name ?? '-'}"` +
            `${res.merged ? ' MERGED' : ''}`
        );
      }
    }
    hist.set(p, (hist.get(p) ?? 0) + 1);
  }

  totals(): { wrong: number; checked: number } {
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    return { wrong: sum(this.wrong), checked: sum(this.checked) };
  }

  /** "W of C checked (x%) — expected w/c, ..." */
  describe(): string {
    const { wrong, checked } = this.totals();
    return (
      `${wrong} of ${checked} checked (${((wrong / Math.max(1, checked)) * 100).toFixed(2)}%) — ` +
      Object.entries(this.checked)
        .sort((a, b) => (this.wrong[b[0]] ?? 0) - (this.wrong[a[0]] ?? 0) || b[1] - a[1])
        .map(([k, v]) => `${k} ${this.wrong[k] ?? 0}/${v}`)
        .join(', ')
    );
  }

  sampleLines(cap: number): string[] {
    const classes = this.index.oracle.classes;
    return this.wrongList
      .slice(0, cap)
      .map(
        (w) =>
          `${w.file}:${w.line} ${w.char} ${w.kind} block "${classes[w.block].name}"(c${w.block}) -> ` +
          `t${w.town}#${w.roomId} which is c${w.room} "${classes[w.room].name}" from=#${w.from ?? '-'} ` +
          `moved=${w.moved ? JSON.stringify(w.moved) : '-'}`
      );
  }
}
