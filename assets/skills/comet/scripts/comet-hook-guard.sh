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
  echo "[COMET-HOOK] allowed: no file path in tool input" >&2
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
      */archive/*) continue ;;
    esac
    if [ -f "${dir}.comet.yaml" ]; then
      YAML_FILE="${dir}.comet.yaml"
      break
    fi
  done
fi

# No active change — allow all writes
if [ -z "$YAML_FILE" ]; then
  echo "[COMET-HOOK] allowed: no active comet change" >&2
  exit 0
fi

# ── Read current phase ───────────────────────────────────────────

PHASE=$(grep "^phase:" "$YAML_FILE" 2>/dev/null \
  | awk '{print $2}' \
  | tr -d '[:space:][:cntrl:]' \
  || true)

if [ -z "$PHASE" ]; then
  echo "[COMET-HOOK] allowed: no phase in .comet.yaml" >&2
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
    CWD_PHYS=$(norm "$(pwd -P 2>/dev/null || pwd)")

    # Try: TARGET as-is vs CWD logical
    if [ "${RELPATH#"$CWD_UNIX"/}" != "$RELPATH" ]; then
      RELPATH="${RELPATH#"$CWD_UNIX"/}"
    # Try: TARGET as-is vs CWD physical (macOS /var → /private/var)
    elif [ "${RELPATH#"$CWD_PHYS"/}" != "$RELPATH" ]; then
      RELPATH="${RELPATH#"$CWD_PHYS"/}"
    else
      # Resolve TARGET's parent through filesystem (handles symlinked TARGET path)
      _PDIR=$(cd "$(dirname "$TARGET")" 2>/dev/null && pwd -P 2>/dev/null || true)
      if [ -n "$_PDIR" ]; then
        _TRESOLVED=$(norm "${_PDIR}/$(basename "$TARGET")")
        if [ "${_TRESOLVED#"$CWD_UNIX"/}" != "$_TRESOLVED" ]; then
          RELPATH="${_TRESOLVED#"$CWD_UNIX"/}"
        elif [ "${_TRESOLVED#"$CWD_PHYS"/}" != "$_TRESOLVED" ]; then
          RELPATH="${_TRESOLVED#"$CWD_PHYS"/}"
        fi
      fi
    fi
    ;;
esac

# ── Whitelist: phase-aware allowed paths ─────────────────────────

case "$RELPATH" in
  openspec/*)
    # OpenSpec artifacts — phase-aware sub-check
    case "$PHASE" in
      open)
        # open: allow proposal, design, tasks, yaml, handoff, specs
        case "$RELPATH" in
          */proposal.md|*/design.md|*/tasks.md|*/.openspec.yaml|*/.comet.yaml|*/.comet/*|*/specs/*)
            echo "[COMET-HOOK] allowed: $RELPATH (phase: open, openspec artifacts)" >&2
            exit 0
            ;;
        esac
        ;;
      design)
        # design: allow handoff, delta spec (Spec Patch), proposal/design/tasks (minor refinements), .comet.yaml
        case "$RELPATH" in
          */proposal.md|*/design.md|*/tasks.md|*/.comet/*|*/specs/*|*/.comet.yaml|*/.openspec.yaml)
            echo "[COMET-HOOK] allowed: $RELPATH (phase: design, handoff/spec)" >&2
            exit 0
            ;;
        esac
        ;;
      build)
        # build: allow delta spec (incremental update), tasks, .comet.yaml
        case "$RELPATH" in
          */specs/*|*/tasks.md|*/.comet.yaml|*/.openspec.yaml)
            echo "[COMET-HOOK] allowed: $RELPATH (phase: build, spec/tasks)" >&2
            exit 0
            ;;
        esac
        ;;
      verify)
        # verify: allow tasks (post-check), .comet.yaml
        case "$RELPATH" in
          */tasks.md|*/.comet.yaml|*/.openspec.yaml)
            echo "[COMET-HOOK] allowed: $RELPATH (phase: verify, tasks/state)" >&2
            exit 0
            ;;
        esac
        ;;
      archive)
        # archive: allow .comet.yaml state updates only
        case "$RELPATH" in
          */.comet.yaml|*/.openspec.yaml)
            echo "[COMET-HOOK] allowed: $RELPATH (phase: archive, state)" >&2
            exit 0
            ;;
        esac
        ;;
    esac
    ;;
  docs/superpowers/*)
    # Superpowers artifacts — phase-aware sub-check
    case "$PHASE" in
      design)
        echo "[COMET-HOOK] allowed: $RELPATH (phase: design, superpowers)" >&2
        exit 0
        ;;
      build)
        echo "[COMET-HOOK] allowed: $RELPATH (phase: build, superpowers)" >&2
        exit 0
        ;;
      verify)
        echo "[COMET-HOOK] allowed: $RELPATH (phase: verify, superpowers)" >&2
        exit 0
        ;;
    esac
    # open/archive: block docs/superpowers writes
    ;;
  .comet/*|*/.comet/*)
    # Comet config
    echo "[COMET-HOOK] allowed: $RELPATH (whitelist: comet config)" >&2
    exit 0
    ;;
  .claude/*)
    # Claude settings/rules
    echo "[COMET-HOOK] allowed: $RELPATH (whitelist: claude config)" >&2
    exit 0
    ;;
  CLAUDE.md|CHANGELOG.md|README.md|*.md)
    # Root-level markdown files
    case "$RELPATH" in
      */*) ;; # subdirectory .md — NOT whitelisted, fall through
      *)
        echo "[COMET-HOOK] allowed: $RELPATH (whitelist: root markdown)" >&2
        exit 0
        ;;
    esac
    ;;
  .comet.yaml|comet.yaml|.comet.yml|comet.yml)
    # Project-level comet config
    echo "[COMET-HOOK] allowed: $RELPATH (whitelist: comet config)" >&2
    exit 0
    ;;
esac

# ── Phase-based enforcement ──────────────────────────────────────

case "$PHASE" in
  build|verify)
    # Code writes allowed in build and verify
    echo "[COMET-HOOK] allowed: $RELPATH (phase: $PHASE)" >&2
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

echo "[COMET-HOOK] allowed: $RELPATH (phase: $PHASE)" >&2
exit 0
