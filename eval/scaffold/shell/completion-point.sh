#!/usr/bin/env bash

set -uo pipefail

TEXT="${1:-}"
shopt -s nocasematch

# SDK 应用以评估绑定的根 Run 为准，子流程文案不能结束评估。
if [[ -n "${COMET_EVAL_APPLICATION_ID:-}" ]]; then
    node --input-type=module <<'JS'
import { listWorkflowApplicationRunRecords } from '@rpamis/comet/applications';
try {
    const records = await listWorkflowApplicationRunRecords(process.cwd());
    const owned = records.filter(item => item.applicationId === process.env.COMET_EVAL_APPLICATION_ID);
    if (owned.some(item => item.error || !item.record)) process.exit(1);
    const roots = owned.map(item => item.record).filter(record => record.run.lineage.length === 0);
    const completed = roots.length > 0 && roots.every(root => root.run.status === 'completed'
        && root.application.version === process.env.COMET_EVAL_APPLICATION_VERSION
        && root.application.contentHash === process.env.COMET_EVAL_APPLICATION_HASH);
    process.exit(completed ? 0 : 1);
} catch { process.exit(1); }
JS
    exit $?
fi

ROOT_COMPLETION_PATTERN='(parent|main|root)[[:space:]]+(workflow([[:space:]]+is)?[[:space:]]+(complete|completed)|change([[:space:]]+is)?[[:space:]]+archived|is[[:space:]]+archived)'
if [[ "$TEXT" =~ (child|sub)[[:space:]-]*workflow[^.!?]*complete && ! "$TEXT" =~ $ROOT_COMPLETION_PATTERN ]]; then
    exit 1
fi

NEGATED_PATTERN='(archive|workflow|change)([[:space:]]+is)?[[:space:]]+not[[:space:]]+(complete|completed|archived)|not[[:space:]]+(yet[[:space:]]+)?(complete|completed|archived)|not[[:space:]]+completed[[:space:]]+through[[:space:]]+archive|not[[:space:]]+([^[:space:]]+[[:space:]]+){0,3}archived|nothing[^[:cntrl:]]*archived[[:space:]]+yet|will[[:space:]]+not[[:space:]]+archive[[:space:]]+until'
if [[ "$TEXT" =~ $NEGATED_PATTERN ]]; then
    exit 1
fi

# 多个指定 Run 的交付完成也是结束陈述；最终真伪仍由任务校验器核对。
# 只识别句首明确的全体对象，不能把部分完成或条件句当成完成。
REQUESTED_RUNS_COMPLETION_PATTERN='(^|[.!?;[:cntrl:]])[[:space:]]*(all[[:space:]]+(specified|requested)|the[[:space:]]+(three|3)[[:space:]]+(specified|requested))[[:space:]]+runs[[:space:]]+(are[[:space:]]+)?completed[^.!?;[:cntrl:]]*verified[[:space:]]+local[[:space:]]+deliveries'
COMPLETION_TEXT="${TEXT//\`/}"
REQUESTED_PROFILES_COMPLETION_PATTERN='(^|[.!?;[:cntrl:]])[[:space:]]*all[[:space:]]+(three|3)[[:space:]]+(specified|requested)[[:space:]]+profiles[[:space:]]+(were|are)[[:space:]]+completed[[:space:]]+and[[:space:]]+delivered'
if [[ "$COMPLETION_TEXT" =~ $REQUESTED_RUNS_COMPLETION_PATTERN || "$COMPLETION_TEXT" =~ $REQUESTED_PROFILES_COMPLETION_PATTERN ]]; then
    exit 0
fi

COMPLETION_PATTERN='archive(d)?([[:space:]]+is)?[[:space:]]+(complete|completed)|change([[:space:]]+is)?[[:space:]]+archived|native[[:space:]]+change[^[:cntrl:]]*[^[:alnum:]_]archived|archived[[:space:]]+(at|to)|completed[[:space:]]+through[[:space:]]+archive|completed[[:space:]]+through[[:space:]]+all[[:space:]]+phases[[:space:]]+and[[:space:]]+archived|terminal[[:space:]]+archived[[:space:]]+state|fully[[:space:]]+archived|workflow([[:space:]]+is)?[[:space:]]+(complete|completed)|all[[:space:]]+(5|five)[[:space:]]+phases([[:space:]]+are)?[[:space:]]+(complete|completed|recorded)'
BOUNDED_COMPLETION_PATTERN="(^|[^[:alnum:]_])($COMPLETION_PATTERN)([^[:alnum:]_]|$)"
if [[ "$TEXT" =~ $BOUNDED_COMPLETION_PATTERN ]]; then
    exit 0
fi

exit 1
