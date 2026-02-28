#!/usr/bin/env bash
# Reads bump type from CHANGELOG.md [Unreleased-<type>] header,
# bumps version in package.json + tauri.conf.json + Cargo.toml,
# and stamps the changelog with the new version and today's date.
#
# Usage: ./scripts/bump-version.sh [--no-stamp]
#   --no-stamp  Update version files only (skip changelog stamp).
#               Useful for bumping the version locally during development.
#               npm run version:next is a shortcut for this.

set -euo pipefail

STAMP=true
for arg in "$@"; do
  case "$arg" in
    --no-stamp) STAMP=false ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="$ROOT/CHANGELOG.md"

# Extract bump type from [Unreleased-<type>] header
BUMP_LINE=$(grep -m1 '^\## \[Unreleased-' "$CHANGELOG" || true)
if [ -z "$BUMP_LINE" ]; then
  echo "No [Unreleased-<type>] section found in CHANGELOG.md"
  echo "Expected one of: [Unreleased-patch], [Unreleased-minor], [Unreleased-major]"
  exit 1
fi

TYPE=$(echo "$BUMP_LINE" | sed 's/.*Unreleased-\([a-z]*\).*/\1/')
if [[ "$TYPE" != "patch" && "$TYPE" != "minor" && "$TYPE" != "major" ]]; then
  echo "Invalid bump type '$TYPE' in CHANGELOG.md"
  echo "Expected one of: [Unreleased-patch], [Unreleased-minor], [Unreleased-major]"
  exit 1
fi

# Compute target version from the last stamped release in CHANGELOG.md
# (not from package.json — this makes the script idempotent)
BASE_LINE=$(grep -m1 '^\## \[[0-9]' "$CHANGELOG" || true)
if [ -z "$BASE_LINE" ]; then
  echo "No previous release found in CHANGELOG.md (expected ## [X.Y.Z] - date)"
  exit 1
fi
BASE=$(echo "$BASE_LINE" | sed 's/.*\[\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\].*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$BASE"

case "$TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"
cd "$ROOT"
CURRENT=$(node -p "require('./package.json').version")
TODAY=$(date +%Y-%m-%d)

echo "Bump type: $TYPE"
echo "Base:      $BASE (from last changelog release)"
echo "Version:   $CURRENT -> $NEW"
if [ "$STAMP" = true ]; then
  echo "Date:      $TODAY"
fi
echo ""

# Update package.json
npm version "$NEW" --no-git-tag-version --allow-same-version

# Update tauri.conf.json (match any semver, not just $CURRENT — idempotent)
sed -i 's/"version": "[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*"/"version": "'"$NEW"'"/' "$ROOT/src-tauri/tauri.conf.json"

# Update Cargo.toml (only the first version line — the package version)
sed -i '0,/^version = "[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*"/s//version = "'"$NEW"'"/' "$ROOT/src-tauri/Cargo.toml"

echo "Updated version files to $NEW"

# Stamp the changelog: replace [Unreleased-<type>] with [X.Y.Z] - YYYY-MM-DD
if [ "$STAMP" = true ]; then
  sed -i "s/^## \[Unreleased-$TYPE\]/## [$NEW] - $TODAY/" "$CHANGELOG"
  echo "Stamped CHANGELOG.md -> [$NEW] - $TODAY"
else
  echo "(changelog not stamped — use without --no-stamp to stamp)"
fi
