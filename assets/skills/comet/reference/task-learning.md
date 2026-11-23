# Use and save memory on demand

- **Look up lessons when troubleshooting.** Check the context already delivered. If an error looks like a recurring project issue or you need to confirm a project convention, run `comet knowledge query <project-root> --task "<error or convention>" --json`. Add `--path` when you know the relevant file or directory. Expand a relevant summary when you need details and check the lesson against current evidence. Use `comet memory retrieve` when you need to confirm a personal preference.
- **Save reusable lessons after a fix passes verification.** Decide whether the approach could save investigation on a future task. If so, use `comet knowledge remember` and record the symptom, when the approach applies, what worked, and the actual verification result. Include `--workflow` and `--change` when known, and keep the returned slug. When the user explicitly asks you to remember a long-term preference, save it immediately with `comet memory remember` using the scope they gave you.

Use the workflow's completion command. When there is no learning submission, use the default `not-run` and finish without creating an empty learning file or calling review to check an empty queue. If you checked both areas and found nothing to submit, you can use `--complete --learning-check no-observation --project-learning-check no-observation`. For checks you skipped, do not claim they occurred.

## Batch submission

Use a temporary UTF-8 JSON file when submitting several observations or lessons together, or when combining known pending review decisions or actual-use feedback. The Agent prepares the file and keeps it in a temporary location.

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

Report the result using `learningSubmission.status`. `applied` means the submission took effect, `accepted` means it was received with work still pending, and `partial` means some writes failed. When more work is needed, use `personalObservations`, `errors`, and `learningSubmission.nextActions` to decide what to do. You can resubmit the same file after correcting the failing items. Existing receipts are reused. Development can finish while learning is still pending.

Implicit workflow events enter the existing learning queue without waiting for maintenance on the advancement path. Continue pending observations with `comet memory sync`; queued does not mean effective, and does not require repeatedly submitting the same learning file. Explicit remember/forget requests and evidenced adoption feedback still run immediately. Platforms without an idle-event adapter require an explicit sync; installing the plugin does not connect every chat automatically.

When an older version does not support `--learning-file`, use the existing single-item commands and explicit check flags. Do not repeatedly retry an unsupported option.
