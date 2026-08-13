#!/usr/bin/env bash
# Multi-turn agent driver for interactive workflow eval.
#
# Runs the primary subject agent with the task prompt, then when it pauses
# at a decision point (asks the user a question), drives a lightweight
# "user-simulator" turn to answer, feeding the answer back via --resume.
# Both calls share the same container HOME so session state persists.
#
# Usage: run-claude-loop.sh <prompt|@prompt-file> [--agent AGENT] [--max-turns N] [--model MODEL]
#   --max-turns N             Maximum number of subject<->simulator round trips (default 12)
#   --model MODEL             Model for both subject and simulator
#   --simulator-prompt-file   File containing the simulator system prompt
#   --decision-reply TEXT     Deterministic reply for each detected decision point
#   --decision-reply-step TEXT  Queue one deterministic reply for the next decision point
#   --continue-prompt TEXT    Nudge used when the workflow should continue
#   --decision-pattern TEXT   Extra case-insensitive substring to treat as a decision point
#   --fresh-resume-marker TEXT  Start the following turn in a new subject session
#
# Env: ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL for the proxy.
# Stdout: concatenated stream-json from every subject turn (for event extraction).
# Stderr: driver progress log.

set -uo pipefail
shopt -s nocasematch

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/agent-runtime-config.sh"

PROMPT_ARG="${1:?usage: run-claude-loop.sh <prompt|@prompt-file> [--max-turns N]}"
shift || true

if [[ "$PROMPT_ARG" == @* ]]; then
    PROMPT="$(cat "${PROMPT_ARG#@}")"
else
    PROMPT="$PROMPT_ARG"
fi

MAX_TURNS=12
AGENT="claude-code"
MODEL=""
SIMULATOR_PROMPT=""
DECISION_REPLY=""
DECISION_REPLY_STEPS=()
CONTINUE_PROMPT="Please continue with the next phase of the comet workflow."
FRESH_RESUME_MARKER=""
DECISION_PATTERNS=()
PLUGIN_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --agent) AGENT="$2"; shift 2 ;;
        --max-turns) MAX_TURNS="$2"; shift 2 ;;
        --model) MODEL="$2"; shift 2 ;;
        --plugin-dir)
            PLUGIN_ARGS+=(--plugin-dir "$2")
            shift 2
            ;;
        --simulator-prompt-file)
            SIMULATOR_PROMPT_FILE="$2"
            if ! SIMULATOR_PROMPT="$(cat -- "$SIMULATOR_PROMPT_FILE")"; then
                echo "[loop] unable to read private simulator prompt" >&2
                exit 2
            fi
            if ! rm -f -- "$SIMULATOR_PROMPT_FILE"; then
                echo "[loop] unable to remove private simulator prompt" >&2
                exit 2
            fi
            shift 2
            ;;
        --decision-reply) DECISION_REPLY="$2"; shift 2 ;;
        --decision-reply-step)
            DECISION_REPLY_STEPS+=("$2")
            shift 2
            ;;
        --continue-prompt) CONTINUE_PROMPT="$2"; shift 2 ;;
        --fresh-resume-marker) FRESH_RESUME_MARKER="$2"; shift 2 ;;
        --decision-pattern)
            DECISION_PATTERNS+=("$2")
            shift 2
            ;;
        *) shift ;;
    esac
done

case "$AGENT" in
    claude-code|codex|qoder|codebuddy) ;;
    *)
        if [[ "${COMET_EVAL_CUSTOM_AGENT_ID:-}" != "$AGENT" || -z "${COMET_EVAL_CUSTOM_EXECUTABLE:-}" ]]; then
            echo "[loop] unsupported evaluation agent: $AGENT" >&2
            exit 2
        fi
        ;;
esac
if [[ -z "$MODEL" ]]; then
    case "$AGENT" in
        claude-code) MODEL="${ANTHROPIC_MODEL:-}" ;;
        codex) MODEL="${OPENAI_MODEL:-${CODEX_MODEL:-}}" ;;
        qoder) MODEL="${QODER_MODEL:-}" ;;
        codebuddy) MODEL="${CODEBUDDY_MODEL:-}" ;;
    esac
