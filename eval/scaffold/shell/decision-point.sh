#!/usr/bin/env bash

set -uo pipefail

TEXT="${1:-}"
shift || true
shopt -s nocasematch

QUESTION_PATTERN='[?？][[:space:]]*$'
if [[ "$TEXT" =~ $QUESTION_PATTERN ]]; then
    exit 0
fi

INTERROGATIVE_PATTERN='(^|[[:space:]])(how|what|which|would|could|can|should|is|are|do|does|will|where|when|who)[[:space:]]+[^?？]*[?？]|(是否|怎样|如何|哪个|哪种|要不要)[^？]*？'
if [[ "$TEXT" =~ $INTERROGATIVE_PATTERN ]]; then
    exit 0
fi

REQUEST_PATTERN='(^|[.!。！][[:space:]]*)(please[[:space:]]+)?(confirm|choose|approve|select|provide|enter)[[:space:]]|(^|[.!。！][[:space:]]*)(would you|could you|can you|shall we|do you want|which (option|approach|name))'
if [[ "$TEXT" =~ $REQUEST_PATTERN ]]; then
    exit 0
fi

UNRESOLVED_PATTERN='(^|[^[:alnum:]_])(unresolved|blocking|need your (input|answer|decision|preference)|waiting for your (input|answer|decision|preference))([^[:alnum:]_]|$)'
for pattern in "$@"; do
    if [[ -n "$pattern" && "${TEXT,,}" == *"${pattern,,}"* && "$TEXT" =~ $UNRESOLVED_PATTERN ]]; then
        exit 0
    fi
done

exit 1
