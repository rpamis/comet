#!/usr/bin/env bash

# Runtime-only Agent configuration. This file is mounted read-only from the
# Eval scaffold, while the generated config roots below are mounted as tmpfs
# by docker.sh. No credential is written to the image, workspace, report, or
# host filesystem.

toml_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
}

json_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/\\n}"
    value="${value//$'\r'/\\r}"
    value="${value//$'\t'/\\t}"
    printf '"%s"' "$value"
}

# Keep the CLI's argv and shell execution unchanged. A per-invocation token
# distinguishes our exit record from ordinary Agent output; it is not exported
# to the Agent. The Python process only timestamps the received JSONL stream.
capture_agent_runtime() {
    local agent="$1" role="$2"
    shift 2
    local token agent_status
    token=$(python3 "$SCRIPT_DIR/../python/stream_capture.py" --new-token) || return $?
    local -a pipeline_status
    if {
        if "$@"; then
            agent_status=0
        else
            agent_status=$?
        fi
        # A diagnostic may have no trailing newline. Start our record on its
        # own line so a failed command cannot hide its observed exit status.
        printf '\n{"type":"comet.eval.capture.end","token":"%s","exit_code":%s}\n' "$token" "$agent_status"
        exit "$agent_status"
    } | python3 "$SCRIPT_DIR/../python/stream_capture.py" --agent "$agent" --role "$role" --stream-token "$token"; then
        pipeline_status=("${PIPESTATUS[@]}")
    else
        pipeline_status=("${PIPESTATUS[@]}")
    fi
    if [[ "${pipeline_status[0]}" -ne 0 ]]; then
        return "${pipeline_status[0]}"
    fi
    return "${pipeline_status[1]}"
}

prepare_agent_runtime_config() {
    local agent="$1"
    local model="${2:-}"

    case "$agent" in
        codex)
            local config_root="${CODEX_HOME:-/home/agent/.codex}"
            local base_url="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
            mkdir -p "$config_root"
            {
                printf 'model_provider = "comet-eval"\n'
                if [[ -n "$model" ]]; then
                    printf 'model = '
                    toml_quote "$model"
                    printf '\n'
                fi
                printf '\n[model_providers.comet-eval]\n'
                printf 'name = "Comet Eval"\n'
                printf 'base_url = '
                toml_quote "$base_url"
                printf '\nenv_key = "OPENAI_API_KEY"\n'
                printf 'wire_api = "responses"\n'
                printf 'requires_openai_auth = false\n'
            } > "$config_root/config.toml"
            chmod 600 "$config_root/config.toml"
            ;;
        qoder)
            # Qoder documents PAT authentication through this environment
            # variable; keep its config root isolated from any host login.
            mkdir -p "${QODER_CONFIG_DIR:-/home/agent/.qoder}"
            ;;
        codebuddy)
            local config_root="${COMET_EVAL_CODEBUDDY_CONFIG_DIR:-/home/agent/.codebuddy}"
            local settings_path="$config_root/settings.json"
            local helper_path="$config_root/api-key-helper.sh"
            mkdir -p "$config_root"
            cat > "$helper_path" <<'EOF'
#!/usr/bin/env bash
printf '%s' "${CODEBUDDY_AUTH_TOKEN:-${CODEBUDDY_API_KEY:-}}"
EOF
            chmod 700 "$helper_path"
            {
                printf '{"apiKeyHelper":'
                json_quote "$helper_path"
                printf ',"env":{'
                local has_value=0
                if [[ -n "${CODEBUDDY_BASE_URL:-}" ]]; then
                    printf '"CODEBUDDY_BASE_URL":'
                    json_quote "$CODEBUDDY_BASE_URL"
                    has_value=1
                fi
                if [[ -n "$model" ]]; then
                    [[ "$has_value" -eq 1 ]] && printf ','
                    printf '"CODEBUDDY_MODEL":'
                    json_quote "$model"
                fi
                printf '}}\n'
            } > "$settings_path"
            chmod 600 "$settings_path"
            CODEBUDDY_SETTINGS_PATH="$settings_path"
            export CODEBUDDY_SETTINGS_PATH
            ;;
    esac
}
