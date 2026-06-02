#!/bin/bash
# Comet script locator — source this file to export paths to bundled scripts.
#
# Usage:
#   . /path/to/comet/scripts/comet-env.sh
#
# This file is sourced by workflow snippets. Do not set global shell options here.

_comet_env_source="${BASH_SOURCE[0]:-$0}"
_comet_script_dir="$(cd "$(dirname "$_comet_env_source")" && pwd -P)"
_comet_env_sourced=0
(return 0 2>/dev/null) && _comet_env_sourced=1

export COMET_GUARD="${COMET_GUARD:-${_comet_script_dir}/comet-guard.sh}"
export COMET_STATE="${COMET_STATE:-${_comet_script_dir}/comet-state.sh}"
export COMET_HANDOFF="${COMET_HANDOFF:-${_comet_script_dir}/comet-handoff.sh}"
export COMET_ARCHIVE="${COMET_ARCHIVE:-${_comet_script_dir}/comet-archive.sh}"
export COMET_YAML_VALIDATE="${COMET_YAML_VALIDATE:-${_comet_script_dir}/comet-yaml-validate.sh}"

_comet_bash_is_usable() {
  local _comet_bash_candidate="$1"
  if [ -z "$_comet_bash_candidate" ]; then
    return 1
  fi
  case "$_comet_bash_candidate" in
    */Windows/System32/bash.exe|*/windows/system32/bash.exe|*\\Windows\\System32\\bash.exe|*\\windows\\system32\\bash.exe)
      return 1
      ;;
  esac
  "$_comet_bash_candidate" -lc 'printf comet-bash-ok' >/dev/null 2>&1
}

_comet_resolve_bash() {
  local _comet_bash_candidate

  if _comet_bash_is_usable "${COMET_BASH:-}"; then
    printf '%s\n' "$COMET_BASH"
    return 0
  fi

  if _comet_bash_is_usable "${BASH:-}"; then
    printf '%s\n' "$BASH"
    return 0
  fi

  _comet_bash_candidate="$(command -v sh 2>/dev/null | awk '{ sub(/\/sh(\.exe)?$/, "/bash.exe"); print }')"
  if _comet_bash_is_usable "$_comet_bash_candidate"; then
    printf '%s\n' "$_comet_bash_candidate"
    return 0
  fi

  _comet_bash_candidate="$(command -v bash 2>/dev/null || true)"
  if _comet_bash_is_usable "$_comet_bash_candidate"; then
    printf '%s\n' "$_comet_bash_candidate"
    return 0
  fi

  return 1
}

COMET_BASH="$(_comet_resolve_bash || true)"
export COMET_BASH

_comet_env_fail() {
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed completely." >&2
  echo "Expected path pattern: */comet/scripts/comet-*.sh under project or platform skill directories" >&2
}

_comet_bash_fail() {
  echo "ERROR: usable bash not found. Install Git Bash or set COMET_BASH to a working bash executable." >&2
  echo "Windows WSL launcher bash.exe is not supported for Comet scripts." >&2
}

_comet_env_abort() {
  local _comet_env_was_sourced="$_comet_env_sourced"
  unset _comet_env_source _comet_script_dir _comet_script _comet_env_missing _comet_env_sourced
  unset _comet_bash_candidate
  unset -f _comet_env_fail _comet_bash_fail _comet_bash_is_usable _comet_resolve_bash
  if [ "$_comet_env_was_sourced" -eq 1 ]; then
    unset -f _comet_env_abort
    return 1
  fi
  exit 1
}

_comet_env_missing=0
if [ -z "$COMET_BASH" ]; then
  _comet_bash_fail
  _comet_env_missing=1
fi
for _comet_script in \
  "$COMET_GUARD" \
  "$COMET_STATE" \
  "$COMET_HANDOFF" \
  "$COMET_ARCHIVE" \
  "$COMET_YAML_VALIDATE"; do
  if [ ! -f "$_comet_script" ]; then
    _comet_env_fail
    _comet_env_missing=1
    break
  fi
done

if [ "$_comet_env_missing" -ne 0 ]; then
  _comet_env_abort
else
  unset _comet_env_source _comet_script_dir _comet_script _comet_env_missing _comet_env_sourced
  unset _comet_bash_candidate
  unset -f _comet_env_fail _comet_bash_fail _comet_bash_is_usable _comet_resolve_bash _comet_env_abort
fi
