#!/bin/bash
# Comet Handoff — creates machine-owned context packages between phases
# Usage: comet-handoff.sh <change-name> design --write [--full]
#        comet-handoff.sh <change-name> --hash-only

set -euo pipefail

COMET_BASH="${COMET_BASH:-${BASH:-bash}}"

red() { echo -e "\033[31m$1\033[0m" >&2; }
green() { echo -e "\033[32m$1\033[0m" >&2; }
warn() { echo -e "\033[33m$1\033[0m" >&2; }

validate_change_name() {
  local name="$1"
  if [ -z "$name" ]; then
    red "ERROR: Change name cannot be empty"
    exit 1
  fi
  if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    red "ERROR: Invalid change name: '$name'"
    red "Valid characters: a-z, A-Z, 0-9, -, _"
    exit 1
  fi
  if [[ "$name" =~ \.\. ]]; then
    red "ERROR: Change name cannot contain '..' (path traversal not allowed)"
    exit 1
  fi
}

strip_wrapping_quotes() {
  local value="$1"
  case "$value" in
    \"*\") printf '%s\n' "${value:1:${#value}-2}" ;;
    \'*\') printf '%s\n' "${value:1:${#value}-2}" ;;
    *) printf '%s\n' "$value" ;;
  esac
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

yaml_field_value() {
  local field="$1"
  local yaml="$CHANGE_DIR/.comet.yaml"
  local value
  value=$(grep "^${field}:" "$yaml" 2>/dev/null | sed "s/^${field}: *//" || true)
  value=$(strip_inline_comment "$value")
  strip_wrapping_quotes "$value"
}

hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    red "ERROR: sha256sum or shasum is required"
    exit 1
  fi
}

hash_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    red "ERROR: sha256sum or shasum is required"
    exit 1
  fi
}

source_files() {
  printf '%s\n' "$CHANGE_DIR/proposal.md"
  printf '%s\n' "$CHANGE_DIR/design.md"
  printf '%s\n' "$CHANGE_DIR/tasks.md"
  if [ -d "$CHANGE_DIR/specs" ]; then
    find "$CHANGE_DIR/specs" -path '*/spec.md' -type f 2>/dev/null | sort
  fi
}

