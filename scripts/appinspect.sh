#!/usr/bin/env bash
# Usage: scripts/appinspect.sh <tgz>. Exits non-zero on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -eq 1 ] || { echo "usage: $0 <tgz>" >&2; exit 2; }
OUTJSON="$(mktemp)"
trap 'rm -f "$OUTJSON"' EXIT
set +e
"$ROOT/.venv/bin/splunk-appinspect" inspect "$1" --mode precert --included-tags cloud --output-file "$OUTJSON" --data-format json
set -e
"$ROOT/.venv/bin/python" - "$OUTJSON" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))["summary"]
print("AppInspect summary:", s)
sys.exit(1 if s.get("failure", 0) or s.get("error", 0) else 0)
PY
