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

# ── Helpers to read .comet.yaml fields ───────────────────────────

is_archived() {
  grep "^archived:" "$1" 2>/dev/null \
    | awk '{print $2}' | tr -d '[:space:][:cntrl:]' || true
}

read_phase() {
  grep "^phase:" "$1" 2>/dev/null \
    | awk '{print $2}' | tr -d '[:space:][:cntrl:]' || true
}

read_field() {
  grep "^$1:" "$2" 2>/dev/null \
    | head -1 | awk '{print $2}' | tr -d '[:space:][:cntrl:]' || true
}

# ── Determine the governing Comet change + phase ─────────────────
#
# A write targeting a specific change directory (openspec/changes/<name>/...)
# must be governed by THAT change's own phase — never by an unrelated
# active change. Otherwise a change left in the `archive` phase would
# wrongly block artifact writes for a brand-new change created alongside it.

PHASE=""
# Path to the .comet.yaml that governs this write (used for deeper invariant checks)
GOV_YAML=""

case "$RELPATH" in
  openspec/changes/*/*)
    _rest="${RELPATH#openspec/changes/}"
    _own_change="${_rest%%/*}"
    if [ -n "$_own_change" ] && [ "$_own_change" != "archive" ]; then
      _own_yaml="openspec/changes/${_own_change}/.comet.yaml"
      if [ -f "$_own_yaml" ]; then
        if [ "$(is_archived "$_own_yaml")" = "true" ]; then
          # This change is already archived — its own writes are unrestricted
          echo "[COMET-HOOK] allowed: $RELPATH (own change archived)" >&2
          exit 0
        fi
        PHASE=$(read_phase "$_own_yaml")
        GOV_YAML="$_own_yaml"
      else
        # Change directory exists but state file not yet written
        # (artifacts are created before .comet.yaml during /comet-open).
        # Treat as `open` so proposal/design/tasks/specs are allowed.
        PHASE="open"
      fi
    fi
    ;;
esac

# Fallback: writes outside a specific change directory are governed by
# the first active (non-archived) change.
if [ -z "$PHASE" ]; then
  YAML_FILE=""
  if [ -d "openspec/changes" ]; then
    for dir in openspec/changes/*/; do
      [ -d "$dir" ] || continue
      # Skip archived changes directory
      case "$dir" in
        */archive/*) continue ;;
      esac
      if [ -f "${dir}.comet.yaml" ]; then
        # Skip changes already marked as archived
        if [ "$(is_archived "${dir}.comet.yaml")" = "true" ]; then
          continue
        fi
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

  PHASE=$(read_phase "$YAML_FILE")
  GOV_YAML="$YAML_FILE"
fi

if [ -z "$PHASE" ]; then
  echo "[COMET-HOOK] allowed: no phase in .comet.yaml" >&2
  exit 0
fi

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
    # Full workflow must have a Design Doc before any source write in build/verify.
    # Catches illegal open→build / design→build jumps that skipped the design phase
    # (e.g. misclassified preset, direct `set phase`, or bare transition).
    if [ -n "$GOV_YAML" ]; then
      _wf=$(read_field "workflow" "$GOV_YAML")
      _dd=$(read_field "design_doc" "$GOV_YAML")
      if [ "$_wf" = "full" ] && { [ -z "$_dd" ] || [ "$_dd" = "null" ]; }; then
        echo "" >&2
        echo "╔══════════════════════════════════════════╗" >&2
        echo "║     COMET PHASE GUARD — WRITE BLOCKED    ║" >&2
        echo "╚══════════════════════════════════════════╝" >&2
        echo "" >&2
        echo "  Current phase: $PHASE (workflow: full), but design_doc is empty" >&2
        echo "  Target file: $RELPATH" >&2
        echo "" >&2
        echo "  ❌ Illegal phase jump detected: full workflow entered $PHASE without a Design Doc" >&2
        echo "  ✅ Correct flow: create the Design Doc in design phase, then run comet-guard design --apply" >&2
        echo "  💡 Run /comet-design to fill the missing design; for repair, set design_doc with comet-state" >&2
        echo "" >&2
        exit 2
      fi
    fi
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
    echo "  Current phase: $PHASE" >&2
    echo "  Target file: $RELPATH" >&2
    echo "" >&2
    case "$PHASE" in
      open)
        echo "  ❌ open phase does not allow source code writes" >&2
        echo "  ✅ Allowed: create proposal/design/tasks and run guard" >&2
        echo "  💡 After clarification and artifact creation, run guard --apply" >&2
        ;;
      design)
        echo "  ❌ design phase does not allow source code writes" >&2
        echo "  ✅ Allowed: brainstorming, create the Design Doc, and run guard" >&2
        echo "  💡 After the Design Doc is ready, run comet-guard design --apply to enter build" >&2
        ;;
      archive)
        echo "  ❌ archive phase does not allow source code writes" >&2
        echo "  ✅ Allowed: confirm archive intent and run the archive script" >&2
        ;;
    esac
    echo "" >&2
    exit 2
    ;;
esac

echo "[COMET-HOOK] allowed: $RELPATH (phase: $PHASE)" >&2
exit 0
