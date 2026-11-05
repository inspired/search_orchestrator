#!/usr/bin/env bash
# Usage: scripts/package.sh [version]. Prints the path of the .tgz written to dist/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.0.1}"
APP=search_orchestrator
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$APP" "$ROOT/dist"
cp -R "$ROOT/app/$APP/." "$WORK/$APP/"
if [ -d "$ROOT/ui/stage" ]; then
  cp -R "$ROOT/ui/stage/." "$WORK/$APP/"
fi
find "$WORK" \( -name __pycache__ -o -name '*.pyc' -o -name '.*' -o -name '.DS_Store' \) -not -path "$WORK" -prune -exec rm -rf {} +
sed -i.bak "s/^version = .*/version = $VERSION/" "$WORK/$APP/default/app.conf"
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$WORK/$APP/app.manifest"
find "$WORK" -name '*.bak' -delete
find "$WORK" -type d -exec chmod 755 {} +
find "$WORK" -type f -exec chmod 644 {} +
chmod 755 "$WORK/$APP/bin/"*.py 2>/dev/null || true
OUT="$ROOT/dist/$APP-$VERSION.tgz"
rm -f "$OUT"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$OUT" -C "$WORK" "$APP" 2>/dev/null || COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$WORK" "$APP"
echo "$OUT"
