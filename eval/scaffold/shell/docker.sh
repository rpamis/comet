#!/usr/bin/env bash
# Docker utilities for test orchestration
# Language-agnostic interface - call from Python, JS, or CLI
#
# Usage:
#   ./docker.sh check
#   ./docker.sh build <directory> [--force]
#   ./docker.sh run <directory> <command...>
#   ./docker.sh run-python <directory> <script.py> [args...]
#   ./docker.sh run-claude <directory> <prompt> [--model MODEL] [--timeout SECONDS]

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
    ANTHROPIC_API_KEY
    LANGSMITH_API_KEY
    LANGSMITH_PROJECT
    LANGSMITH_TRACING
    LANGSMITH_ENDPOINT
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
)

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
get_image_name() {
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

# Check if image exists
image_exists() {
    local image_name="$1"
    docker images -q "$image_name" 2>/dev/null | grep -q .
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

    local image_name
    image_name=$(get_image_name "$dir") || return 1

    # Check cache unless forced
    if [[ "$force" != "--force" ]] && image_exists "$image_name"; then
        echo "$image_name"
        return 0
    fi

    # Build image (pass Claude Code version as build arg)
    local windir windockerfile
    windir=$(_winpath "$dir")
    windockerfile=$(_winpath "$dockerfile")
    if docker build -t "$image_name" \
        --build-arg CLAUDE_CODE_VERSION="$CLAUDE_CODE_VERSION" \
        -f "$windockerfile" "$windir" >&2; then
        echo "$image_name"
        return 0
    else
        echo "ERROR: Build failed" >&2
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
            ENV_ARGS+=("-e" "$key=${!key}")
        fi
    done
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

# Run command in Docker container
# Usage: docker_run <directory> <command...>
docker_run() {
    local dir="$1"
    shift
    local cmd=("$@")

    local image_name
    image_name=$(docker_build "$dir") || return 1

    build_env_args

    local windir
    windir=$(_winpath "$dir")

    docker run --rm \
        -v "$windir://workspace" \
        -w //workspace \
        "${ENV_ARGS[@]}" \
        "$image_name" \
        "${cmd[@]}"
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
            *)
                shift
                ;;
        esac
    done

    local image_name
    image_name=$(docker_build "$dir") || return 1

    build_env_args
    build_plugin_args

    local cmd=(
        claude -p "$prompt"
        --dangerously-skip-permissions
        --output-format stream-json
        --verbose
    )

    if [[ ${#PLUGIN_CLI_ARGS[@]} -gt 0 ]]; then
        cmd+=("${PLUGIN_CLI_ARGS[@]}")
    fi

    if [[ -n "$model" ]]; then
        cmd+=(--model "$model")
    fi

    local windir
    windir=$(_winpath "$dir")

    if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD "$timeout" docker run --rm \
            -v "$windir://workspace" \
            ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
            -w //workspace \
            "${ENV_ARGS[@]}" \
            "$image_name" \
            "${cmd[@]}"
    else
        docker run --rm \
            -v "$windir://workspace" \
            ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
            -w //workspace \
            "${ENV_ARGS[@]}" \
            "$image_name" \
            "${cmd[@]}"
    fi
}

# Run the multi-turn interactive claude driver in Docker.
# Usage: docker_run_claude_loop <directory> <prompt> [--max-turns N] [--model MODEL]
# Mounts the scaffold shell dir so run-claude-loop.sh is available inside.
docker_run_claude_loop() {
    local dir="$1"
    local prompt="$2"
    shift 2

    local image_name
    image_name=$(docker_build "$dir") || return 1

    build_env_args
    build_plugin_args

    local windir shell_dir
    windir=$(_winpath "$dir")
    shell_dir=$(_winpath "$SCRIPT_DIR")

    # Mount the scaffold shell scripts read-only so the loop driver is available
    # at /opt/scaffold-shell/ inside the container.
    docker run --rm \
        -v "$windir://workspace" \
        -v "$shell_dir://opt/scaffold-shell:ro" \
        ${PLUGIN_MOUNT_ARGS[@]+"${PLUGIN_MOUNT_ARGS[@]}"} \
        -w //workspace \
        "${ENV_ARGS[@]}" \
        "$image_name" \
        bash //opt/scaffold-shell/run-claude-loop.sh "$prompt" \
            ${PLUGIN_CLI_ARGS[@]+"${PLUGIN_CLI_ARGS[@]}"} \
            "$@"
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
        force="${2:-}"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 build <directory> [--force]"
        fi
        docker_build "$(realpath "$dir")" "$force"
        ;;
    run)
        dir="${1:-}"
        if [[ -z "$dir" ]]; then
            die "Usage: $0 run <directory> <command...>"
        fi
        shift
        docker_run "$(realpath "$dir")" "$@"
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
    run-claude-loop)
        dir="${1:-}"
        prompt="${2:-}"
        if [[ -z "$dir" || -z "$prompt" ]]; then
            die "Usage: $0 run-claude-loop <directory> <prompt> [--max-turns N] [--model MODEL]"
        fi
        shift 2
        docker_run_claude_loop "$(realpath "$dir")" "$prompt" "$@"
        ;;
    help|*)
        cat <<EOF
Docker utilities for skill benchmarks

Usage: $0 <command> [args...]

Commands:
  check                              Check if Docker is available
  build <dir> [--force]              Build image (cached by Dockerfile hash)
  run <dir> <cmd...>                 Run command in container
  run-python <dir> <script> [args]   Run Python script in container
  run-node <dir> <script> [args]     Run Node.js/TypeScript in container
  run-claude <dir> <prompt> [opts]   Run Claude CLI in container

Options for run-claude:
  --model MODEL      Model to use
  --timeout SECONDS  Timeout (default: 300)

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
