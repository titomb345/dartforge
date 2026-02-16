#!/usr/bin/env bash
# Reads bump type from CHANGELOG.md [Unreleased-<type>] header,
# bumps version in package.json + tauri.conf.json + Cargo.toml,
# and stamps the changelog with the new version and today's date.
#
# Usage: ./scripts/bump-version.sh
# (no arguments needed — bump type comes from the changelog)

set -euo pipefail

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

# Read current version from package.json
CURRENT=$(node -p "require('$ROOT/package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"
TODAY=$(date +%Y-%m-%d)

echo "Bump type: $TYPE"
echo "Version:   $CURRENT -> $NEW"
echo "Date:      $TODAY"
echo ""

# Update package.json
cd "$ROOT"
npm version "$NEW" --no-git-tag-version --allow-same-version

# Update tauri.conf.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" "$ROOT/src-tauri/tauri.conf.json"

# Update Cargo.toml (only the first version line — the package version)
sed -i "0,/^version = \"$CURRENT\"/s//version = \"$NEW\"/" "$ROOT/src-tauri/Cargo.toml"

# Stamp the changelog: replace [Unreleased-<type>] with [X.Y.Z] - YYYY-MM-DD
sed -i "s/^## \[Unreleased-$TYPE\]/## [$NEW] - $TODAY/" "$CHANGELOG"

echo "Done! Updated:"
echo "  - package.json"
echo "  - src-tauri/tauri.conf.json"
echo "  - src-tauri/Cargo.toml"
echo "  - CHANGELOG.md -> [$NEW] - $TODAY"
