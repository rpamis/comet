#!/usr/bin/env bash

# Run one Agent turn after creating its runtime-only configuration.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/agent-runtime-config.sh"

AGENT="${1:?agent is required}"
MODEL="${2:-}"
PROMPT=""
PROMPT_FILE=""
PROMPT_STDIN=false
case "${3:?prompt is required}" in
    --prompt-file)
        PROMPT_FILE="${4:?prompt file is required}"
        [[ -f "$PROMPT_FILE" && -r "$PROMPT_FILE" ]] || { echo 'Prompt file is not readable' >&2; exit 2; }
        PROMPT_STDIN=true
        shift 4
        ;;
    --prompt-stdin)
        PROMPT_STDIN=true
        shift 3
        ;;
    *)
        PROMPT="$3"
        shift 3
        ;;
esac
if [[ "$PROMPT_STDIN" == true && "$AGENT" != claude-code && "$AGENT" != codex ]]; then
    echo 'This adapter has no verified prompt stdin contract' >&2
    exit 2
fi

EXTRA_ARGS=()
if [[ "${1:-}" == "--" ]]; then
    shift
    EXTRA_ARGS=("$@")
fi

prepare_agent_runtime_config "$AGENT" "$MODEL"

case "$AGENT" in
    claude-code)
        COMMAND=(claude -p)
        [[ "$PROMPT_STDIN" == true ]] || COMMAND+=("$PROMPT")
        COMMAND+=(--dangerously-skip-permissions --output-format stream-json --verbose)
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
    if [[ "$PROMPT_STDIN" == true ]]; then COMMAND+=(-); else COMMAND+=("$PROMPT"); fi
fi
COMMAND+=("${EXTRA_ARGS[@]}")
if [[ -n "$PROMPT_FILE" ]]; then
    capture_agent_runtime "$AGENT" "${COMET_EVAL_AGENT_ROLE:-subject}" "${COMMAND[@]}" < "$PROMPT_FILE"
else
    capture_agent_runtime "$AGENT" "${COMET_EVAL_AGENT_ROLE:-subject}" "${COMMAND[@]}"
fi
