#!/usr/bin/env bash
# Docker utilities for test orchestration
# Language-agnostic interface - call from Python, JS, or CLI
#
# Usage:
#   ./docker.sh check
#   ./docker.sh build <directory> [--force]
#   ./docker.sh run <directory> <command...>
#   ./docker.sh run-python <directory> <script.py> [args...]
#   ./docker.sh run-agent <directory> <prompt> --agent AGENT [--model MODEL] [--timeout SECONDS]

set -euo pipefail

# Docker on Windows runs as a native binary needing Windows-style host paths,
# but git-bash (MSYS) rewrites POSIX-looking args. We want:
#   - host paths (build context, volume source) in Windows form (C:\ or C:/)
#   - container-internal paths (-w /workspace, image refs) left as POSIX
# MSYS_NO_PATHCONV=1 stops ALL conversion, which breaks host paths. Instead we
# disable the leading-slash heuristic only for args that are container paths,
# by prefixing them with a double slash (//workspace) which MSYS leaves alone
# and docker treats as /workspace. The host paths we pass are already normalised
# to forward-slash drive form by the Python layer (_to_bash_path).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Normalise a host path to Windows drive form for docker.exe on Windows.
# git-bash may hand us /d/... which docker.exe (a native binary) cannot resolve.
# cygpath -w converts reliably when available; otherwise leave as-is on unix.
_winpath() {
    local p="$1"
    if command -v cygpath &> /dev/null; then
        cygpath -w "$p"
    else
        printf '%s' "$p"
    fi
}

# Image prefix for all benchmark images
IMAGE_PREFIX="skillbench"

# Claude Code version (configurable via env var, defaults to "latest")
CLAUDE_CODE_VERSION="${BENCH_CC_VERSION:-latest}"
CODEX_VERSION="${BENCH_CODEX_VERSION:-latest}"
QODER_VERSION="${BENCH_QODER_VERSION:-latest}"
CODEBUDDY_VERSION="${BENCH_CODEBUDDY_VERSION:-latest}"
DEFAULT_AGENT="${BENCH_EVAL_AGENT:-claude-code}"
LANGFUSE_ENABLED="${TRACE_TO_LANGFUSE:-false}"

# Cross-platform timeout command (macOS uses gtimeout from coreutils)
TIMEOUT_CMD=""
if command -v gtimeout &> /dev/null; then
    TIMEOUT_CMD="gtimeout"
elif command -v timeout &> /dev/null; then
    TIMEOUT_CMD="timeout"
fi

# API keys to pass through to containers
ENV_KEYS=(
    OPENAI_API_KEY
    OPENAI_BASE_URL
    OPENAI_MODEL
    CODEX_API_KEY
    CODEX_BASE_URL
    CODEX_MODEL
    QODER_PERSONAL_ACCESS_TOKEN
    QODER_BASE_URL
    QODER_MODEL
    CODEBUDDY_API_KEY
    CODEBUDDY_AUTH_TOKEN
    CODEBUDDY_BASE_URL
    CODEBUDDY_MODEL
    CODEBUDDY_SMALL_FAST_MODEL
    CODEBUDDY_BIG_SLOW_MODEL
    CODEBUDDY_CODE_SUBAGENT_MODEL
    CODEBUDDY_CUSTOM_HEADERS
    CODEBUDDY_INTERNET_ENVIRONMENT
    ANTHROPIC_API_KEY
    LANGSMITH_API_KEY
    LANGSMITH_PROJECT
    LANGSMITH_TRACING
    LANGSMITH_ENDPOINT
    LANGFUSE_PUBLIC_KEY
    LANGFUSE_SECRET_KEY
    LANGFUSE_BASE_URL
    LANGFUSE_TRACING_ENVIRONMENT
    TRACE_TO_LANGFUSE
    LANGFUSE_CODEX_TAGS
    LANGFUSE_CODEX_METADATA
    TAVILY_API_KEY
    # Claude Code LangSmith tracing (official langsmith-tracing plugin)
    TRACE_TO_LANGSMITH
    CC_LANGSMITH_API_KEY
    CC_LANGSMITH_PROJECT
    CC_LANGSMITH_DEBUG
    CC_LANGSMITH_LOG_FILE
    CC_LANGSMITH_METADATA
    # Nest the plugin's Claude Code trajectory under the pytest experiment run
    CC_LANGSMITH_PARENT_DOTTED_ORDER
    # Eval trace context (nest LLM calls in test scripts under eval span)
    BENCH_EVAL_LANGSMITH_TRACE
    BENCH_EVAL_BAGGAGE
    # Claude Code via Anthropic-compatible proxy (BigModel / mimo / OpenRouter etc.)
    # When ANTHROPIC_API_KEY is unset, claude authenticates with these instead.
    ANTHROPIC_AUTH_TOKEN
    ANTHROPIC_BASE_URL
    ANTHROPIC_MODEL
    ANTHROPIC_DEFAULT_HAIKU_MODEL
    ANTHROPIC_DEFAULT_SONNET_MODEL
    ANTHROPIC_DEFAULT_OPUS_MODEL
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
    CLAUDE_CODE_SUBAGENT_MODEL
    COMET_EVAL_CUSTOM_AGENT_ID
    COMET_EVAL_CUSTOM_EXECUTABLE
    COMET_EVAL_CUSTOM_CREDENTIALS
    COMET_EVAL_CUSTOM_MODEL
    COMET_EVAL_CUSTOM_BASE_URL
    COMET_EVAL_CUSTOM_MODEL_ENV
    COMET_EVAL_CUSTOM_BASE_URL_ENV
    COMET_EVAL_CUSTOM_INSTALL_KIND
    COMET_EVAL_CUSTOM_INSTALL_PACKAGE
    COMET_EVAL_CUSTOM_INSTALL_VERSION
)