compute_context_hash() {
  local hash_input
  hash_input=$(source_files | while IFS= read -r file; do
    if [ -f "$file" ]; then
      printf 'path:%s\n' "$file"
      printf 'sha256:%s\n' "$(hash_file "$file")"
    fi
  done)
  printf '%s' "$hash_input" | hash_stream
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

file_line_count() {
  local file="$1"
  wc -l < "$file" | tr -d ' '
}

write_file_excerpt() {
  local file="$1"
  local max_lines="$2"
  local total_lines
  total_lines=$(file_line_count "$file")

  echo "## $file"
  echo ""
  echo "- Source: $file"
  echo "- Lines: 1-$total_lines"
  echo "- SHA256: $(hash_file "$file")"
  echo ""

  if [ "$HANDOFF_MODE" = "full" ] || [ "$total_lines" -le "$max_lines" ]; then
    echo '```md'
    cat "$file"
    echo '```'
  else
    echo "[TRUNCATED]"
    echo ""
    echo '```md'
    sed -n "1,${max_lines}p" "$file"
    echo '```'
    echo ""
    echo "Full source: $file"
  fi
  echo ""
}

write_markdown_context() {
  local output="$1"
  {
    echo "# Comet Design Handoff"
    echo ""
    echo "- Change: $CHANGE"
    echo "- Phase: design"
    echo "- Mode: $HANDOFF_MODE"
    echo "- Context hash: $CONTEXT_HASH"
    echo ""
    echo "Generated-by: comet-handoff.sh"
    echo ""
    echo "OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary."
    echo ""
    source_files | while IFS= read -r file; do
      [ -f "$file" ] || continue
      write_file_excerpt "$file" 80
    done
  } > "$output"
}

write_json_context() {
  local output="$1"
  {
    echo "{"
    echo "  \"change\": \"$(json_escape "$CHANGE")\","
    echo "  \"phase\": \"design\","
    echo "  \"mode\": \"$HANDOFF_MODE\","
    echo "  \"canonical_spec\": \"openspec\","
    echo "  \"generated_by\": \"comet-handoff.sh\","
    echo "  \"context_hash\": \"$CONTEXT_HASH\","
    echo "  \"files\": ["
    local first=1
    while IFS= read -r file; do
      [ -f "$file" ] || continue
      if [ "$first" -eq 0 ]; then
        echo ","
      fi
      first=0
      printf '    { "path": "%s", "sha256": "%s" }' "$(json_escape "$file")" "$(hash_file "$file")"
    done < <(source_files)
    echo ""
    echo "  ]"
    echo "}"
  } > "$output"
}

write_spec_projection_for_file() {
  local file="$1"
  echo "## $file"
  echo ""
  echo "- Source: $file"
  echo "- Lines: 1-$(file_line_count "$file")"
  echo "- SHA256: $(hash_file "$file")"
  echo ""
  echo '```md'
  cat "$file"
  echo '```'
  echo ""
}

write_spec_markdown_context() {
  local output="$1"
  {
    echo "# Comet Spec Context"
    echo ""
    echo "- Change: $CHANGE"
    echo "- Phase: design"
    echo "- Mode: beta"
    echo "- Context hash: $CONTEXT_HASH"
    echo ""
    echo "Generated-by: comet-handoff.sh"
    echo ""
    echo "OpenSpec remains the canonical capability spec. This beta context pack verbatim-projects spec files and references supporting artifacts by hash, not an agent-authored summary."
    echo ""
    echo "## Source References"
    echo ""
    source_files | while IFS= read -r file; do
      [ -f "$file" ] || continue
      echo "- Source: $file"
      echo "- SHA256: $(hash_file "$file")"
    done
    echo ""
    echo "## Acceptance Projection"
    echo ""
    if [ -d "$CHANGE_DIR/specs" ]; then
      find "$CHANGE_DIR/specs" -path '*/spec.md' -type f 2>/dev/null | sort | while IFS= read -r file; do
        write_spec_projection_for_file "$file"
      done
    else
      echo "No delta spec files found."
      echo ""
    fi
    echo "Full source files remain canonical. If a required heading or scenario is missing here, regenerate the handoff or read the source spec directly. Supporting files (proposal, design, tasks) are referenced by hash only."
  } > "$output"
}

write_spec_json_context() {
  local output="$1"
  {
    echo "{"
    echo "  \"change\": \"$(json_escape "$CHANGE")\","
    echo "  \"phase\": \"design\","
    echo "  \"mode\": \"beta\","
    echo "  \"canonical_spec\": \"openspec\","
    echo "  \"generated_by\": \"comet-handoff.sh\","
    echo "  \"context_hash\": \"$CONTEXT_HASH\","
    echo "  \"files\": ["
    local first_file=1
    while IFS= read -r file; do
      [ -f "$file" ] || continue
      local role="supporting"
      case "$file" in
        */specs/*/spec.md) role="spec" ;;
      esac
      if [ "$first_file" -eq 0 ]; then
        echo ","
      fi
      first_file=0
      printf '    { "path": "%s", "sha256": "%s", "role": "%s" }' "$(json_escape "$file")" "$(hash_file "$file")" "$role"
    done < <(source_files)
    echo ""
    echo "  ]"
    echo "}"
  } > "$output"
}

CHANGE="${1:-}"
PHASE="${2:-}"
MODE="${3:-}"
FULL_FLAG="${4:-}"

validate_change_name "$CHANGE"

# --hash-only: compute and output context hash without generating handoff files
if [ "${PHASE:-}" = "--hash-only" ]; then
  CHANGE_DIR="openspec/changes/$CHANGE"
  if [ ! -d "$CHANGE_DIR" ]; then
    red "ERROR: change directory not found: $CHANGE_DIR"
    exit 1
  fi
  for required in proposal.md design.md tasks.md; do
    if [ ! -s "$CHANGE_DIR/$required" ]; then
      red "ERROR: required file missing or empty: $CHANGE_DIR/$required"
      exit 1
    fi
  done
  CONTEXT_HASH="$(compute_context_hash)"
  printf '%s
' "$CONTEXT_HASH"
  exit 0
fi

if [ "$PHASE" != "design" ] || [ "$MODE" != "--write" ]; then
  red "Usage: comet-handoff.sh <change-name> design --write [--full]"
  exit 1
fi
case "$FULL_FLAG" in
  "") HANDOFF_MODE="compact" ;;
  --full) HANDOFF_MODE="full" ;;
  *)
    red "Usage: comet-handoff.sh <change-name> design --write [--full]"
    exit 1
    ;;
esac

CHANGE_DIR="openspec/changes/$CHANGE"
YAML="$CHANGE_DIR/.comet.yaml"
SCRIPT_DIR="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")" 2>/dev/null || dirname "$0")"
STATE_SH="$SCRIPT_DIR/comet-state.sh"

if [ ! -d "$CHANGE_DIR" ]; then
  red "ERROR: change directory not found: $CHANGE_DIR"
  exit 1
fi
if [ ! -f "$YAML" ]; then
  red "ERROR: .comet.yaml not found at $YAML"
  exit 1
fi
if [ "$(yaml_field_value phase)" != "design" ]; then
  red "ERROR: design handoff requires phase: design"
  exit 1
fi

for required in proposal.md design.md tasks.md; do
  if [ ! -s "$CHANGE_DIR/$required" ]; then
    red "ERROR: required OpenSpec artifact missing or empty: $CHANGE_DIR/$required"
    exit 1
  fi
done

HANDOFF_DIR="$CHANGE_DIR/.comet/handoff"
CONTEXT_COMPRESSION="$(yaml_field_value context_compression 2>/dev/null || true)"
CONTEXT_COMPRESSION="${CONTEXT_COMPRESSION:-off}"
case "$CONTEXT_COMPRESSION" in
  off)
    CONTEXT_JSON="$HANDOFF_DIR/design-context.json"
    CONTEXT_MD="$HANDOFF_DIR/design-context.md"
    ;;
  beta)
    if [ "$HANDOFF_MODE" = "full" ]; then
      warn "[HANDOFF] --full is ignored in beta mode; spec files are projected verbatim"
    fi
    HANDOFF_MODE="beta"
    CONTEXT_JSON="$HANDOFF_DIR/spec-context.json"
    CONTEXT_MD="$HANDOFF_DIR/spec-context.md"
    ;;
  *)
    red "ERROR: invalid context_compression: $CONTEXT_COMPRESSION"
    red "Valid values: off, beta"
    exit 1
    ;;
esac
mkdir -p "$HANDOFF_DIR"

CONTEXT_HASH="$(compute_context_hash)"
if [ "$CONTEXT_COMPRESSION" = "beta" ]; then
  write_spec_markdown_context "$CONTEXT_MD"
  write_spec_json_context "$CONTEXT_JSON"
else
  write_markdown_context "$CONTEXT_MD"
  write_json_context "$CONTEXT_JSON"
fi

if [ -x "$STATE_SH" ] || [ -f "$STATE_SH" ]; then
  "$COMET_BASH" "$STATE_SH" set "$CHANGE" handoff_context "$CONTEXT_JSON" >/dev/null
  "$COMET_BASH" "$STATE_SH" set "$CHANGE" handoff_hash "$CONTEXT_HASH" >/dev/null
else
  red "ERROR: comet-state.sh not found; cannot record handoff fields"
  exit 1
fi

green "[HANDOFF] wrote $CONTEXT_JSON"
green "[HANDOFF] wrote $CONTEXT_MD"
green "[HANDOFF] handoff_hash=$CONTEXT_HASH"
