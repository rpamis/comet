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
LABELLED_QUESTION_PATTERN='(question|问题)[*[:space:]]*:[*[:space:]]*(whether|how|what|which|would|could|can|should|is|are|do|does|will|where|when|who|是否|怎样|如何|哪个|哪种|要不要)'
REQUEST_PATTERN='(^|[.!。！][[:space:]]*)(please[[:space:]]+)?(confirm|choose|approve|select|provide|enter)[[:space:]]|(^|[.!。！][[:space:]]*)(would you|could you|can you|shall we|do you want|which (option|approach|name))|(please[[:space:]]+)?(reply|respond)[^.!?。！？]*(confirm|approve)'

# Evaluate question and request syntax one line at a time. A completed summary can
# contain an interrogative-looking decision label on one line and punctuation
# examples such as `?!` on a later line; treating the whole response as one regex
# span incorrectly turns that summary into another simulated user round.
while IFS= read -r line; do
    if [[ "$line" =~ $INTERROGATIVE_PATTERN || "$line" =~ $LABELLED_QUESTION_PATTERN || "$line" =~ $REQUEST_PATTERN ]]; then
        exit 0
    fi
done <<< "$TEXT"

UNRESOLVED_PATTERN='(^|[^[:alnum:]_])(unresolved|blocking|need your (input|answer|decision|preference)|waiting for your (input|answer|decision|preference))([^[:alnum:]_]|$)'
for pattern in "$@"; do
    if [[ -n "$pattern" && "${TEXT,,}" == *"${pattern,,}"* && "$TEXT" =~ $UNRESOLVED_PATTERN ]]; then
        exit 0
    fi
done

exit 1