validate_agent() {
    case "$1" in
        claude-code|codex|qoder|codebuddy) return 0 ;;
        *)
            if [[ "${COMET_EVAL_CUSTOM_AGENT_ID:-}" == "$1" && -n "${COMET_EVAL_CUSTOM_EXECUTABLE:-}" ]]; then
                return 0
            fi
            echo "ERROR: Unsupported evaluation agent: $1" >&2
            return 1
            ;;
    esac
}

agent_executable() {
    case "$1" in
        claude-code) printf '%s' "claude" ;;
        codex) printf '%s' "codex" ;;
        qoder) printf '%s' "qodercli" ;;
        codebuddy) printf '%s' "codebuddy" ;;
        *)
            validate_agent "$1" || return 1
            printf '%s' "${COMET_EVAL_CUSTOM_EXECUTABLE}"
            ;;
    esac
}

agent_version() {
    case "$1" in
        claude-code) printf '%s' "$CLAUDE_CODE_VERSION" ;;
        codex) printf '%s' "$CODEX_VERSION" ;;
        qoder) printf '%s' "$QODER_VERSION" ;;
        codebuddy) printf '%s' "$CODEBUDDY_VERSION" ;;
        *)
            validate_agent "$1" || return 1
            local custom_identity
            custom_identity=$(printf '%s\n%s\n%s\n%s' \
                "${COMET_EVAL_CUSTOM_EXECUTABLE:-}" \
                "${COMET_EVAL_CUSTOM_INSTALL_KIND:-none}" \
                "${COMET_EVAL_CUSTOM_INSTALL_PACKAGE:-}" \
                "${COMET_EVAL_CUSTOM_INSTALL_VERSION:-latest}")
            custom_identity=$(sha256_text "$custom_identity") || return 1
            printf 'custom-%s' "${custom_identity:0:12}"
            ;;
    esac
}

# =============================================================================
# DOCKER CHECKS
# =============================================================================

check_docker() {
    if ! command -v docker &> /dev/null; then
        echo "ERROR: Docker not found" >&2
        return 1
    fi
    if ! docker info &> /dev/null 2>&1; then
        echo "ERROR: Docker daemon not running" >&2
        return 1
    fi
    return 0
}

# =============================================================================
# HASH-BASED IMAGE CACHING
# =============================================================================

# Get hash of build inputs for cache key (Dockerfile + requirements.txt)
get_dockerfile_hash() {
    local dir="$1"
    local dockerfile="$dir/Dockerfile"

    if [[ ! -f "$dockerfile" ]]; then
        # Fall back to environment/Dockerfile (same layout as docker_build).
        dockerfile="$dir/environment/Dockerfile"
    fi

    if [[ ! -f "$dockerfile" ]]; then
        echo ""
        return 1
    fi

    # Hash Dockerfile + requirements.txt (the files that affect the image).
    # Don't hash the entire directory — test scripts and scaffold files are
    # added at runtime and would cause a different hash every run.
    local combined
    combined=$(cat "$dockerfile")
    if [[ -f "$dir/requirements.txt" ]]; then
        combined="$combined$(cat "$dir/requirements.txt")"
    fi

    if command -v md5 &> /dev/null; then
        echo "$combined" | md5 -q | cut -c1-8
    else
        echo "$combined" | md5sum | cut -c1-8
    fi
}

# Get image name for a directory (based on build context hash + Claude Code version)
get_base_image_name() {
    local dir="$1"
    local hash
    hash=$(get_dockerfile_hash "$dir") || return 1
    # Include version in tag to cache different versions separately
    if [[ "$CLAUDE_CODE_VERSION" == "latest" ]]; then
        echo "${IMAGE_PREFIX}:${hash}"
    else
        echo "${IMAGE_PREFIX}:${hash}-cc${CLAUDE_CODE_VERSION}"
    fi
}

get_image_name() {
    local dir="$1"
    local agent="${2:-$DEFAULT_AGENT}"
    validate_agent "$agent" || return 1
    local base
    base=$(get_base_image_name "$dir") || return 1
    local trace_suffix=""
    if [[ "${TRACE_TO_LANGFUSE:-}" == "true" ]]; then
        trace_suffix="-lf"
    fi
    if [[ "$agent" == "claude-code" && "$trace_suffix" == "" ]]; then
        echo "$base"
    else
        local overlay_file overlay_hash
        overlay_file="$SCRIPT_DIR/../docker/agent-overlay.Dockerfile"
        if [[ -f "$overlay_file" ]]; then
            local overlay_contents
            overlay_contents=$(cat "$overlay_file")
            if command -v md5 &> /dev/null; then
                overlay_hash=$(printf '%s' "$overlay_contents" | md5 -q | cut -c1-8)
            else
                overlay_hash=$(printf '%s' "$overlay_contents" | md5sum | cut -c1-8)
            fi
        else
            overlay_hash="missing"
        fi
        echo "${base}-${agent}-$(agent_version "$agent")-o${overlay_hash}${trace_suffix}"
    fi
}

