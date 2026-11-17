#!/usr/bin/env bash
# Usage: scripts/package.sh [version]. Prints the path of the .tgz written to dist/.
# SO_VARIANT_SUFFIX=<suffix> builds a side-by-side test copy, search_orchestrator_<suffix>
# (scripts/package_variant.sh; the renames are in scripts/variant_rename.py).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.0.1}"
APP=search_orchestrator
SUFFIX="${SO_VARIANT_SUFFIX:-}"
if [ -n "$SUFFIX" ] && ! [[ "$SUFFIX" =~ ^[a-z0-9]+$ ]]; then
  echo "package.sh: SO_VARIANT_SUFFIX must be lowercase letters and digits" >&2
  exit 2
fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
UI="${SO_UI_DIR:-$ROOT/ui}"  # SO_UI_DIR: tests point this at a stand-in ui/
mkdir -p "$WORK/$APP" "$ROOT/dist"
cp -R "$ROOT/app/$APP/." "$WORK/$APP/"
if [ -d "$UI" ]; then
  # Always ship a fresh UI build, never a stale or missing ui/stage.
  SO_SUFFIX="${SUFFIX:+_$SUFFIX}" npm --prefix "$UI" run build >&2
  if [ ! -d "$UI/stage" ]; then
    echo "package.sh: ui/stage is missing after npm run build; not packaging" >&2
    exit 1
  fi
  cp -R "$UI/stage/." "$WORK/$APP/"
fi
find "$WORK" \( -name __pycache__ -o -name '*.pyc' -o -name '.*' -o -name '.DS_Store' \) -not -path "$WORK" -prune -exec rm -rf {} +
sed -i.bak "s/^version = .*/version = $VERSION/" "$WORK/$APP/default/app.conf"
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$WORK/$APP/app.manifest"
find "$WORK" -name '*.bak' -delete
if [ -n "$SUFFIX" ]; then
  python3 "$ROOT/scripts/variant_rename.py" "$WORK/$APP" "$SUFFIX"
  mv "$WORK/$APP" "$WORK/${APP}_$SUFFIX"
  APP="${APP}_$SUFFIX"
fi
find "$WORK" -type d -exec chmod 755 {} +
find "$WORK" -type f -exec chmod 644 {} +
chmod 755 "$WORK/$APP/bin/"*.py 2>/dev/null || true
OUT="$ROOT/dist/$APP-$VERSION.tgz"
rm -f "$OUT"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$OUT" -C "$WORK" "$APP" 2>/dev/null || COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$WORK" "$APP"
echo "$OUT"
