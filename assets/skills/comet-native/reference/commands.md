# Native Command Reference

Read this file only when you need options not listed by the main Skill, receipts, partial scope, or recovery commands.

## Project and change

Determine the current intent first; do not execute this section from top to bottom. Use read-only commands to establish facts, and run a write command only when its stated condition is met. After any write command, immediately reread `status <change-name>` and use the returned phase and continuation to decide what comes next.

### Enable Native for the first time

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
```

Use this only when the project has not enabled Native yet or when Native directories and language configuration need to be completed. It creates the required directories and writes `.comet/config.yaml`. Existing configuration keeps its current artifact root but may update the language. `init` does not migrate an existing artifact root; the command fails when an explicit `--root` conflicts with existing configuration.

Afterward, run `root show` to confirm the effective location. Do not use `init` as a resume command when a change already exists.

### Inspect or migrate the artifact root

```text
comet native root show
comet native root move <artifact-root>
```

`artifact-root` is project-relative.

- `root show` is read-only. It returns the project root, configured artifact root, effective Native directory, language, and any unfinished migration.
- `root move` is a transactional write operation. Run it only when the user explicitly wants to migrate the entire Native artifact root; it moves Native data and updates configuration. Do not simulate migration by editing configuration directly.

An unfinished migration blocks other Native writes. Run read-only `doctor` first, then follow its report and use `doctor --repair` to recover.

### Discover and read changes (read-only)

```text
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native show <change-name>
```

`status` without a change name returns paginated candidates. When multiple reasonable candidates remain, show the candidates and their phases to the user and ask them to choose. Do not guess.

- `status <change-name>` returns the phase, revision, check summary, next command, and continuation. Add `--details` when findings, checkpoint details, or acceptance items are needed.
- `show` returns state, the brief, and proposed specs. Use it only after identifying the target change to read requirements and specifications; it does not replace the phase and continuation check.
- When `findingsTruncated` is true, handle the returned findings and read details again.
- When `acceptancePage.nextCursor` is non-null, continue with `--acceptance-cursor`.
- When a change collection has a non-null `nextCursor`, continue with `--cursor`.

These commands do not modify selection, phase, or change content.

### Resume an existing change

```text
comet native select <change-name>
```

Run this only after the target change is unique or the user has explicitly selected it. `select` updates only the current Native selection and does not change the phase. A successful result returns that change's continuation.

After selecting, reread `status <change-name>`, confirm the phase, and then load the reference for that phase. Do not treat `select` as a phase-transition command.

### Create a new change

```text
comet native new <change-name> [--language en|zh-CN] \
  [--isolation current|branch|worktree] \
  [--change-branch <branch>] \
  [--target-branch <branch>]
```

Run `new` only after scanning registered working directories and confirming that no matching active change exists. When configuration is absent, it creates the default Native configuration and `docs/comet/`; it then creates a Shape change, makes it current, and returns a continuation plus the workspace binding.

`--isolation` defaults to `current`. For `branch` and `worktree`, the Agent first creates and enters the actual branch or worktree and passes the starting `--target-branch`; Runtime checks `--change-branch` against the current branch. `worktree` creation is accepted only in a linked Git worktree. A new change records its workspace mode, change branch, target branch, and physical working-directory identity; subsequent writes must remain aligned.

Exit code `73` with `error.code: workspace-isolation-required` means another active change appeared in the same working directory under the `new` mutation lock. Retry automatically in a new worktree only when the original mode was the system-default `current`. Reconfirm if an explicit user choice became invalid.

Immediately run `show <change-name>` and `status <change-name>`, then enter Shape clarification and shared-understanding confirmation. Do not create a new change to bypass a blocker, conflict, or recovery problem in an existing change.

### Correct the specification history

```text
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
```

Neither command is an ordinary file-editing command. `spec remove` records a specification operation that removes a capability; use it only when the target behavior truly requires that capability to be removed. `spec rebase` handles concurrent canonical specification changes only: reread the canonical specification, rewrite the complete target specification, and use the summary to record why the rebase was needed.

Both `spec remove` and `spec rebase` modify the change's specification history and return a new continuation. Immediately reread `status <change-name>` afterward. Do not edit operations, base hashes, or Runtime state manually.

## Checkpoints and checks

```text
comet native checkpoint <change-name> \
  --summary <text> \
  --next-action <text> \
  [--artifact <project-relative-path>]... \
  [--expect-revision <n>]