fi
MODEL_FLAG=()
[[ -n "$MODEL" ]] && MODEL_FLAG=(--model "$MODEL")
prepare_agent_runtime_config "$AGENT" "$MODEL"
CODEBUDDY_SETTINGS_FLAG=()
[[ -n "${CODEBUDDY_SETTINGS_PATH:-}" ]] && CODEBUDDY_SETTINGS_FLAG=(--settings "$CODEBUDDY_SETTINGS_PATH")

run_agent_turn() {
    local prompt="$1"
    local resume_id="${2:-}"
    local role="${3:-subject}"
    local role_plugin_args=()
    if [[ "$role" == "subject" ]]; then
        role_plugin_args=("${PLUGIN_ARGS[@]}")
    fi
    case "$AGENT" in
        claude-code)
            if [[ -n "$resume_id" ]]; then
                COMET_EVAL_AGENT_ROLE="$role" claude -p "$prompt" "${role_plugin_args[@]}" "${MODEL_FLAG[@]}" \
                    --resume "$resume_id" --output-format stream-json --verbose \
                    --dangerously-skip-permissions
            else
                COMET_EVAL_AGENT_ROLE="$role" claude -p "$prompt" "${role_plugin_args[@]}" "${MODEL_FLAG[@]}" \
                    --output-format stream-json --verbose --dangerously-skip-permissions
            fi
            ;;
        codex)
            if [[ -n "$resume_id" ]]; then
                COMET_EVAL_AGENT_ROLE="$role" codex exec resume "$resume_id" --json --yolo "${MODEL_FLAG[@]}" "$prompt"
            else
                COMET_EVAL_AGENT_ROLE="$role" codex exec --json --yolo "${MODEL_FLAG[@]}" "$prompt"
            fi
            ;;
        qoder)
            if [[ -n "$resume_id" ]]; then
                COMET_EVAL_AGENT_ROLE="$role" qodercli -p "$prompt" --output-format stream-json --yolo \
                    "${MODEL_FLAG[@]}" -r "$resume_id"
            else
                COMET_EVAL_AGENT_ROLE="$role" qodercli -p "$prompt" --output-format stream-json --yolo "${MODEL_FLAG[@]}"
            fi
            ;;
        codebuddy)
            if [[ -n "$resume_id" ]]; then
                COMET_EVAL_AGENT_ROLE="$role" codebuddy -p "$prompt" --output-format stream-json \
                    --dangerously-skip-permissions "${MODEL_FLAG[@]}" "${CODEBUDDY_SETTINGS_FLAG[@]}" -r "$resume_id"
            else
                COMET_EVAL_AGENT_ROLE="$role" codebuddy -p "$prompt" --output-format stream-json \
                    --dangerously-skip-permissions "${MODEL_FLAG[@]}" "${CODEBUDDY_SETTINGS_FLAG[@]}"
            fi
            ;;
        *)
            if [[ -n "$resume_id" ]]; then
                COMET_EVAL_AGENT_ROLE="$role" "$COMET_EVAL_CUSTOM_EXECUTABLE" -p "$prompt" \
                    --output-format stream-json "${MODEL_FLAG[@]}" --resume "$resume_id"
            else
                COMET_EVAL_AGENT_ROLE="$role" "$COMET_EVAL_CUSTOM_EXECUTABLE" -p "$prompt" \
                    --output-format stream-json "${MODEL_FLAG[@]}"
            fi
            ;;
    esac
}

extract_session_id() {
    python3 -c '
import json, sys
for line in sys.stdin:
    try:
        value = json.loads(line)
    except Exception:
        continue
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            for key in ("session_id", "sessionId", "thread_id", "threadId"):
                candidate = item.get(key)
                if isinstance(candidate, str) and candidate:
                    print(candidate)
                    raise SystemExit(0)
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
'
}

