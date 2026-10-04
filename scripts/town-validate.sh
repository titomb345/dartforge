#!/usr/bin/env bash
# One-shot town-mapper validation (Git Bash). Gate every town-engine change
# on it and compare its blocks against the previous run.
#
#   bash scripts/town-validate.sh [--df-dir D] [--aliases F] [--oracle O] [--out DIR]
#        [--modes "pc late"] [--flags "<extra replay-town.ts flags>"] [--no-tests]
#
# Runs in parallel, against ONE corpus and ONE oracle:
#   pc      live-faithful replay (per-character stores, TCP fragments
#           rejoined, concurrent app instances skipped) + ground-truth check
#   late    the same with --switch-late: the login race of the app before
#           the Oct 2026 login hold (a name typed at Name: resolved the
#           login burst's first room in the PREVIOUS character's map)
#   tests   scripts/test-town.ts
# Reference modes (--modes): single (one shared store), raw (no rejoin),
# legacy (single store + raw lines + nested files kept = the pre-Oct-2026
# harness).
# Prints one compact block per mode (scripts/gt/validate-summary.ts): the
# inputs actually used, the resolution kinds, link misses, lost blocks,
# rooms, excess duplicates, the oracle's TRUE wrong-room count, the
# checker's GT-SUMMARY line, the layout line (cardinal link geometry,
# stretches, nudges and the grid audit: rooms sharing a cell, grid index
# errors; both 0 on a sound map) and the test count. Full outputs (replay
# text/json, per-character town stores, check reports) stay in --out; a
# mode's previous outputs there are deleted before it runs, so reusing
# --out never mixes in stale stores. Exits non-zero when an input is
# missing or any mode or test fails.
#
# Inputs fall back to DF_SESSIONS / DF_ALIASES / GT_ORACLE, then the live
# Dropbox dirs and scripts/gt/.cache/oracle.json (scripts/gt/run-gt.sh build).
# Measure against a FROZEN corpus copy and a fixed oracle — the live dirs
# grow daily and every number moves with them.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Absolute on purpose: the runner cd's into the repo below, so a relative
# --df-dir/--aliases/--oracle/--out must be resolved against the CALLER's
# directory first (cygpath -m alone keeps a relative path relative).
winpath() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -am "$1"
  elif command -v realpath >/dev/null 2>&1; then
    realpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

DF_DIR="${DF_SESSIONS:-C:/Users/titom/Dropbox/DM/Dartforge/sessions}"
ALIASES="${DF_ALIASES:-C:/Users/titom/Dropbox/DM/Dartforge/aliases.json}"
ORACLE="${GT_ORACLE:-$REPO/scripts/gt/.cache/oracle.json}"
OUT="$REPO/scripts/gt/.cache/validate/$(date +%Y%m%d-%H%M%S)"
MODES="pc late"
EXTRA=""
TESTS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --df-dir) DF_DIR="$2"; shift 2 ;;
    --aliases) ALIASES="$2"; shift 2 ;;
    --oracle) ORACLE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --modes) MODES="$2"; shift 2 ;;
    --flags) EXTRA="$2"; shift 2 ;;
    --no-tests) TESTS=0; shift ;;
    -h|--help) sed -n '/^set -uo pipefail/q; 2,$p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# A wrong input path must stop the gate: a replay without its aliases or
# corpus runs fine and reports numbers that are simply wrong
if [ ! -d "$DF_DIR" ]; then
  echo "session-log corpus not found: $DF_DIR (--df-dir / DF_SESSIONS)" >&2
  exit 2
fi
LOGS=$(ls "$DF_DIR" | grep -c '\.log$')
if [ "$LOGS" -eq 0 ]; then
  echo "no session logs (*.log) in $DF_DIR" >&2
  exit 2
fi
if [ ! -f "$ALIASES" ]; then
  echo "aliases file not found: $ALIASES (--aliases / DF_ALIASES)" >&2
  exit 2