comet native check <change-name>
comet native evidence format [--entries <path>]
```

A checkpoint stores only recovery context and real artifact references. It does not change phase or replace completion evidence.

`check` is a built-in Native check, not a replacement for project tests. It exits with `1` when it finds issues or stale evidence.

`evidence format` reads acceptance entries from stdin or `--entries` and emits the canonical machine block for `verification.md`.

When submitting `pass`, the Runtime validates the report format, complete acceptance matrix, and acceptance receipts before it runs or reuses the built-in required check for the current scope. Fix `verification.md` from the reported error before retrying; do not repeatedly submit the same `next` command. `next` does not accept `--receipt`, and callers do not provide the required-check receipt.

## Acceptance receipts

Automated validation:

```text
comet native receipt automated <change-name> \
  [--acceptance <id>]... \
  [--timeout-ms <milliseconds>] \
  -- <executable> [args...]
```

Manual observation:

```text
comet native receipt manual <change-name> \
  --acceptance <id>... \
  --step <text> \
  --observation <text>
```

Create receipts only for commands or manual observations that actually occurred. Failed, skipped, blocked, or timed-out results cannot support pass.

Refresh stale receipts in bulk:

```text
comet native receipt refresh <change-name> [--apply]
```

A receipt is bound to the revision, contract, scope, snapshot, and artifacts in effect when it was issued. Any state write (checkpoint, spec refresh, phase advance) bumps the revision, which invalidates receipts issued before that bump. `next --result` then fails with `verification-receipt-binding-mismatch`, listing each stale receipt and the diverging field.

Without `--apply` (default) it is a preview: it reports which manual receipts are stale, which automated receipts must be re-run, and which required-check receipts must be regenerated via `comet native check`, without touching any file.

With `--apply`: it re-issues only stale manual receipts whose binding mismatch is limited to `sourceRevision`, and writes the canonical evidence block back into the `# Acceptance evidence` section of verification.md. Contract, scope, snapshot, or artifact mismatches remain manual verification blockers. Automated receipts are never silently re-issued (they attest to a real command execution); refresh only reports the commands you must re-run via `receipt automated`.

## Phase progression

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run [--finish merge|push|pull-request|keep]
comet native archive <change-name> --expect-preflight <sha256> [--confirmed]
```

- Shape: pass `--confirmed` only after the user confirms the final shared understanding.
- Build: provide a real `--artifact`; use `--no-code-reason` only when no project file changed. If changed requirements introduce a new user decision, stay in Build and repeat clarification and confirmation first. After confirmation, update the formal artifacts, then run the transition command returned by the Runtime with `--confirmed`.
- Partial scope: explain the exact gaps and risks returned by the Runtime. Changes beyond the returned detail budget are summarized by a `scope-detail-overflow` count and content hash; use the matching scope hash, reason, and `--confirmed` only after the user accepts them.
- Verify: provide `--result` and a complete report. For the standard report path, submit `comet native next <change-name> --summary <summary> --result pass|fail --report verification.md`. The Runtime validates the report format, complete acceptance matrix, and acceptance receipts before it runs or reuses the built-in required check for the current scope on pass; do not pass `--receipt`. Acceptance entries in the report reference automated/manual receipts directly. Executed failures reference their failed receipts, while checks that were not run include a `skipped_reason`. The Runtime derives failed acceptance and check identifiers from the report and receipts.
- Repair override: use only the signature returned by status and only for one explicit new repair hypothesis.
- Archive: use a plain dry-run for current isolation. For branch/worktree, after the user makes the joint finishing choice, pass `--finish` to persist it and generate a new preflight. Then use the exact preflight hash returned by that preview. `required` mode also requires explicit user confirmation. Never combine `--finish` with `--expect-preflight`.

## Diagnostics and recovery

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair
comet native doctor [<change-name>] --repair [--strategy continue|rollback]
```

Run read-only doctor first. Use `--repair` only when its report offers a repair action. Ordinary phase transitions support only `continue`; whether Archive or root move allows rollback is determined by doctor.

## Output and exit codes

Every command supports `--json`. JSON mode returns one object with `command`, `exitCode`, `data`, and `error` on failure.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Built-in check found issues or stale results |
| `64` | Invalid arguments or usage |
| `65` | Invalid configuration, state, or artifact |
| `73` | Lock, transaction, concurrency, or root conflict |
| `75` | Repair stagnation or failure budget blocks progress |
| `70` | Unexpected internal failure |
