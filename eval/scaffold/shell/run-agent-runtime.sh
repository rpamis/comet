#!/usr/bin/env bash

# Run one Agent turn after creating its runtime-only configuration.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/agent-runtime-config.sh"

AGENT="${1:?agent is required}"
MODEL="${2:-}"
PROMPT="${3:?prompt is required}"
shift 3 || true

EXTRA_ARGS=()
if [[ "${1:-}" == "--" ]]; then
    shift
    EXTRA_ARGS=("$@")
fi

prepare_agent_runtime_config "$AGENT" "$MODEL"

case "$AGENT" in
    claude-code)
        COMMAND=(claude -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose)
        ;;
    codex)
        COMMAND=(codex exec --json --yolo)
        ;;
    qoder)
        COMMAND=(qodercli -p "$PROMPT" --output-format stream-json --yolo)
        ;;
    codebuddy)
        COMMAND=(codebuddy -p "$PROMPT" --output-format stream-json --dangerously-skip-permissions)
        [[ -n "${CODEBUDDY_SETTINGS_PATH:-}" ]] && COMMAND+=(--settings "$CODEBUDDY_SETTINGS_PATH")
        ;;
    *)
        COMMAND=("${COMET_EVAL_CUSTOM_EXECUTABLE:?custom executable is required}" -p "$PROMPT" --output-format stream-json)
        ;;
esac

if [[ -n "$MODEL" ]]; then
    COMMAND+=(--model "$MODEL")
fi
if [[ "$AGENT" == "codex" ]]; then
    COMMAND+=("$PROMPT")
fi
COMMAND+=("${EXTRA_ARGS[@]}")
exec "${COMMAND[@]}"
