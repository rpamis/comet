#!/usr/bin/env bash
set -euo pipefail

snapshot="/workspace/_eval_current_comet"
if [[ ! -f "$snapshot/bin/comet.js" || ! -d "$snapshot/dist" ]]; then
    echo "Current Comet CLI snapshot is unavailable" >&2
    exit 2
fi

runtime="$(mktemp -d)"
trap 'rm -rf "$runtime"' EXIT
cp -a "$snapshot/." "$runtime/"
ln -s /opt/comet-cli/node_modules "$runtime/node_modules"
node "$runtime/bin/comet.js" "$@"
