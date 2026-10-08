#!/usr/bin/env bash
set -euo pipefail

runtime="/opt/comet-current"
if [[ ! -f "$runtime/bin/comet.js" || ! -d "$runtime/dist" || ! -f "$runtime/assets/manifest.json" || ! -d "$runtime/node_modules" ]]; then
    echo "Current Comet CLI snapshot is unavailable" >&2
    exit 2
fi

exec node "$runtime/bin/comet.js" "$@"
