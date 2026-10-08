#!/usr/bin/env bash
set -euo pipefail
runtime="/opt/comet-current"
if [[ ! -f "$runtime/bin/comet.js" || ! -d "$runtime/dist" || ! -f "$runtime/assets/manifest.json" || ! -d "$runtime/node_modules" ]]; then
    echo "Current Comet SDK snapshot is unavailable" >&2
    exit 2
fi
# Application modules import the SDK that dispatches their Run.
# This link exists only inside the isolated /workspace mount.
mkdir -p /workspace/node_modules/@rpamis
ln -sfn "$runtime" /workspace/node_modules/@rpamis/comet
exec node "$runtime/bin/comet.js" "$@"
