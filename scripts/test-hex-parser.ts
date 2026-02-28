/**
 * Test script — validates the hex art parser against historical MUD logs.
 *
 * Usage: npx tsx scripts/test-hex-parser.ts [--verbose] [--limit N] [--file pattern]
 *
 * Reads MUD logs from Dropbox, finds all "You gaze at your surroundings" instances,
 * parses the hex art, and reports accuracy statistics.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseHexArt, extractHexArtLines, generateFingerprint } from '../src/lib/hexArtParser';

const LOG_DIR = path.join('C:', 'Users', 'titom', 'Dropbox', 'MUSH', 'MUSHclient', 'logs');

// Parse CLI args
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const fileIdx = args.indexOf('--file');
const filePattern = fileIdx >= 0 ? args[fileIdx + 1] : undefined;

interface ParseResult {
  file: string;
  line: number;
  artLineCount: number;
  success: boolean;
  rings: number;
  hexCount: number;
  fingerprint: string;
  terrains: Map<string, string>;
  error?: string;
}

function processFile(filePath: string, fileName: string): ParseResult[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const results: ParseResult[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('You gaze at your surroundings')) continue;

    const artLines = extractHexArtLines(lines, i);

    if (!artLines) {
      results.push({
        file: fileName,
        line: i + 1,
        artLineCount: 0,
        success: false,
        rings: -1,
        hexCount: 0,
        fingerprint: '',
        terrains: new Map(),
        error: 'No hex art found after survey trigger',
      });
      continue;
    }

    const parsed = parseHexArt(artLines);

    if (!parsed) {
      results.push({
        file: fileName,
        line: i + 1,
        artLineCount: artLines.length,
        success: false,
        rings: -1,
        hexCount: 0,
        fingerprint: '',
        terrains: new Map(),
        error: `Failed to parse ${artLines.length}-line hex art`,
      });
      continue;
    }

    const fingerprint = generateFingerprint(parsed);

    results.push({
      file: fileName,
      line: i + 1,
      artLineCount: artLines.length,
      success: true,
      rings: parsed.rings,
      hexCount: parsed.hexes.size,
      fingerprint,
      terrains: parsed.hexes,
    });
  }

  return results;
}

// Main
console.log('Hex Art Parser Test Script');
console.log('=========================\n');

const allFiles = fs
  .readdirSync(LOG_DIR)
  .filter((f) => f.endsWith('.txt'))
  .filter((f) => !filePattern || f.includes(filePattern))
  .sort();

const filesToProcess = allFiles.slice(-Math.min(allFiles.length, limit === Infinity ? allFiles.length : limit));
console.log(`Processing ${filesToProcess.length} log files...\n`);

let totalSurveys = 0;
let totalSuccess = 0;
let totalFailed = 0;
const ringCounts: Record<number, number> = {};
const hexCountDist: Record<number, number> = {};
const terrainDist: Record<string, number> = {};
const fingerprints = new Set<string>();
const failures: ParseResult[] = [];

for (const file of filesToProcess) {
  const results = processFile(path.join(LOG_DIR, file), file);
  totalSurveys += results.length;

  for (const r of results) {
    if (r.success) {
      totalSuccess++;
      ringCounts[r.rings] = (ringCounts[r.rings] || 0) + 1;
      hexCountDist[r.hexCount] = (hexCountDist[r.hexCount] || 0) + 1;
      fingerprints.add(r.fingerprint);

      for (const [, terrain] of r.terrains) {
        terrainDist[terrain] = (terrainDist[terrain] || 0) + 1;
      }

      if (verbose) {
        console.log(`  OK: ${r.file}:${r.line} — ${r.rings} rings, ${r.hexCount} hexes`);
        console.log(`      Fingerprint: ${r.fingerprint}`);
        if (r.terrains.size <= 7) {
          for (const [coord, terrain] of r.terrains) {
            console.log(`      (${coord}): ${terrain}`);
          }
        }
      }
    } else {
      totalFailed++;
      failures.push(r);
      if (verbose) {
        console.log(`  FAIL: ${r.file}:${r.line} — ${r.error}`);
      }
    }
  }
}

// Report
console.log('\n--- Results ---\n');
console.log(`Total surveys found: ${totalSurveys}`);
console.log(`Successfully parsed: ${totalSuccess} (${((totalSuccess / totalSurveys) * 100).toFixed(1)}%)`);
console.log(`Failed:              ${totalFailed} (${((totalFailed / totalSurveys) * 100).toFixed(1)}%)`);

console.log('\nRing distribution:');
for (const [rings, count] of Object.entries(ringCounts).sort()) {
  console.log(`  ${rings} rings: ${count}`);
}

console.log('\nHex count distribution:');
for (const [count, freq] of Object.entries(hexCountDist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  ${count} hexes: ${freq}`);
}

console.log('\nTerrain distribution:');
for (const [terrain, count] of Object.entries(terrainDist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${terrain}: ${count}`);
}

console.log(`\nUnique fingerprints: ${fingerprints.size}`);

if (failures.length > 0) {
  console.log(`\n--- Failures (first 10) ---\n`);
  for (const f of failures.slice(0, 10)) {
    console.log(`  ${f.file}:${f.line} — ${f.error} (art lines: ${f.artLineCount})`);
  }
}