# Detect whether the last subject turn is waiting on the user. comet decision
# points present as a question / confirmation request with no pending tool call.
# Drive the user-simulator: given the subject's last message, produce a concise
# affirmative/clarifying reply that lets the workflow proceed.
simulate_user() {
    local subject_text="$1"
    local sim_prompt
    if [[ -n "$SIMULATOR_PROMPT" ]]; then
        sim_prompt=$(cat <<EOF
${SIMULATOR_PROMPT}

Assistant's message:
"""
${subject_text:0:3000}
"""
EOF
)
    else
        sim_prompt=$(cat <<EOF
You are simulating a developer user in an automated eval. The AI assistant below is running the Comet development workflow and has paused to ask you something. Read its message and reply with a SHORT (1-3 sentences) response that:
- Approves the proposed approach / name / plan when asked to confirm
- Picks the most reasonable default option when asked to choose
- Asks for clarification only if the question is truly ambiguous about WHAT to build
Never refuse; always let the workflow move forward. Do not write code or files.

Assistant's message:
"""
${subject_text:0:3000}
"""
EOF
)
    fi
    # Run the simulator through the same adapter command in a fresh session,
    # retaining only bounded role/session evidence in the driver log.
    local sim_raw sim_session sim_reply
    sim_raw=$(run_agent_turn "$sim_prompt" "" "simulator" 2>/dev/null) || return $?
    sim_session=$(printf '%s' "$sim_raw" | extract_session_id) || true
    if [[ -n "$sim_session" ]]; then
        echo "[loop] role-session simulator $sim_session" >&2
    fi
    sim_reply=$(printf '%s' "$sim_raw" | extract_last_agent_text)
    printf '%s' "$sim_reply"
}

