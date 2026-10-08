#!/usr/bin/env bash
set -euo pipefail
snapshot="/workspace/_eval_current_comet"
if [[ ! -f "$snapshot/bin/comet.js" || ! -d "$snapshot/dist" ]]; then
    echo "Current Comet SDK snapshot is unavailable" >&2
    exit 2
fi
runtime="$(mktemp -d)"
trap 'rm -rf "$runtime"' EXIT
cp -a "$snapshot/." "$runtime/"
ln -s /opt/comet-cli/node_modules "$runtime/node_modules"
# Application modules import the SDK that dispatches their Run.
# This link exists only inside the isolated /workspace mount.
mkdir -p /workspace/node_modules/@rpamis
ln -sfn "$runtime" /workspace/node_modules/@rpamis/comet
node "$runtime/bin/comet.js" "$@"
