# Automapper Roadmap

## Background

The automapper was built but disabled because hex rooms kept colliding — many hexes share the same description text (weather, traffic, and seasons change it), causing the mapper to think you're in a previously-visited room and snap to the wrong position.

The fix: use **terrain fingerprints** derived from DartMUD's ASCII hex art. Every time you `survey` (or auto-survey on movement), the game renders a hex grid showing terrain of surrounding hexes. This terrain neighborhood pattern is like a GPS coordinate — it uniquely identifies your position on the world map.

## Step 1: Hex Art Parser (DONE)

**Files**: `src/lib/hexArtParser.ts`, `scripts/test-hex-parser.ts`

Built a parser that extracts terrain data from DartMUD's ASCII hex art and generates position fingerprints.

### What it does

- Detects hex art boundaries (borders, slopes, structural characters)
- Handles variable ring sizes: 0 rings (1 hex), 1 ring (7 hexes), 2 rings (19 hexes)
- Strips landmark text (`O) a ragged chasm`, multi-line continuations)
- Handles all structural variants: paths (`*`), roads (`=`), cliffs (`c`), wasteland edges (`x`), mixed borders
- Extracts terrain type per hex by character frequency counting
- Maps each hex to axial coordinates (q, r) relative to center
- Generates a deterministic fingerprint string: `center:ring1_terrains:ring2_terrains`

### Validation

- **158,885 surveys** parsed across 923 log files (5 years of play data)
- **100% success rate** on all supported hex art formats
- **1,294 unique fingerprints** found
- Ring distribution: 95.3% 1-ring, 3.5% 2-ring, 0.8% 0-ring

### Terrain character map

| Char | Terrain | ANSI Color |
|------|---------|------------|
| `.` | Plains | Bright green |
| `^` | Mountains | Red |
| `~` | Water/Ocean | Bright blue |
| `"` | Farmland | Bright yellow |
| `w` | Woods | Green |
| `h` | Hills | Yellow |
| `s` | Swamp | Cyan |
| `-` | Desert | Bright yellow |
| `x` | Wasteland | Bright black |

## Step 2: Fingerprint-Based Positioning System

Wire the parser into a positioning system that combines movement tracking with fingerprint verification.

### Layer 1 — Movement Tracking (always active)

Player types `n` → position = previous + north offset. Works at any vision level, even 0 rings.

**Improvements needed in `roomParser.ts`:**
- Fix `WILDERNESS_START_RE` false positives — "You are in perfect health." matches "You gaze at your surroundings." pattern, causing ~96 phantom room detections per day
- Add "You must swim" to `MOVE_FAIL_RE` (currently missing)
- Use "You gaze at your surroundings." as primary hex room trigger instead of description matching
- Add `collecting-hex-art` state: after trigger, collect hex art lines until art ends, then collect description + objects/NPCs

### Layer 2 — Fingerprint Verification (when vision allows)

On each survey, generate a terrain fingerprint and check it against the fingerprint database:

- **2 rings (19 hexes)**: High confidence — can determine absolute position and correct chain drift
- **1 ring (7 hexes)**: Moderate confidence — verify chain, detect errors
- **0 rings (1 hex)**: Low confidence — just terrain type, trust the movement chain

**Ring-agnostic matching**: The same hex with 1 vs 2 rings produces different fingerprint strings. To match across vision levels, truncate both fingerprints to the shortest common ring count before comparing. A 2-ring fingerprint `plains:wwhh.^~:...` contains the 1-ring fingerprint `plains:wwhh.^~` as a prefix.

### Fingerprint Database

Store fingerprints in the map graph (`mapGraph.ts`) alongside room nodes:

```typescript
interface HexRoom {
  id: string;           // unique room ID
  q: number;            // axial coordinate
  r: number;            // axial coordinate
  terrain: string;      // center hex terrain
  fingerprint1?: string; // 1-ring fingerprint (if ever seen)
  fingerprint2?: string; // 2-ring fingerprint (if ever seen)
}
```

Build a reverse lookup: `Map<string, HexRoom[]>` from fingerprint → room(s). Most fingerprints are unique; a few may have duplicates (especially 0-ring).

### Position Resolution Logic

On each survey:

1. Parse hex art → get fingerprint
2. Look up fingerprint in database
3. **Known fingerprint, matches chain position** → confirmed, no action needed
4. **Known fingerprint, doesn't match chain** → chain drifted, snap to fingerprint position
5. **Unknown fingerprint, chain is valid** → store fingerprint at chain position
6. **Unknown fingerprint, chain is broken** (teleportation) → create disconnected map island

### ANSI Color Enhancement (optional)

Each terrain type has a distinct ANSI color. The Rust backend currently strips ANSI before forwarding to the parser. Consider passing raw ANSI data to use color as a secondary terrain identification signal — especially useful when snow turns hexes white (overriding normal terrain color), which could indicate weather/season state.

## Step 3: Disconnected Islands & Map Merging

When the player teleports with poor vision:
- Movement chain breaks
- Fingerprint may be too weak (0-ring) to match known positions
- Create a **disconnected map island** — a separate coordinate space

Islands merge when the player walks from an island hex into one with a known fingerprint from the main map. At that point, translate all island coordinates to main-map coordinates and merge.

Over time, all islands connect into one unified world map.

## Step 4: Re-enable & Integrate

### Wire into App.tsx

- Re-enable the map toolbar button and panel
- Connect the new parser → positioning system → map graph → map renderer
- Add fingerprint matching to the survey event flow

### Handle Town Transitions

- Entering a town breaks hex tracking (towns aren't hex rooms)
- Leaving a town re-enters hexes — need to pick up position from fingerprint or start a new chain
- Detect town enter/exit transitions in roomParser

### Handle Teleportation

- Recall/teleport spells break the movement chain
- Rely on fingerprint matching to re-establish position
- If fingerprint is unknown, start a disconnected island (see Step 3)

### Update Help & Guide

- Update `src/lib/helpContent.ts` with automapper usage instructions
- Document the survey requirement (auto-survey on movement recommended)

## File Map

| File | Status | Purpose |
|------|--------|---------|
| `src/lib/hexArtParser.ts` | Done | ASCII hex art → terrain data + fingerprints |
| `scripts/test-hex-parser.ts` | Done | Log validation (dev tool) |
| `src/lib/roomParser.ts` | Needs update | Hex room detection, survey trigger, false-positive fixes |
| `src/lib/mapGraph.ts` | Needs update | Add fingerprint storage, reverse lookup, island merging |
| `src/hooks/useMapTracker.ts` | Needs update | Wire fingerprint positioning into React state |
| `src/App.tsx` | Needs update | Re-enable map panel |
| `src/lib/helpContent.ts` | Needs update | Document automapper usage |
