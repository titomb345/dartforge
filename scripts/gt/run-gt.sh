#!/usr/bin/env bash
# Town-mapper ground truth — one entry point for the toolkit (Git Bash).
#
#   scripts/gt/run-gt.sh build [--out oracle.json]
#                       parse both corpora with the REAL TownParser
#                       (cache-blocks.ts, ~60s) and build the oracle
#                       (build-oracle.ts, ~5s). Default output:
#                       scripts/gt/.cache/oracle.json (+ oracle-report.txt).
#                       Build ONCE per corpus freeze and keep the file: the
#                       oracle is the measuring stick, rebuilding it from a
#                       grown corpus moves every number.
#   scripts/gt/run-gt.sh check <towns.json> [more stores...] [--details] [--place Eris] [--json out.json]
#                       ground-truth check of a map: replay-town.ts --out
#                       files (one per character), or a live map-<char>.json.
#                       Last line "GT-SUMMARY ..." is the A/B line.
#   scripts/gt/run-gt.sh truth [--place Eris] [--names] [--edges]
#                       room inventory per place / room name: distinct texts,
#                       physical rooms (lower bound), twins, walked adjacency
#   scripts/gt/run-gt.sh inspect <towns.json> <townId> <roomId|name>...
#                       one mapped room vs the oracle (class, links walked or not)
#   scripts/gt/run-gt.sh lost-blocks
#                       room blocks the parser drops on the line-intact MUSH corpus
#   scripts/gt/run-gt.sh rejoin-audit [--all-scope] [--joins]
#                       proves the TCP-fragment rejoin safe on the MUSH corpus
#                       and counts the DF blocks it recovers
#
# Environment (all optional):
#   DF_SESSIONS  DartForge session logs (default: the live Dropbox dir — it
#                keeps growing; measurements use a frozen copy)
#   DF_ALIASES   aliases.json used to expand logged input (default: live Dropbox file)
#   MUSH_LOGS    MUSHclient logs (default: Dropbox, 928 files 2021-04..2026-08)
#   GT_ORACLE    oracle file for check/truth/inspect (default scripts/gt/.cache/oracle.json)
#
# Oracle-backed replay metrics: npx tsx scripts/replay-town.ts --dartforge --oracle <oracle.json>
# The full validation (replays + checks + tests): scripts/town-validate.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cmd="${1:-}"
shift || true
case "$cmd" in
  build)
    out="$HERE/.cache/oracle.json"
    if [ "${1:-}" = "--out" ]; then out="$2"; fi
    npx tsx "$HERE/cache-blocks.ts" --cache "$HERE/.cache"
    npx tsx "$HERE/build-oracle.ts" --cache "$HERE/.cache" --out "$out" \
      --report "${out%.json}-report.txt"
    ;;
  check) npx tsx "$HERE/check-towns.ts" "$@" ;;
  truth) npx tsx "$HERE/report-truth.ts" "$@" ;;
  inspect) npx tsx "$HERE/inspect-room.ts" "$@" ;;
  lost-blocks) npx tsx "$HERE/lost-blocks.ts" "$@" ;;
  rejoin-audit) npx tsx "$HERE/rejoin-audit.ts" "$@" ;;
  *)
    sed -n '2,33p' "$0"
    exit 1
    ;;
esac
