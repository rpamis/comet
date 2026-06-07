#!/bin/bash
# comet-hook-guard.sh — PreToolUse hook for Comet phase enforcement
#
# Blocks file writes (Write/Edit) when the active Comet change is in
# a phase that does not allow source code modifications (open/design/archive).
#
# Usage (called by harness, not directly):
#   PreToolUse matcher "Write|Edit" → this script
#   Stdin:  JSON  {"tool_name":"Write|Edit","tool_input":{"file_path":"..."}}
#   Exit 0  = allow
#   Exit 2  = blocked (stderr message shown to user)
#
# Cross-platform: macOS / Linux / Windows Git Bash
# shellcheck disable=SC2329

set -euo pipefail

# ── Extract target file path ──────────────────────────────────────

TARGET=""

# Method 1: FILE_PATH environment variable (set by some harnesses)
if [ -n "${FILE_PATH:-}" ]; then
  TARGET="$FILE_PATH"
fi

# Method 2: Parse stdin JSON
if [ -z "$TARGET" ]; then
  INPUT=""
  if [ ! -t 0 ]; then
    INPUT=$(cat 2>/dev/null || true)
  fi
  if [ -n "$INPUT" ]; then
    # Extract file_path value — works for both Write and Edit tool inputs
    TARGET=$(printf '%s' "$INPUT" \
      | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null \
      | head -1 \
      | sed 's/^"file_path"[[:space:]]*:[[:space:]]*"//' \
      | sed 's/"$//' \
      || true)
  fi
fi

# No target found — allow (not a file-path-bearing operation)
if [ -z "$TARGET" ]; then
  exit 0
fi

# Normalize to forward slashes, collapse doubles from JSON escaping (\\ → //)
TARGET=$(printf '%s' "$TARGET" | sed 's|\\|/|g' | sed 's|///*|/|g')

# ── Find active Comet change ─────────────────────────────────────

YAML_FILE=""
if [ -d "openspec/changes" ]; then
  for dir in openspec/changes/*/; do
    [ -d "$dir" ] || continue
    # Skip archived changes
    case "$dir" in
      */archive/*|*/archive/) continue ;;
    esac
    if [ -f "${dir}.comet.yaml" ]; then
      YAML_FILE="${dir}.comet.yaml"
      break
    fi
  done
fi

# No active change — allow all writes
if [ -z "$YAML_FILE" ]; then
  exit 0
fi

# ── Read current phase ───────────────────────────────────────────

PHASE=$(grep "^phase:" "$YAML_FILE" 2>/dev/null \
  | awk '{print $2}' \
  | tr -d '[:space:][:cntrl:]' \
  || true)

if [ -z "$PHASE" ]; then
  exit 0
fi

# ── Resolve to project-relative path ─────────────────────────────

# Normalize helper: forward slashes only
norm() { printf '%s' "$1" | sed 's|\\|/|g'; }

RELPATH=$(norm "$TARGET")

# If already relative, use as-is
case "$RELPATH" in
  /*|[A-Za-z]:/*)
    # Absolute — try stripping CWD prefixes
    CWD_UNIX=$(norm "$(pwd)")
    if [ "${RELPATH#"$CWD_UNIX"/}" != "$RELPATH" ]; then
      RELPATH="${RELPATH#"$CWD_UNIX"/}"
    else
      # Git Bash on Windows: pwd -W gives Windows-style path
      CWD_WIN=$(norm "$(pwd -W 2>/dev/null || pwd)")
      if [ "${RELPATH#"$CWD_WIN"/}" != "$RELPATH" ]; then
        RELPATH="${RELPATH#"$CWD_WIN"/}"
      fi
    fi
    ;;
esac

# ── Whitelist: always allowed regardless of phase ────────────────

case "$RELPATH" in
  openspec/*)
    # OpenSpec artifacts (proposal, design, tasks, specs, handoff)
    exit 0
    ;;
  docs/superpowers/*)
    # Design Docs, plans
    exit 0
    ;;
  .comet/*|*/.comet/*)
    # Comet config
    exit 0
    ;;
  .claude/*)
    # Claude settings/rules
    exit 0
    ;;
  CLAUDE.md|CHANGELOG.md|README.md|*.md)
    # Root-level markdown files
    case "$RELPATH" in
      */*) ;; # subdirectory .md — NOT whitelisted, fall through
      *) exit 0 ;;
    esac
    ;;
  .comet.yaml|comet.yaml|.comet.yml|comet.yml)
    # Project-level comet config
    exit 0
    ;;
esac

# ── Phase-based enforcement ──────────────────────────────────────

case "$PHASE" in
  build|verify)
    # Code writes allowed in build and verify
    exit 0
    ;;
  open|design|archive)
    echo "" >&2
    echo "╔══════════════════════════════════════════╗" >&2
    echo "║     COMET PHASE GUARD — WRITE BLOCKED    ║" >&2
    echo "╚══════════════════════════════════════════╝" >&2
    echo "" >&2
    echo "  当前阶段: $PHASE" >&2
    echo "  目标文件: $RELPATH" >&2
    echo "" >&2
    case "$PHASE" in
      open)
        echo "  ❌ open 阶段不允许写源代码" >&2
        echo "  ✅ 允许: 创建 proposal/design/tasks, 运行 guard" >&2
        echo "  💡 完成需求澄清和 artifact 创建后运行 guard --apply" >&2
        ;;
      design)
        echo "  ❌ design 阶段不允许写源代码" >&2
        echo "  ✅ 允许: brainstorming, 创建 Design Doc, 运行 guard" >&2
        echo "  💡 完成 Design Doc 后运行 comet-guard design --apply 进入 build" >&2
        ;;
      archive)
        echo "  ❌ archive 阶段不允许写源代码" >&2
        echo "  ✅ 允许: 确认归档, 运行归档脚本" >&2
        ;;
    esac
    echo "" >&2
    exit 2
    ;;
esac

exit 0
