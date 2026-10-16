# Task learning completion

Before finishing a task, the Agent checks personal preferences and project experience separately and prepares a temporary UTF-8 JSON file. The user does not write this JSON. Keep the file out of change artifacts and commits.

```json
{
  "schema": "comet.task-learning.v1",
  "personal": { "check": "no-observation" },
  "project": { "check": "no-observation" }
}
```

Set each `check` independently: `submitted` means submitting content now or holding its receipt; `no-observation` means the Agent checked and found nothing reusable; `not-run` means no check occurred. Missing records do not prove that a check occurred.

To save content, add the relevant arrays and set that section's `check` to `submitted`:

- `personal.observations`: user corrections, preferences, or collaboration habits reusable across tasks. Each item contains `scope` (`project` or `global`), `category`, `text`, and a stable `candidateKey`; preserve the minimum user quotation in `userEvidence`. Put actual user restrictions in `phases`, `pathPatterns`, `taskTypes`, and `operations`. When the user explicitly asks to remember something long term, still call `comet memory remember` immediately instead of delaying until completion.
- `project.memories`: experience verified in this project and reusable in future tasks. Each item contains `title` and `text`, with optional `type`, `description`, `slug`, `paths`, and `evidence`. `evidence` is an array of project-relative file paths supporting the conclusion; omit it for confirmed collaboration decisions without file evidence. The same title updates the existing lesson by default.
- `project.memorySlugs`: receipts saved earlier for this change through `comet knowledge remember`; do not submit their bodies again.
- `project.reviews`: review decisions for this change, shaped as `{ "id": "...", "actions": [] }`. Only when the completion response reports pending reviews, run `comet knowledge review <project-root> --workflow <workflow> --change <change-id> --json` for evidence and required fields. Review them and put the decisions in this array; use empty `actions` when nothing is reusable. Submit reviews and lessons in the same file.
- `outcomes`: feedback on context actually used with a known result, containing `applicationId` and `outcome`. Use `used-successfully` only after adopting the context and passing verification, with `evidence.decision` and `evidence.verification` (`command`, `success: true`). Never mark unused items as successful.

Personal Memory must not store task summaries, implementation progress, command output, test results, or shared repository facts. Project experience must not store one-off output or unverified guesses. Each array permits at most 16 items, and the entire learning file must fit within 256 KiB.

Submit once and finish the learning check:

```text
comet task <project-root> --task "<original user request>" --complete --workflow <native|classic> --change <change-id> --learning-file <temporary-JSON-file> --json
```

When using a file, do not also pass `--learning-check`, `--project-learning-check`, or `--memory`. The command binds workflow and change; do not repeat them inside array items.

Completion requires `learningSubmission.status` to be `applied`, the personal check to be verified, `projectLearning.submissionVerified` to be `true`, and both pending project review and processing counts to be zero. `accepted` means work remains pending; `partial` means some writes failed. Read `personalObservations`, `errors`, and `learningSubmission.nextActions`, address the actual cause, and resubmit the same file after correction; existing receipts prevent duplicate creation. Explain ignored or skipped observations. After confirming that no qualifying observation exists, remove it and declare `no-observation`; do not create placeholder memories. Report `not-run`, delays, changed sources, and failed calls explicitly. Incomplete learning does not block an otherwise completed development task.

When an older version does not support `--learning-file`, use the existing single-item commands and explicit check flags. Do not repeatedly retry an unsupported option.