extract_last_agent_text() {
    python3 -c '
import json, sys
values = []
def visit(value):
    if isinstance(value, dict):
        for key in ("result", "text"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                values.append(item)
        for item in value.values():
            visit(item)
    elif isinstance(value, list):
        for item in value:
            visit(item)
for line in sys.stdin:
    try:
        visit(json.loads(line))
    except Exception:
        pass
print(values[-1] if values else "")
'
}

SESSION_ID=""
FRESH_PROMPT=""
COMBINED_OUT=""
TURN=0
DECISION_REPLY_STEP_INDEX=0

while [[ $TURN -lt $MAX_TURNS ]]; do
    TURN=$((TURN + 1))
    echo "[loop] turn $TURN/$MAX_TURNS" >&2
    SUBJECT_STDERR=$(mktemp)

    if [[ -z "$SESSION_ID" ]]; then
        # The first turn uses the task prompt. A requested cold-resume boundary
        # starts another session with only the continuation prompt.
        SUBJECT_PROMPT="${FRESH_PROMPT:-$PROMPT}"
        FRESH_PROMPT=""
        RAW=$(run_agent_turn "$SUBJECT_PROMPT" "" "subject" 2>"$SUBJECT_STDERR")
        SUBJECT_STATUS=$?
    else
        # Subsequent turns: resume the session with the simulated user reply.
        RAW=$(run_agent_turn "$USER_REPLY" "$SESSION_ID" "subject" 2>"$SUBJECT_STDERR")
        SUBJECT_STATUS=$?
    fi

    if [[ $SUBJECT_STATUS -ne 0 ]]; then
        echo "[loop] subject turn $TURN failed (exit $SUBJECT_STATUS)" >&2
        # Some Claude CLI failures write their diagnostic to stdout.  The
        # command substitution above preserves it, so include it alongside
        # stderr rather than turning a diagnosable subject failure into an
        # opaque no-events sample.
        if [[ -n "$RAW" ]]; then
            echo "[loop] subject stdout:" >&2
            printf '%s\n' "$RAW" >&2
        fi
        cat "$SUBJECT_STDERR" >&2
        rm -f "$SUBJECT_STDERR"
        exit "$SUBJECT_STATUS"
    fi
    rm -f "$SUBJECT_STDERR"

    COMBINED_OUT="${COMBINED_OUT}${RAW}"$'\n'

    # Extract session id and the final assistant text from this turn.
    SESSION_ID=$(printf '%s' "$RAW" | extract_session_id) || true
    if [[ -n "$SESSION_ID" ]]; then
        echo "[loop] role-session subject $SESSION_ID" >&2
    fi

    # Pull the result text (type=result) for decision-point detection.
    RESULT_TEXT=$(echo "$RAW" | grep '"type": *"result"' | tail -1 | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('result',''))" 2>/dev/null || echo "")
    # Fallback: last assistant text block.
    if [[ -z "$RESULT_TEXT" ]]; then
        RESULT_TEXT=$(echo "$RAW" | grep '"type": *"assistant"' | tail -1 | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    c=d.get('message',{}).get('content',[])
    print(' '.join(i.get('text','') for i in c if isinstance(i,dict) and i.get('type')=='text'))
except: print('')
" 2>/dev/null || echo "")
    fi
    if [[ -z "$RESULT_TEXT" ]]; then
        RESULT_TEXT=$(printf '%s\n' "$RAW" | extract_last_agent_text)
    fi

    if [[ -z "$RESULT_TEXT" ]]; then
        echo "[loop] no result text; ending" >&2
        break
    fi

    if [[ -n "$FRESH_RESUME_MARKER" && "$RESULT_TEXT" == *"$FRESH_RESUME_MARKER"* ]]; then
        echo "[loop] fresh resume boundary detected; starting a new subject session" >&2
        SESSION_ID=""
        FRESH_PROMPT="$CONTINUE_PROMPT"
        continue
    fi

    # Completion is task-validated from exported artifacts after the loop. Stop
    # only on an explicit, non-negated workflow/archive completion statement.
    if bash "$SCRIPT_DIR/completion-point.sh" "$RESULT_TEXT"; then
        echo "[loop] workflow completion detected; ending" >&2
        break
    fi

    if bash "$SCRIPT_DIR/decision-point.sh" "$RESULT_TEXT" "${DECISION_PATTERNS[@]}"; then
        echo "[loop] decision point detected; simulating user reply" >&2
        if [[ ${#DECISION_REPLY_STEPS[@]} -gt 0 ]]; then
            if [[ $DECISION_REPLY_STEP_INDEX -ge ${#DECISION_REPLY_STEPS[@]} ]]; then
                echo "[loop] deterministic decision reply queue exhausted" >&2
                exit 3
            fi
            USER_REPLY="${DECISION_REPLY_STEPS[$DECISION_REPLY_STEP_INDEX]}"
            DECISION_REPLY_STEP_INDEX=$((DECISION_REPLY_STEP_INDEX + 1))
            echo "[loop] deterministic decision reply applied" >&2
        elif [[ -n "$DECISION_REPLY" ]]; then
            USER_REPLY="$DECISION_REPLY"
            echo "[loop] deterministic decision reply applied" >&2
        else
            USER_REPLY=$(simulate_user "$RESULT_TEXT")
            SIMULATOR_STATUS=$?
            if [[ $SIMULATOR_STATUS -ne 0 ]]; then
                echo "[loop] simulator turn failed (exit $SIMULATOR_STATUS)" >&2
                exit "$SIMULATOR_STATUS"
            fi
        fi
        if [[ -z "$USER_REPLY" ]]; then
            USER_REPLY="Yes, please proceed with the recommended option."
        fi
        echo "[loop] simulated reply (${#USER_REPLY} chars)" >&2
        continue
    fi

    # If the result has no question and isn't complete, the subject likely finished
    # its turn naturally — try one more nudge to keep going, then stop.
    echo "[loop] no decision point and not complete; nudging to continue" >&2
    USER_REPLY="$CONTINUE_PROMPT"
done

echo "[loop] finished after $TURN turns" >&2
# Emit the combined stream-json on stdout for the harness to parse.
printf '%s' "$COMBINED_OUT"