fi
if [ ! -f "$ORACLE" ]; then
  echo "oracle not found: $ORACLE (build one: bash scripts/gt/run-gt.sh build)" >&2
  exit 2
fi
mkdir -p "$OUT"
DF_DIR="$(winpath "$DF_DIR")"; ALIASES="$(winpath "$ALIASES")"
ORACLE="$(winpath "$ORACLE")"; OUT="$(winpath "$OUT")"
cd "$REPO"

mode_flags() {
  case "$1" in
    pc) echo "" ;;
    late) echo "--switch-late" ;;
    single) echo "--single-store" ;;
    raw) echo "--no-rejoin" ;;
    legacy) echo "--single-store --no-rejoin --keep-nested" ;;
    *) echo "unknown mode $1" >&2; return 1 ;;
  esac
}
mode_label() {
  case "$1" in
    pc) echo "live-faithful (per-character stores)" ;;
    late) echo "pre-hold login race (--switch-late: typed logins switch after the login burst)" ;;
    single) echo "reference: single shared store" ;;
    raw) echo "reference: raw log lines (no rejoin)" ;;
    legacy) echo "reference: legacy harness (single store, raw lines, nested files kept)" ;;
    *) echo "$1" ;;
  esac
}

run_mode() {
  local m="$1" flags
  # A previous run's outputs in a reused --out would be globbed into the
  # ground-truth check (stale per-character stores) or summarized as current
  rm -f "$OUT/$m.ok" "$OUT/$m.txt" "$OUT/$m.json" "$OUT/$m-check.json" "$OUT/$m-check.txt" \
    "$OUT/$m-towns"*.json
  flags="$(mode_flags "$m")" || return 1
  # shellcheck disable=SC2086
  npx tsx scripts/replay-town.ts --dartforge --df-dir "$DF_DIR" --aliases "$ALIASES" \
    --oracle "$ORACLE" --tag-origins --json "$OUT/$m.json" --out "$OUT/$m-towns.json" \
    $flags $EXTRA > "$OUT/$m.txt" 2>&1 || { echo "replay $m FAILED (see $OUT/$m.txt)" >&2; return 1; }
  local stores=("$OUT/$m-towns"*.json)
  npx tsx scripts/gt/check-towns.ts "${stores[@]}" --oracle "$ORACLE" --json "$OUT/$m-check.json" \
    > "$OUT/$m-check.txt" 2>&1 || { echo "check $m FAILED (see $OUT/$m-check.txt)" >&2; return 1; }
  touch "$OUT/$m.ok"
}

start=$(date +%s)
declare -A PIDS
for m in $MODES; do
  run_mode "$m" &
  PIDS[$m]=$!
done
if [ "$TESTS" = 1 ]; then
  rm -f "$OUT/tests.txt"
  npx tsx scripts/test-town.ts > "$OUT/tests.txt" 2>&1 &
  TESTS_PID=$!
fi
status=0
for m in $MODES; do wait "${PIDS[$m]}" || status=1; done
if [ "$TESTS" = 1 ]; then wait "$TESTS_PID" || status=1; fi

echo "Town-mapper validation — corpus $DF_DIR ($LOGS logs), aliases $ALIASES, oracle $ORACLE"
echo "Outputs: $OUT"
for m in $MODES; do
  echo
  if [ -f "$OUT/$m.ok" ]; then
    npx tsx scripts/gt/validate-summary.ts "$(mode_label "$m")" "$OUT/$m.json" "$OUT/$m-check.txt" ||
      status=1
  else
    echo "== $(mode_label "$m") == FAILED"
    for f in "$OUT/$m.txt" "$OUT/$m-check.txt"; do
      [ -s "$f" ] && tail -5 "$f" | sed 's/^/   | /'
    done
  fi
done
if [ "$TESTS" = 1 ]; then
  echo
  echo "tests    $(grep -E 'town regression tests passed' "$OUT/tests.txt" | tail -1)"
  grep -E '^FAIL ' "$OUT/tests.txt" || true
fi
echo
echo "($(($(date +%s) - start))s)"
exit $status