# Check if image exists
image_exists() {
    local image_name="$1"
    docker images -q "$image_name" 2>/dev/null | grep -q .
}

sha256_text() {
    if command -v sha256sum &> /dev/null; then
        printf '%s' "$1" | sha256sum | cut -d' ' -f1
    elif command -v shasum &> /dev/null; then
        printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
    else
        echo "ERROR: sha256sum or shasum is required for execution identity" >&2
        return 1
    fi
}

resolve_runtime_image() {
    local dir="$1"
    local expected_image_id="${2:-}"
    local agent="${3:-$DEFAULT_AGENT}"
    validate_agent "$agent" || return 1
    if [[ -n "$expected_image_id" ]]; then
        if [[ ! "$expected_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
            echo "ERROR: Invalid immutable Docker image ID" >&2
            return 1
        fi
        if ! docker image inspect "$expected_image_id" &> /dev/null; then
            echo "ERROR: Expected Docker image is no longer available" >&2
            return 1
        fi
        printf '%s' "$expected_image_id"
        return 0
    fi

    local image_name image_id
    image_name=$(docker_build "$dir" "" "$agent") || return 1
    image_id=$(docker image inspect --format '{{.Id}}' "$image_name") || return 1
    if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
        echo "ERROR: Docker returned an invalid immutable image ID" >&2
        return 1
    fi
    printf '%s' "$image_id"
}

docker_execution_identity() {
    local dir="$1"
    local agent="${2:-$DEFAULT_AGENT}"
    validate_agent "$agent" || return 1
    local image_name image_id repo_digests agent_version_output
    image_name=$(docker_build "$dir" "" "$agent") || return 1
    image_id=$(docker image inspect --format '{{.Id}}' "$image_name") || return 1
    if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
        echo "ERROR: Docker returned an invalid immutable image ID" >&2
        return 1
    fi
    repo_digests=$(docker image inspect --format '{{json .RepoDigests}}' "$image_id") || return 1
    local executable
    executable=$(agent_executable "$agent")
    if [[ "$agent" == "claude-code" && "${TRACE_TO_LANGFUSE:-}" != "true" ]]; then
        agent_version_output=$(docker run --rm "$image_id" claude --version 2>/dev/null)
    else
        agent_version_output=$(docker run --rm "$image_id" "$executable" --version 2>/dev/null)
    fi || {
        echo "ERROR: Cannot verify $agent CLI version in benchmark image" >&2
        return 1
    }
    local agent_version_json
    agent_version_json=$(printf '%s' "$agent_version_output" | node -e '
let value = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => value += chunk);
process.stdin.on("end", () => process.stdout.write(JSON.stringify(value.trim())));
') || return 1
    printf '{"schema":"comet.eval.execution-identity.v1","runtime_image_id":"%s","agent":"%s","agent_cli":"%s","agent_cli_version":%s,"image_id_hash":"sha256:%s","image_repo_digests_hash":"sha256:%s","image_ref_hash":"sha256:%s","agent_cli_version_hash":"sha256:%s","claude_tool_version_hash":"sha256:%s"}\n' \
        "$image_id" \
        "$agent" \
        "$executable" \
        "$agent_version_json" \
        "$(sha256_text "$image_id")" \
        "$(sha256_text "$repo_digests")" \
        "$(sha256_text "$image_name")" \
        "$(sha256_text "$agent_version_output")" \
        "$(sha256_text "$agent_version_output")"
}

# =============================================================================
# DOCKER BUILD
# =============================================================================

# Build Docker image with caching
# Usage: docker_build <directory> [--force]
# Output: image name on stdout
docker_build() {
    local dir="$1"
    local force="${2:-}"
    local agent="${3:-$DEFAULT_AGENT}"
    if [[ "$force" == "--agent" ]]; then
        agent="${3:-$DEFAULT_AGENT}"
        force=""
    fi
    validate_agent "$agent" || return 1

    local dockerfile="$dir/Dockerfile"
    if [[ ! -f "$dockerfile" ]]; then
        # Fall back to environment/Dockerfile (the eval layout: conftest's
        # copy_environment places it there, and validator test dirs reuse it).
        dockerfile="$dir/environment/Dockerfile"
    fi
    if [[ ! -f "$dockerfile" ]]; then
        echo "ERROR: No Dockerfile in $dir" >&2
        return 1
    fi

    local base_image_name image_name
    base_image_name=$(get_base_image_name "$dir") || return 1
    image_name=$(get_image_name "$dir" "$agent") || return 1

    # Check cache unless forced
    if [[ "$force" != "--force" ]] && image_exists "$image_name"; then
        echo "$image_name"
        return 0
    fi

    # Build the task image first (pass Claude Code version as build arg).
    local windir windockerfile
    windir=$(_winpath "$dir")
    windockerfile=$(_winpath "$dockerfile")
    if [[ "$agent" == "claude-code" && "${TRACE_TO_LANGFUSE:-}" != "true" ]]; then
        if docker build -t "$image_name" \
            --build-arg CLAUDE_CODE_VERSION="$CLAUDE_CODE_VERSION" \
            -f "$windockerfile" "$windir" >&2; then
            echo "$image_name"
            return 0
        else
            echo "ERROR: Build failed" >&2
            return 1
        fi
    fi

    if [[ "$force" == "--force" ]] || ! image_exists "$base_image_name"; then
        if ! docker build -t "$base_image_name" \
            --build-arg CLAUDE_CODE_VERSION="$CLAUDE_CODE_VERSION" \
            -f "$windockerfile" "$windir" >&2; then
            echo "ERROR: Base image build failed" >&2
            return 1
        fi
    fi

    local overlay_file overlay_context
    overlay_file="$SCRIPT_DIR/../docker/agent-overlay.Dockerfile"
    overlay_context=$(_winpath "$(cd "$(dirname "$overlay_file")" && pwd)")
    if docker build -t "$image_name" \
        --build-arg BASE_IMAGE="$base_image_name" \
        --build-arg EVAL_AGENT="$agent" \
        --build-arg CODEX_VERSION="$CODEX_VERSION" \
        --build-arg QODER_VERSION="$QODER_VERSION" \
        --build-arg CODEBUDDY_VERSION="$CODEBUDDY_VERSION" \
        --build-arg CUSTOM_AGENT_ID="${COMET_EVAL_CUSTOM_AGENT_ID:-}" \
        --build-arg CUSTOM_AGENT_EXECUTABLE="${COMET_EVAL_CUSTOM_EXECUTABLE:-}" \
        --build-arg CUSTOM_INSTALL_KIND="${COMET_EVAL_CUSTOM_INSTALL_KIND:-none}" \
        --build-arg CUSTOM_INSTALL_PACKAGE="${COMET_EVAL_CUSTOM_INSTALL_PACKAGE:-}" \
        --build-arg CUSTOM_INSTALL_VERSION="${COMET_EVAL_CUSTOM_INSTALL_VERSION:-latest}" \
        --build-arg LANGFUSE_ENABLED="${TRACE_TO_LANGFUSE:-false}" \
        -f "$(_winpath "$overlay_file")" "$overlay_context" >&2; then
        echo "$image_name"
        return 0
    else
        echo "ERROR: Agent overlay build failed" >&2
        return 1
    fi
}

# =============================================================================
# DOCKER RUN
# =============================================================================

# Build env var arguments for docker run (populates ENV_ARGS array)
# Usage: build_env_args; docker run "${ENV_ARGS[@]}" ...
build_env_args() {
    ENV_ARGS=()
    for key in "${ENV_KEYS[@]}"; do
        if [[ -n "${!key:-}" ]]; then
            # Let Docker inherit the value from this process instead of putting
            # the secret literal in the docker command's argument list.
            ENV_ARGS+=("-e" "$key")
        fi
    done
    if [[ -n "${COMET_EVAL_CUSTOM_CREDENTIALS:-}" ]]; then
        local custom_key
        IFS=',' read -r -a custom_keys <<< "${COMET_EVAL_CUSTOM_CREDENTIALS}"
        for custom_key in "${custom_keys[@]}"; do
            if [[ "$custom_key" =~ ^[A-Z][A-Z0-9_]{1,63}$ ]] && [[ -n "${!custom_key:-}" ]]; then
                ENV_ARGS+=("-e" "$custom_key")
            fi
        done
    fi
    local metadata_key custom_routing_key
    for metadata_key in COMET_EVAL_CUSTOM_MODEL_ENV COMET_EVAL_CUSTOM_BASE_URL_ENV; do
        custom_routing_key="${!metadata_key:-}"
        if [[ "$custom_routing_key" =~ ^[A-Z][A-Z0-9_]{1,63}$ ]] && [[ -n "${!custom_routing_key:-}" ]]; then
            ENV_ARGS+=("-e" "$custom_routing_key")
        fi
    done
}

build_agent_runtime_mount_args() {
    RUNTIME_CONFIG_MOUNT_ARGS=()
    RUNTIME_CONFIG_TMPFS_ARGS=(
        --tmpfs "//home/agent/.codex:rw,nosuid,nodev"
        --tmpfs "//home/agent/.qoder:rw,nosuid,nodev"
        --tmpfs "//home/agent/.codebuddy:rw,nosuid,nodev"
    )
    local shell_host
    shell_host=$(_winpath "$SCRIPT_DIR")
    RUNTIME_CONFIG_MOUNT_ARGS=("-v" "$shell_host://opt/scaffold-shell:ro")
    # Agent auth/config roots are container-local. The generated files use
    # env_key/apiKeyHelper references, never credential literals.
    ENV_ARGS+=("-e" "CODEX_HOME=/home/agent/.codex")
    ENV_ARGS+=("-e" "QODER_CONFIG_DIR=/home/agent/.qoder")
    ENV_ARGS+=("-e" "COMET_EVAL_CODEBUDDY_CONFIG_DIR=/home/agent/.codebuddy")
}

# Build mount + CLI args for the official LangSmith Claude Code plugin.
# Populates PLUGIN_MOUNT_ARGS (docker -v) and PLUGIN_CLI_ARGS (claude --plugin-dir).
# Activated only when tracing is on and a prebuilt plugin dir is provided via
# CC_LANGSMITH_PLUGIN_DIR (host path). When unset the arrays stay empty, so
# local runs and untraced runs are completely unaffected.
build_plugin_args() {
    PLUGIN_MOUNT_ARGS=()
    PLUGIN_CLI_ARGS=()
    if [[ "${TRACE_TO_LANGSMITH:-}" != "true" ]]; then
        return 0
    fi
    if [[ -z "${CC_LANGSMITH_PLUGIN_DIR:-}" ]]; then
        return 0
    fi
    if [[ ! -d "${CC_LANGSMITH_PLUGIN_DIR}" ]]; then
        echo "WARN: CC_LANGSMITH_PLUGIN_DIR not a directory: ${CC_LANGSMITH_PLUGIN_DIR}; skipping trajectory tracing" >&2
        return 0
    fi
    local plugin_host
    plugin_host=$(_winpath "${CC_LANGSMITH_PLUGIN_DIR}")
    PLUGIN_MOUNT_ARGS=("-v" "$plugin_host://opt/langsmith-cc-plugin:ro")
    PLUGIN_CLI_ARGS=("--plugin-dir" "//opt/langsmith-cc-plugin")
}

# Build mount + CLI args for the isolated official Langfuse Agent plugin.
# The host-side Langfuse suite provisions this directory. No user-global Agent
# configuration is touched and credentials remain environment-only.
build_langfuse_plugin_args() {
    LANGFUSE_PLUGIN_MOUNT_ARGS=()
    LANGFUSE_PLUGIN_CLI_ARGS=()
    if [[ "${TRACE_TO_LANGFUSE:-}" != "true" ]]; then
        return 0
    fi
    if [[ -z "${LANGFUSE_TRAJECTORY_PLUGIN_DIR:-}" ]]; then
        return 0
    fi
    if [[ ! -d "${LANGFUSE_TRAJECTORY_PLUGIN_DIR}" ]]; then
        echo "WARN: LANGFUSE_TRAJECTORY_PLUGIN_DIR is not a directory; skipping official trajectory plugin" >&2
        return 0
    fi
    local plugin_host
    plugin_host=$(_winpath "${LANGFUSE_TRAJECTORY_PLUGIN_DIR}")
    LANGFUSE_PLUGIN_MOUNT_ARGS=("-v" "$plugin_host://opt/comet-langfuse-plugin:ro")
    if [[ "${1:-}" == "claude-code" ]]; then
        LANGFUSE_PLUGIN_CLI_ARGS=("--plugin-dir" "//opt/comet-langfuse-plugin")
    fi
}

# Keep controller-built oracle snapshots immutable inside both agent and validator containers.
# Nested read-only binds override the writable /workspace parent mount when present.
build_trusted_oracle_mount_args() {
    local dir="$1"
    TRUSTED_ORACLE_MOUNT_ARGS=()
    if [[ -d "$dir/_eval_current_comet" ]]; then
        local current_comet_host
        current_comet_host=$(_winpath "$dir/_eval_current_comet")
        TRUSTED_ORACLE_MOUNT_ARGS+=(
            "-v" "$current_comet_host://workspace/_eval_current_comet:ro"
        )
    fi
    if [[ -d "$dir/_eval_trusted_oracles" ]]; then
        local native_oracles_host
        native_oracles_host=$(_winpath "$dir/_eval_trusted_oracles")
        TRUSTED_ORACLE_MOUNT_ARGS+=(
            "-v" "$native_oracles_host://workspace/_eval_trusted_oracles:ro"
        )
    fi
}

# Run command in Docker container
# Usage: docker_run <directory> <command...>
docker_run() {
    local dir="$1"
    shift
    local cmd=("$@")

    local image_name
    image_name=$(docker_build "$dir") || return 1

    build_env_args
    build_trusted_oracle_mount_args "$dir"

    local windir
    windir=$(_winpath "$dir")

    docker run --rm \
        -v "$windir://workspace" \
        ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"} \
        -w //workspace \
        "${ENV_ARGS[@]}" \
        "$image_name" \
        "${cmd[@]}"
}

# Run one user-authored validation command inside the task container.
# Usage: docker_run_command <directory> --timeout SECONDS -- <shell command>
docker_run_command() {
    local dir="$1"
    shift
    local timeout="120"
    local command=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --timeout)
                timeout="$2"
                shift 2
                ;;
            --)
                shift
                command=("$@")
                break
                ;;
            *)
                command+=("$1")
                shift
                ;;
        esac
    done
    if [[ ${#command[@]} -eq 0 ]]; then
        echo "ERROR: validation command is required" >&2
        return 2
    fi

    local image_name
    image_name=$(docker_build "$dir") || return 1
    build_trusted_oracle_mount_args "$dir"

    local windir
    windir=$(_winpath "$dir")
    local docker_command=(docker run --rm
        -v "$windir://workspace"
        ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"}
        -w //workspace
        "$image_name"
        bash -lc "${command[*]}")
    if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD "$timeout" "${docker_command[@]}"
    else
        "${docker_command[@]}"
    fi
}

# Run Python script in Docker
# Usage: docker_run_python <directory> <script.py> [args...]
docker_run_python() {
    local dir="$1"
    local script="$2"
    shift 2

    docker_run "$dir" python "$script" "$@"
}

# Run Node.js/TypeScript script in Docker
# Usage: docker_run_node <directory> <script.js|script.ts> [args...]
docker_run_node() {
    local dir="$1"
    local script="$2"
    shift 2

    # Use tsx for TypeScript, node for JavaScript
    if [[ "$script" == *.ts ]]; then
        docker_run "$dir" npx tsx "$script" "$@"
    else
        docker_run "$dir" node "$script" "$@"
    fi
}

# Run Claude CLI in Docker
# Usage: docker_run_claude <directory> <prompt> [--model MODEL] [--timeout SECONDS]
docker_run_claude() {
    local dir="$1"
    local prompt="$2"
    shift 2

    local model=""
    local timeout="300"
    local expected_image_id=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --model)
                model="$2"
                shift 2
                ;;
            --timeout)
                timeout="$2"
                shift 2
                ;;
            --image-id)
                expected_image_id="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    local image_id
    image_id=$(resolve_runtime_image "$dir" "$expected_image_id") || return 1

    build_env_args
    build_agent_runtime_mount_args
    build_plugin_args
    build_langfuse_plugin_args "claude-code"
    build_trusted_oracle_mount_args "$dir"

    local cmd=(bash //opt/scaffold-shell/run-agent-runtime.sh claude-code "$model" "$prompt" --)
    if [[ ${#PLUGIN_CLI_ARGS[@]} -gt 0 ]]; then
        cmd+=("${PLUGIN_CLI_ARGS[@]}")
    fi
    if [[ ${#LANGFUSE_PLUGIN_CLI_ARGS[@]} -gt 0 ]]; then
        cmd+=("${LANGFUSE_PLUGIN_CLI_ARGS[@]}")
    fi

    local windir
    windir=$(_winpath "$dir")

    if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD "$timeout" docker run --rm \
            -v "$windir://workspace" \
            "${RUNTIME_CONFIG_MOUNT_ARGS[@]}" \
            "${RUNTIME_CONFIG_TMPFS_ARGS[@]}" \
            ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"} \
            ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
            ${LANGFUSE_PLUGIN_MOUNT_ARGS[@]+"${LANGFUSE_PLUGIN_MOUNT_ARGS[@]}"} \
            -w //workspace \
            "${ENV_ARGS[@]}" \
            "$image_id" \
            "${cmd[@]}"
    else
        docker run --rm \
            -v "$windir://workspace" \
            "${RUNTIME_CONFIG_MOUNT_ARGS[@]}" \
            "${RUNTIME_CONFIG_TMPFS_ARGS[@]}" \
            ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"} \
            ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
            ${LANGFUSE_PLUGIN_MOUNT_ARGS[@]+"${LANGFUSE_PLUGIN_MOUNT_ARGS[@]}"} \
            -w //workspace \
            "${ENV_ARGS[@]}" \
            "$image_id" \
            "${cmd[@]}"
    fi
}

# Run a selected evaluation agent CLI in Docker.
# Usage: docker_run_agent <directory> <prompt> --agent AGENT [--model MODEL] [--timeout SECONDS]
docker_run_agent() {
    local dir="$1"
    local prompt="$2"
    shift 2

    local agent="$DEFAULT_AGENT"
    local model=""
    local timeout="300"
    local expected_image_id=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --agent)
                agent="$2"
                shift 2
                ;;
            --model)
                model="$2"
                shift 2
                ;;
            --timeout)
                timeout="$2"
                shift 2
                ;;
            --image-id)
                expected_image_id="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
    validate_agent "$agent" || return 1

    local image_id
    image_id=$(resolve_runtime_image "$dir" "$expected_image_id" "$agent") || return 1

    build_env_args
    build_agent_runtime_mount_args
    if [[ "$agent" == "claude-code" ]]; then
        build_plugin_args
    else
        PLUGIN_MOUNT_ARGS=()
        PLUGIN_CLI_ARGS=()
    fi
    build_langfuse_plugin_args "$agent"
    build_trusted_oracle_mount_args "$dir"
    AGENT_COMMAND=(bash //opt/scaffold-shell/run-agent-runtime.sh "$agent" "$model" "$prompt" --)
    if [[ "$agent" == "claude-code" && ${#PLUGIN_CLI_ARGS[@]} -gt 0 ]]; then
        AGENT_COMMAND+=("${PLUGIN_CLI_ARGS[@]}")
    fi
    if [[ "$agent" == "claude-code" && ${#LANGFUSE_PLUGIN_CLI_ARGS[@]} -gt 0 ]]; then
        AGENT_COMMAND+=("${LANGFUSE_PLUGIN_CLI_ARGS[@]}")
    fi

    local windir
    windir=$(_winpath "$dir")
    if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD "$timeout" docker run --rm \
            -v "$windir://workspace" \
            "${RUNTIME_CONFIG_MOUNT_ARGS[@]}" \
            "${RUNTIME_CONFIG_TMPFS_ARGS[@]}" \
            ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"} \
            ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
            ${LANGFUSE_PLUGIN_MOUNT_ARGS[@]+"${LANGFUSE_PLUGIN_MOUNT_ARGS[@]}"} \
            -w //workspace \
            "${ENV_ARGS[@]}" \
            "$image_id" \
            "${AGENT_COMMAND[@]}"
    else
        docker run --rm \
            -v "$windir://workspace" \
            "${RUNTIME_CONFIG_MOUNT_ARGS[@]}" \
            "${RUNTIME_CONFIG_TMPFS_ARGS[@]}" \
            ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"} \
            ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
            ${LANGFUSE_PLUGIN_MOUNT_ARGS[@]+"${LANGFUSE_PLUGIN_MOUNT_ARGS[@]}"} \
            -w //workspace \
            "${ENV_ARGS[@]}" \
            "$image_id" \
            "${AGENT_COMMAND[@]}"
    fi
}

# Run the multi-turn interactive claude driver in Docker.
# Usage: docker_run_claude_loop <directory> <prompt> [--max-turns N] [--model MODEL]
# Mounts the scaffold shell dir so run-claude-loop.sh is available inside.
docker_run_claude_loop() {
    local dir="$1"
    local prompt="$2"
    shift 2

    local expected_image_id=""
    local loop_args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --image-id)
                expected_image_id="$2"
                shift 2
                ;;
            --max-turns|--model|--simulator-prompt-file|--decision-reply|--decision-reply-step|--continue-prompt|--decision-pattern|--fresh-resume-marker)
                loop_args+=("$1" "$2")
                shift 2
                ;;
            *)
                loop_args+=("$1")
                shift
                ;;
        esac
    done

    local image_id
    image_id=$(resolve_runtime_image "$dir" "$expected_image_id" "claude-code") || return 1

    build_env_args
    build_agent_runtime_mount_args
    build_plugin_args
    build_langfuse_plugin_args "claude-code"
    build_trusted_oracle_mount_args "$dir"

    local windir
    windir=$(_winpath "$dir")
    local container_name
    container_name="comet-eval-loop-$(sha256_text "$dir" | cut -c1-24)"

    # A previous host-side timeout may have terminated bash before Docker could
    # process --rm. The name is scoped to this unique pytest workspace, so it is
    # safe to remove only that stale container before retrying the same case.
    docker rm -f "$container_name" &> /dev/null || true

    # Mount the scaffold shell scripts read-only so the loop driver is available
    # at /opt/scaffold-shell/ inside the container.
    docker run --rm --name "$container_name" \
        -v "$windir://workspace" \
        "${RUNTIME_CONFIG_MOUNT_ARGS[@]}" \
        "${RUNTIME_CONFIG_TMPFS_ARGS[@]}" \
        ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"} \
        ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
        ${LANGFUSE_PLUGIN_MOUNT_ARGS[@]+"${LANGFUSE_PLUGIN_MOUNT_ARGS[@]}"} \
        -w //workspace \
        "${ENV_ARGS[@]}" \
        "$image_id" \
        bash //opt/scaffold-shell/run-claude-loop.sh "$prompt" \
            ${PLUGIN_CLI_ARGS[@]+"${PLUGIN_CLI_ARGS[@]}"} \
            ${LANGFUSE_PLUGIN_CLI_ARGS[@]+"${LANGFUSE_PLUGIN_CLI_ARGS[@]}"} \
            "${loop_args[@]}"
}

# Run the shared multi-turn driver with a selected agent CLI.
docker_run_agent_loop() {
    local dir="$1"
    local prompt="$2"
    shift 2

    local agent="$DEFAULT_AGENT"
    local expected_image_id=""
    local loop_args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --agent)
                agent="$2"
                shift 2
                ;;
            --image-id)
                expected_image_id="$2"
                shift 2
                ;;
            --max-turns|--model|--simulator-prompt-file|--decision-reply|--decision-reply-step|--continue-prompt|--decision-pattern|--fresh-resume-marker)
                loop_args+=("$1" "$2")
                shift 2
                ;;
            *)
                loop_args+=("$1")
                shift
                ;;
        esac
    done
    validate_agent "$agent" || return 1

    local image_id
    image_id=$(resolve_runtime_image "$dir" "$expected_image_id" "$agent") || return 1

    build_env_args
    build_agent_runtime_mount_args
    if [[ "$agent" == "claude-code" ]]; then
        build_plugin_args
    else
        PLUGIN_MOUNT_ARGS=()
        PLUGIN_CLI_ARGS=()
    fi
    build_langfuse_plugin_args "$agent"
    build_trusted_oracle_mount_args "$dir"

    local windir
    windir=$(_winpath "$dir")
    local container_name
    container_name="comet-eval-agent-loop-$(sha256_text "$dir" | cut -c1-24)"
    docker rm -f "$container_name" &> /dev/null || true

    docker run --rm --name "$container_name" \
        -v "$windir://workspace" \
        "${RUNTIME_CONFIG_MOUNT_ARGS[@]}" \
        "${RUNTIME_CONFIG_TMPFS_ARGS[@]}" \
        ${TRUSTED_ORACLE_MOUNT_ARGS[@]+"${TRUSTED_ORACLE_MOUNT_ARGS[@]}"} \
        ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
        ${LANGFUSE_PLUGIN_MOUNT_ARGS[@]+"${LANGFUSE_PLUGIN_MOUNT_ARGS[@]}"} \
        -w //workspace \
        "${ENV_ARGS[@]}" \
        "$image_id" \
        bash //opt/scaffold-shell/run-claude-loop.sh "$prompt" \
            --agent "$agent" \
            ${PLUGIN_CLI_ARGS[@]+"${PLUGIN_CLI_ARGS[@]}"} \
            ${LANGFUSE_PLUGIN_CLI_ARGS[@]+"${LANGFUSE_PLUGIN_CLI_ARGS[@]}"} \
            "${loop_args[@]}"
}

cleanup_claude_loop() {
    local dir="$1"
    local container_name
    container_name="comet-eval-loop-$(sha256_text "$dir" | cut -c1-24)"
    docker rm -f "$container_name" &> /dev/null || true
}

cleanup_agent_loop() {
    local dir="$1"
    local container_name
    container_name="comet-eval-agent-loop-$(sha256_text "$dir" | cut -c1-24)"
    docker rm -f "$container_name" &> /dev/null || true
}

# =============================================================================
# CLI MODE
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    cmd="${1:-help}"
    shift || true

    case "$cmd" in
    check)
        if check_docker; then
            echo "OK"
        else
            exit 1
        fi
        ;;
    build)
        dir="${1:-}"
        force=""
        agent="$DEFAULT_AGENT"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 build <directory> [--force]"
        fi
        shift
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --force) force="--force"; shift ;;
                --agent) agent="${2:-}"; shift 2 ;;
                *) shift ;;
            esac
        done
        docker_build "$(realpath "$dir")" "$force" "$agent"
        ;;
    execution-identity)
        dir="${1:-}"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 execution-identity <directory>"
        fi
        shift
        agent="$DEFAULT_AGENT"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --agent) agent="${2:-}"; shift 2 ;;
                *) shift ;;
            esac
        done
        docker_execution_identity "$(realpath "$dir")" "$agent"
        ;;
    run)
        dir="${1:-}"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 run <directory> <command...>"
        fi
        shift
        docker_run "$(realpath "$dir")" "$@"
        ;;
    run-command)
        dir="${1:-}"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 run-command <directory> --timeout SECONDS -- <command>"
        fi
        shift
        docker_run_command "$(realpath "$dir")" "$@"
        ;;
    run-python)
        dir="${1:-}"
        script="${2:-}"
        if [[ -z "$dir" || -z "$script" ]]; then
            die "Usage: $0 run-python <directory> <script.py> [args...]"
        fi
        shift 2
        docker_run_python "$(realpath "$dir")" "$script" "$@"
        ;;
    run-node)
        dir="${1:-}"
        script="${2:-}"
        if [[ -z "$dir" || -z "$script" ]]; then
            die "Usage: $0 run-node <directory> <script.js|ts> [args...]"
        fi
        shift 2
        docker_run_node "$(realpath "$dir")" "$script" "$@"
        ;;
    run-claude)
        dir="${1:-}"
        prompt="${2:-}"
        if [[ -z "$dir" || -z "$prompt" ]]; then
            die "Usage: $0 run-claude <directory> <prompt> [--model MODEL] [--timeout SECONDS]"
        fi
        shift 2
        docker_run_claude "$(realpath "$dir")" "$prompt" "$@"
        ;;
    run-agent)
        dir="${1:-}"
        prompt="${2:-}"
        if [[ -z "$dir" || -z "$prompt" ]]; then
            die "Usage: $0 run-agent <directory> <prompt> --agent AGENT [--model MODEL] [--timeout SECONDS]"
        fi
        shift 2
        docker_run_agent "$(realpath "$dir")" "$prompt" "$@"
        ;;
    run-claude-loop)
        dir="${1:-}"
        prompt="${2:-}"
        if [[ -z "$dir" || -z "$prompt" ]]; then
            die "Usage: $0 run-claude-loop <directory> <prompt> [--max-turns N] [--model MODEL]"
        fi
        shift 2
        docker_run_claude_loop "$(realpath "$dir")" "$prompt" "$@"
        ;;
    cleanup-claude-loop)
        dir="${1:-}"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 cleanup-claude-loop <directory>"
        fi
        cleanup_claude_loop "$(realpath "$dir")"
        ;;
    run-agent-loop)
        dir="${1:-}"
        prompt="${2:-}"
        if [[ -z "$dir" || -z "$prompt" ]]; then
            die "Usage: $0 run-agent-loop <directory> <prompt> --agent AGENT [--max-turns N]"
        fi
        shift 2
        docker_run_agent_loop "$(realpath "$dir")" "$prompt" "$@"
        ;;
    cleanup-agent-loop)
        dir="${1:-}"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 cleanup-agent-loop <directory>"
        fi
        cleanup_agent_loop "$(realpath "$dir")"
        ;;
    help|*)
        cat <<EOF
Docker utilities for skill benchmarks

Usage: $0 <command> [args...]

Commands:
  check                              Check if Docker is available
  build <dir> [--force]              Build image (cached by Dockerfile hash)
  execution-identity <dir>           Hash the immutable image and Claude CLI version
  run <dir> <cmd...>                 Run command in container
  run-python <dir> <script> [args]   Run Python script in container
  run-node <dir> <script> [args]     Run Node.js/TypeScript in container
  run-claude <dir> <prompt> [opts]   Run Claude CLI in container

Options for run-claude:
  --model MODEL      Model to use
  --timeout SECONDS  Timeout (default: 300)
  --image-id SHA256  Run the controller-verified immutable image

Environment variables passed to containers:
  OPENAI_API_KEY, ANTHROPIC_API_KEY, LANGSMITH_API_KEY,
  LANGSMITH_PROJECT, LANGSMITH_TRACING, LANGSMITH_ENDPOINT,
  TAVILY_API_KEY

Build configuration:
  BENCH_CC_VERSION  Version of Claude Code to install (default: latest)
                    Example: BENCH_CC_VERSION=2.1.29 ./docker.sh build <dir>
EOF
        ;;
    esac
fi
