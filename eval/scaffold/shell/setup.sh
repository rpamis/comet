#!/usr/bin/env bash
# Test environment setup utilities
# Source this file or run directly
#
# Commands:
#   ./setup.sh verify <env_dir> [required_files...]
#   ./setup.sh create-temp [prefix]
#   ./setup.sh cleanup <temp_dir>
#   ./setup.sh write-skill <test_dir> <skill_name> <content_file> [scripts_dir] [source_dir]
#   ./setup.sh write-claude-md <test_dir> <content_file>
#   ./setup.sh copy-env <test_dir> <env_dir>

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/docker.sh"

# =============================================================================
# VERIFICATION
# =============================================================================

verify_environment() {
    local env_dir="$1"
    shift
    local required_files=("$@")
    local errors=()

    # Default required files
    if [[ ${#required_files[@]} -eq 0 ]]; then
        required_files=("Dockerfile" "requirements.txt")
    fi

    # Check Claude CLI
    if ! command -v claude &> /dev/null; then
        errors+=("Claude Code CLI not found. Install from: https://claude.ai/code")
    fi

    # Check Docker
    if ! check_docker; then
        errors+=("Docker not available")
    fi

    # Check API keys
    if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
        errors+=("ANTHROPIC_API_KEY not set")
    fi
    if [[ -z "${OPENAI_API_KEY:-}" ]]; then
        errors+=("OPENAI_API_KEY not set")
    fi

    # Check environment directory
    if [[ ! -d "$env_dir" ]]; then
        errors+=("Environment directory not found: $env_dir")
    else
        for file in "${required_files[@]}"; do
            if [[ ! -f "$env_dir/$file" ]]; then
                errors+=("Missing: $env_dir/$file")
            fi
        done
    fi

    # Report errors
    if [[ ${#errors[@]} -gt 0 ]]; then
        log_error "Environment verification failed:"
        for error in "${errors[@]}"; do
            echo "  - $error" >&2
        done
        return 1
    fi

    log_success "Environment verified (Docker, Claude CLI, API keys)"
    return 0
}

# =============================================================================
# TEMP DIRECTORY MANAGEMENT
# =============================================================================

create_temp_dir() {
    local prefix="${1:-claude_test_}"
    mktemp -d -t "${prefix}XXXXXXXX"
}

cleanup_temp_dir() {
    local dir="$1"

    # Safety check: only remove if it looks like our temp dir
    if [[ "$dir" != *"claude_test_"* && "$dir" != */tmp/* && "$dir" != */var/folders/* ]]; then
        log_warn "Refusing to clean up $dir (not a temp directory)"
        return 1
    fi

    if [[ -d "$dir" ]]; then
        log_info "Cleaning up $dir..."
        rm -rf "$dir"
        log_success "Cleaned up"
    fi
}

# =============================================================================
# SKILL SETUP
# =============================================================================

write_skill() {
    local test_dir="$1"
    local skill_name="$2"
    local content_file="$3"
    local scripts_dir="${4:-}"
    local source_dir="${5:-}"

    local skill_dir="$test_dir/.claude/skills/$skill_name"
    mkdir -p "$skill_dir"

    if [[ -n "$source_dir" && -d "$source_dir" ]]; then
        cp -r "$source_dir"/. "$skill_dir"/
        log_info "Copied skill package to $skill_name/"
    fi

    # Write SKILL.md
    if [[ -f "$content_file" ]]; then
        cp "$content_file" "$skill_dir/SKILL.md"
    else
        # Content passed as string (for piping)
        echo "$content_file" > "$skill_dir/SKILL.md"
    fi

    # Copy scripts if provided
    if [[ -n "$scripts_dir" && -d "$scripts_dir" ]]; then
        rm -rf "$skill_dir/scripts"
        cp -r "$scripts_dir" "$skill_dir/scripts"
        chmod -R u+x "$skill_dir/scripts" 2>/dev/null || true
        log_info "Copied scripts to $skill_name/scripts/"
    fi

    echo "$skill_dir/SKILL.md"
}

write_claude_md() {
    local test_dir="$1"
    local content_file="$2"

    local claude_dir="$test_dir/.claude"
    mkdir -p "$claude_dir"

    if [[ -f "$content_file" ]]; then
        cp "$content_file" "$claude_dir/CLAUDE.md"
        cp "$content_file" "$test_dir/CLAUDE.md"
    else
        # Content passed as string
        echo "$content_file" > "$claude_dir/CLAUDE.md"
        echo "$content_file" > "$test_dir/CLAUDE.md"
    fi

    local size
    size=$(wc -c < "$claude_dir/CLAUDE.md" | tr -d ' ')
    log_success "Created CLAUDE.md ($size chars)"
}

# =============================================================================
# ENVIRONMENT COPY
# =============================================================================

copy_environment() {
    local test_dir="$1"
    local env_dir="$2"

    if [[ ! -d "$env_dir" ]]; then
        log_error "Environment directory not found: $env_dir"
        return 1
    fi

    # Merge (rsync-like) instead of clobber: copy each top-level item, and for
    # directories that already exist in test_dir (e.g. .claude/, openspec/),
    # merge contents recursively so injected skills/commands are preserved.
    for item in "$env_dir"/*; do
        [[ -e "$item" ]] || continue
        local name
        name=$(basename "$item")
        local dest="$test_dir/$name"
        if [[ -d "$item" && -d "$dest" ]]; then
            # Both dirs: copy contents into existing dest (merge).
            cp -r "$item"/. "$dest"/ 2>/dev/null || cp -r "$item"/* "$dest"/ 2>/dev/null || true
        else
            cp -r "$item" "$dest"
        fi
    done

    log_success "Copied environment from $(basename "$env_dir")/ (merged)"
}

# =============================================================================
# CLI MODE
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    cmd="${1:-help}"
    shift || true

    case "$cmd" in
        verify)
            env_dir="${1:-}"
            if [[ -z "$env_dir" ]]; then
                die "Usage: $0 verify <env_dir> [required_files...]"
            fi
            shift
            verify_environment "$env_dir" "$@"
            ;;
        create-temp)
            prefix="${1:-claude_test_}"
            create_temp_dir "$prefix"
            ;;
        cleanup)
            dir="${1:-}"
            if [[ -z "$dir" ]]; then
                die "Usage: $0 cleanup <temp_dir>"
            fi
            cleanup_temp_dir "$dir"
            ;;
        write-skill)
            test_dir="${1:-}"
            skill_name="${2:-}"
            content="${3:-}"
            scripts_dir="${4:-}"
            source_dir="${5:-}"
            if [[ -z "$test_dir" || -z "$skill_name" || -z "$content" ]]; then
                die "Usage: $0 write-skill <test_dir> <skill_name> <content_file> [scripts_dir] [source_dir]"
            fi
            write_skill "$test_dir" "$skill_name" "$content" "$scripts_dir" "$source_dir"
            ;;
        write-claude-md)
            test_dir="${1:-}"
            content="${2:-}"
            if [[ -z "$test_dir" || -z "$content" ]]; then
                die "Usage: $0 write-claude-md <test_dir> <content_file>"
            fi
            write_claude_md "$test_dir" "$content"
            ;;
        copy-env)
            test_dir="${1:-}"
            env_dir="${2:-}"
            if [[ -z "$test_dir" || -z "$env_dir" ]]; then
                die "Usage: $0 copy-env <test_dir> <env_dir>"
            fi
            copy_environment "$test_dir" "$env_dir"
            ;;
        help|*)
            echo "Usage: $0 <command> [args...]"
            echo ""
            echo "Commands:"
            echo "  verify <env_dir> [files...]     Verify environment (Docker, Claude, keys)"
            echo "  create-temp [prefix]            Create temp directory"
            echo "  cleanup <temp_dir>              Remove temp directory"
            echo "  write-skill <dir> <name> <file> [scripts] [source]  Write skill to .claude/skills/"
            echo "  write-claude-md <dir> <file>    Write CLAUDE.md"
            echo "  copy-env <dir> <env_dir>        Copy environment files"
            ;;
    esac
fi
