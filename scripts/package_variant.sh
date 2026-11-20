#!/usr/bin/env bash
# Usage: scripts/package_variant.sh <suffix> [version], e.g. scripts/package_variant.sh dev 1.13.0.
# Builds dist/search_orchestrator_<suffix>-<version>.tgz: the same package as scripts/package.sh,
# with every Splunk-wide name suffixed (scripts/variant_rename.py) so it installs next to
# the normal app on the same server. Prints the path of the .tgz.
set -euo pipefail
[ $# -ge 1 ] && [ $# -le 2 ] || { echo "usage: $0 <suffix> [version]" >&2; exit 2; }
exec env SO_VARIANT_SUFFIX="$1" "$(cd "$(dirname "$0")" && pwd)/package.sh" "${2:-0.0.1}"
