#!/bin/bash
# Comet Archive — automates the archive phase in one command
# Usage: comet-archive.sh <change-name> [--dry-run]
# Exit 0 = archive complete, exit 1 = fatal error

set -euo pipefail

COMET_BASH="${COMET_BASH:-${BASH:-bash}}"
COMET_OPENSPEC="${COMET_OPENSPEC:-openspec}"

red() { echo -e "\033[31m$1\033[0m" >&2; }
green() { echo -e "\033[32m$1\033[0m" >&2; }
yellow() { echo -e "\033[33m$1\033[0m" >&2; }

DRY_RUN=0
if [[ "${2:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

# Input validation
validate_change_name() {
  local name="$1"
  if [ -z "$name" ]; then
    red "FATAL: Change name cannot be empty"
    exit 1
  fi
  if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    red "FATAL: Invalid change name: '$name'"
    red "Valid characters: a-z, A-Z, 0-9, -, _"
    exit 1
  fi
  if [[ "$name" =~ \.\. ]]; then
    red "FATAL: Change name cannot contain '..'"
    exit 1
  fi
}

CHANGE="$1"
validate_change_name "$CHANGE"

CHANGE_DIR="openspec/changes/$CHANGE"
YAML="$CHANGE_DIR/.comet.yaml"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
STATE_SH="$SCRIPT_DIR/comet-state.sh"
TODAY=$(date -u +%Y-%m-%d)
ARCHIVE_NAME="${TODAY}-${CHANGE}"
ARCHIVE_DIR="openspec/changes/archive/${ARCHIVE_NAME}"

STEPS_OK=0
STEPS_TOTAL=0

step_ok() {
  green "  [OK] $1"
  STEPS_OK=$((STEPS_OK + 1))
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
}

step_fail() {
  red "  [FAIL] $1"
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
}

step_dry_run() {
  yellow "  [DRY-RUN] $1"
  STEPS_OK=$((STEPS_OK + 1))
  STEPS_TOTAL=$((STEPS_TOTAL + 1))
}

echo "=== Comet Archive: $CHANGE ===" >&2

# --- Step 1: Read .comet.yaml, extract paths ---

yaml_field() {
  local field="$1"
  if [ -f "$STATE_SH" ]; then
    "$COMET_BASH" "$STATE_SH" get "$CHANGE" "$field" 2>/dev/null
  else
    if [ -f "$YAML" ]; then
      local value
      value=$(grep "^${field}:" "$YAML" 2>/dev/null | sed "s/^${field}: *//" || true)
      value=$(strip_inline_comment "$value")
      strip_wrapping_quotes "$value"
    fi
  fi
}

strip_inline_comment() {
  local value="$1"
  printf '%s\n' "$value" | awk -v squote="'" '
    {
      out = ""
      quote = ""
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (quote == "") {
          if (c == "\"" || c == squote) {
            quote = c
          } else if (c == "#" && (i == 1 || substr($0, i - 1, 1) ~ /[[:space:]]/)) {
            sub(/[[:space:]]+$/, "", out)
            print out
            next
          }
        } else if (c == quote) {
          quote = ""
        }
        out = out c
      }
      print out
    }
  '
}

strip_wrapping_quotes() {
  local value="$1"
  case "$value" in
    \"*\") printf '%s\n' "${value:1:${#value}-2}" ;;
    \'*\') printf '%s\n' "${value:1:${#value}-2}" ;;
    *) printf '%s\n' "$value" ;;
  esac
}

if [ ! -f "$YAML" ]; then
  red "FATAL: .comet.yaml not found in $CHANGE_DIR/"
  exit 1
fi

DESIGN_DOC=$(yaml_field "design_doc")
PLAN_PATH=$(yaml_field "plan")

# --- Step 2: Validate entry state ---

PHASE_VAL=$(yaml_field "phase")
VERIFY_VAL=$(yaml_field "verify_result")
ARCHIVED_VAL=$(yaml_field "archived")

if [ "$PHASE_VAL" != "archive" ]; then
  red "FATAL: phase is '$PHASE_VAL', expected 'archive'"
  exit 1
fi

if [ "$VERIFY_VAL" != "pass" ]; then
  red "FATAL: verify_result is '$VERIFY_VAL', expected 'pass'. Run comet-verify first."
  exit 1
fi

if [ "$ARCHIVED_VAL" = "true" ]; then
  red "FATAL: change already archived"
  exit 1
fi

step_ok "Entry state verified"

# --- Step 3: Check archive target ---

if [ -d "$ARCHIVE_DIR" ]; then
  red "FATAL: archive target already exists: $ARCHIVE_DIR"
  exit 1
fi

step_ok "Archive target available"

# --- Step 4: Prepare document frontmatter annotation ---

annotate_frontmatter() {
  local file="$1"
  local extra_fields="$2"

  if [ ! -f "$file" ]; then
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    step_dry_run "Would annotate: $file"
    return 0
  fi

  if head -1 "$file" | grep -q '^---'; then
    local tmp_file
    tmp_file=$(mktemp)
    chmod 600 "$tmp_file"
    awk -v archive="$ARCHIVE_NAME" -v extra="$extra_fields" '
      /^archived-with:/ { next }
      NR==1 && /^---/ { print; next }
      /^---/ && NR>1 {
        print "archived-with: " archive
        if (extra != "") print extra
        print; next
      }
      { print }
    ' "$file" > "$tmp_file"
    mv "$tmp_file" "$file"
  else
    local tmp_file
    tmp_file=$(mktemp)
    chmod 600 "$tmp_file"
    {
      echo "---"
      echo "archived-with: $ARCHIVE_NAME"
      if [ -n "$extra_fields" ]; then
        echo "$extra_fields"
      fi
      echo "status: final"
      echo "---"
      cat "$file"
    } > "$tmp_file"
    mv "$tmp_file" "$file"
  fi

  step_ok "Annotated: $file"
}

# --- Step 5: Run OpenSpec archive for delta merge and move ---

verify_main_specs_clean() {
  if [ ! -d "openspec/specs" ]; then
    return 0
  fi

  local found=0
  local matches
  for spec_file in openspec/specs/*/spec.md; do
    [ -f "$spec_file" ] || continue
    matches=$(grep -nE '^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements$' "$spec_file" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      red "FATAL: delta-only section heading leaked into main spec: $spec_file"
      printf '%s\n' "$matches" >&2
      found=1
    fi
  done

  if [ "$found" -ne 0 ]; then
    return 1
  fi
  return 0
}

resolve_archive_dir() {
  if [ -d "$ARCHIVE_DIR" ]; then
    return 0
  fi
  # Fallback: search for any directory matching *-$CHANGE in archive
  local found
  found=$(find "openspec/changes/archive" -maxdepth 1 -mindepth 1 -type d -name "*-$CHANGE" 2>/dev/null | head -1 || true)
  if [ -n "$found" ]; then
    ARCHIVE_DIR="$found"
    ARCHIVE_NAME=$(basename "$found")
    return 0
  fi
  return 1
}

if [ "$DRY_RUN" -eq 1 ]; then
  step_dry_run "Would run OpenSpec archive: $CHANGE"
else
  if ! command -v "$COMET_OPENSPEC" >/dev/null 2>&1; then
    red "FATAL: OpenSpec CLI not found: $COMET_OPENSPEC"
    red "Install OpenSpec or set COMET_OPENSPEC to the openspec executable."
    exit 1
  fi

  "$COMET_OPENSPEC" archive "$CHANGE" --yes >&2
  if ! resolve_archive_dir; then
    step_fail "OpenSpec archive output not found"
    exit 1
  else
    step_ok "OpenSpec archive completed: $ARCHIVE_DIR"
  fi

  verify_main_specs_clean
  step_ok "Main specs verified clean"
fi

# --- Step 6: Annotate design doc and plan frontmatter ---

if [ -n "$DESIGN_DOC" ] && [ "$DESIGN_DOC" != "null" ]; then
  annotate_frontmatter "$DESIGN_DOC" "status: final"
fi

if [ -n "$PLAN_PATH" ] && [ "$PLAN_PATH" != "null" ]; then
  annotate_frontmatter "$PLAN_PATH" ""
fi

# --- Step 7: Mark archived via comet-state transition ---

ARCHIVE_YAML="$ARCHIVE_DIR/.comet.yaml"

if [ "$DRY_RUN" -eq 1 ]; then
  step_dry_run "Would set archived: true in $ARCHIVE_YAML"
else
  if [ -f "$ARCHIVE_YAML" ]; then
    "$COMET_BASH" "$STATE_SH" transition "$ARCHIVE_NAME" archived >/dev/null
    step_ok "archived: true"
  else
    step_fail "archived: true (.comet.yaml not found after move)"
  fi
fi

# --- Step 8: Print summary ---

echo "" >&2
if [ "$DRY_RUN" -eq 1 ]; then
  yellow "Dry run complete. $STEPS_OK/$STEPS_TOTAL steps would succeed."
else
  green "Archive complete. $STEPS_OK/$STEPS_TOTAL steps succeeded."
fi

if [ "$STEPS_OK" -lt "$STEPS_TOTAL" ]; then
  exit 1
fi

exit 0
