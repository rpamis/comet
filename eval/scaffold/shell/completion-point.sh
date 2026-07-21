#!/usr/bin/env bash

set -uo pipefail

TEXT="${1:-}"
shopt -s nocasematch

NEGATED_PATTERN='(archive|workflow|change)([[:space:]]+is)?[[:space:]]+not[[:space:]]+(complete|completed|archived)|not[[:space:]]+(yet[[:space:]]+)?(complete|completed|archived)|not[[:space:]]+completed[[:space:]]+through[[:space:]]+archive|not[[:space:]]+([^[:space:]]+[[:space:]]+){0,3}archived'
if [[ "$TEXT" =~ $NEGATED_PATTERN ]]; then
    exit 1
fi

COMPLETION_PATTERN='archive(d)?([[:space:]]+is)?[[:space:]]+(complete|completed)|change([[:space:]]+is)?[[:space:]]+archived|native[[:space:]]+change[^[:cntrl:]]*archived|archived[[:space:]]+(at|to)|completed[[:space:]]+through[[:space:]]+archive|completed[[:space:]]+through[[:space:]]+all[[:space:]]+phases[[:space:]]+and[[:space:]]+archived|terminal[[:space:]]+archived[[:space:]]+state|fully[[:space:]]+archived|workflow([[:space:]]+is)?[[:space:]]+(complete|completed)|all[[:space:]]+(5|five)[[:space:]]+phases([[:space:]]+are)?[[:space:]]+(complete|completed|recorded)'
if [[ "$TEXT" =~ $COMPLETION_PATTERN ]]; then
    exit 0
fi

exit 1
