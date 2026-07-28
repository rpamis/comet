# Native command reference

Prefer the installed `comet native` command. If the host exposes only Skill files, use this Skill's bundled runtime:

```text
node <comet-native-skill-root>/scripts/comet-native-runtime.mjs <command> [options]
```

Both entry points use the same arguments, stdout, stderr, and exit codes. Normal discovery searches upward from the current directory for `.comet/config.yaml` or the repository root; generated launchers may also pass the hidden `--project-root <path>` option.

## Project and artifact root

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>
```

`artifact-root` must be a project-relative path and defaults to `docs`. `.` creates `<project>/comet/`; `docs` creates `<project>/docs/comet/`. `init --language` persists the project's default Native language in `.comet/config.yaml`; later `new` commands inherit it when `--language` is omitted. Running `init --language` again changes the default for future changes without rewriting existing ones. Existing configuration rejects a conflicting `--root`. Change the root only through `root move`, never by editing configuration directly.

## Controller trust and review policy

```text
comet native trust keygen --identity <path> --private-key <outside-project-path>
comet native trust identity --private-key-env <name> --identity <path>
comet native trust policy \
  --implementation-identity <path> \
  --reviewer-identity <path>... \
  --waiver-identity <path>... \
  --controller-private-key-env <name>
comet native trust authorize <change-name> \
  --controller-private-key-env <name> \
  --output <path>
```

Before the first signed-v2 change, the host/controller provisions `~/.comet/native-controller-trust.json` in an external read-only boundary the current Agent cannot replace, binding the physical project-root hash to the controller's public identity. A regular POSIX file must be owned by a different UID, and neither the file nor its parent chain may be writable by the current process. A same-user local Windows file is not a trust anchor; the host must provide a Runtime-verifiable read-only mount capability or the Runtime fails closed. Native commands never create or modify this external store. Then prepare the public Ed25519 identities for implementation, review, and waiver signing. Only the external operator who owns a role may use `trust keygen` to persist its private key outside the project on POSIX where owner-only mode can be verified. Windows refuses private-key persistence; generate the key in an external secret store and use `trust identity --private-key-env` to export only its public identity. Never print a private key or write it into the project.

`trust policy` is a controller/operator provisioning primitive, not an ordinary step for the current implementation Agent. It signs the `.comet/native-review-trust.json` v2 policy with the controller key from the external trust root, uses an atomic exclusive write under the mutation lock, and may create the policy only when no active change exists. It cannot overwrite a policy. The controller, implementation, every reviewer, and every waiver signer must have globally distinct keys. `trust authorize` then signs a creation authorization valid only for the named change, physical project root, policy hash, and `signed-v2` protocol.

The current Agent must not receive controller, reviewer, or waiver-signer private-key values or perform those external signing operations. Every external invocation injects its signing environment variable once and clears it immediately after the command. Return only public identities, the authorization file, or receipt refs to the current Agent. Stop and report blocked when an owner/controller action is missing; never generate a replacement key, reuse the implementation key, or downgrade the protocol.

## Change management

```text
comet native new <change-name> --creation-authorization <path> [--language en|zh-CN]
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
comet native list [--cursor <token>]
comet native show <change-name>
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native select <change-name>
```

`new` creates default configuration and `<project>/docs/comet/` when configuration is absent, and writes `verification_protocol: signed-v2`. `--creation-authorization` is required. The Runtime validates the external controller trust, policy signature, and authorization bindings to the physical project root, policy, protocol, and change name. Baseline capture forcibly includes the public policy even when Git ignores `.comet/`, then stores the controller-signed creation-time policy snapshot and authorization in the change. Only an old change explicitly listed by the controller store reads as `legacy-v1`. A mismatch in the marker, creation binding, or external trust makes status, next, and Archive fail closed. Write complete target specifications at `specs/<capability>/spec.md`; `next` infers create/replace and freezes the canonical hash. Use `spec remove` to remove a capability instead of editing `spec_changes` or `verification_protocol`.

After a concurrent canonical change causes a conflict, reread and rewrite the complete target specification. Then use `spec rebase` to refresh operation/hash, return to Build, and clear the previous verification conclusion.

`show` returns state, the brief, and proposed complete specifications. `status` returns a bounded view of phase, evidence freshness, finding summary, checkpoint, repair state, and continuation. `status <change-name> --details` also returns:

- up to 50 detailed findings;
- the `findingsTruncated` flag;
- recovery details;
- the first `acceptancePage`.

When findings are truncated, handle the returned findings and then read details again. When `nextCursor` is non-null, pass it to `--acceptance-cursor` until it becomes null. Acceptance cursors are valid only with a specific change and `--details`, and bind to the current acceptance hash.

`status` and `show` are always read-only. Run `select` explicitly when resuming a confirmed target change; do not add a `resume` command. Both `new` and `select` write the shared project-level `.comet/current-change.json` with `workflow` fixed to `native`; neither modifies a Classic change.

`list` and `status` without a change name return the same read-only paginated projection, with at most 24 changes per page. Pass a non-null `nextCursor` back unchanged through `--cursor`. The cursor is bound to the complete visible name set; adding or removing changes makes an old cursor fail explicitly instead of shifting the page. At most 4096 visible changes are accepted, and a serialized page is capped at 512 KiB. `show` also bounds the number of specifications, per-file and cumulative reads, and final output size; it rejects oversized input instead of truncating requirement text.

## In-phase progress and built-in checks

```text
comet native checkpoint <change-name> \
  --summary <text> \
  --next-action <text> \
  [--artifact <project-relative-path>]... \
  [--expect-revision <n>]

comet native check <change-name>
comet native evidence format [--entries <path>]

comet native receipt manual <change-name> \
  --acceptance <id> \
  --responsible <text> \
  --step <text> \
  --observation <text> \
  --confirmed

comet native receipt automated <change-name> \
  [--acceptance <id>]... \
  [--timeout-ms <1..3600000>] \
  -- <executable> [args...]

comet native receipt implement <change-name> prepare \
  --identity <path> --output <preparation.json>
comet native receipt implement sign \
  --preparation <preparation.json> \
  --identity <path> --private-key-env <name> \
  --output <attestation.json>
comet native receipt implement <change-name> finalize \
  --preparation <preparation.json> \
  --attestation <attestation.json> \
  --confirmed

comet native receipt review <change-name> prepare \
  --implementation-receipt <ref> \
  --report <verification.md> \
  --required-receipt <ref> \
  --identity <path> \
  [--unified-io-receipt <ref> \
   --adversarial-paths-receipt <ref> \
   --generated-assets-receipt <ref> \
   --lifecycle-eval-receipt <ref>] \
  --output <preparation.json>
comet native receipt review <change-name> approve \
  --preparation <preparation.json> \
  [--attest-manual <ref>]... \
  [--findings <path>] \
  --checked-acceptance-applicability \
  --output <approval.json>
comet native receipt review sign \
  --approval <approval.json> \
  --identity <path> --private-key-env <name> \
  --output <attestation.json>
comet native receipt review <change-name> finalize \
  --preparation <preparation.json> \
  --approval <approval.json> \
  --attestation <attestation.json> \
  --confirmed

comet native receipt waive <change-name> \
  --acceptance <id> \
  --blocked-receipt <ref> \
  --reason <text> \
  --risk <text> \
  --alternative-receipt <ref> \
  --identity <path> \
  --private-key-env <name> \
  --confirmed
```

`checkpoint` stores only an in-phase summary, next action, and content-addressed artifact manifest. It uses revision/CAS to prevent overwrites and does not change the phase. `check` is available only in Verify after an implementation scope exists. It runs Comet's built-in bounded, read-only text scan without Git, a shell, project scripts, external Skills, or external processes, writes the raw result under `runtime/evidence/check-receipts/`, and binds that result into a typed static-inspection required receipt. A check that finds issues or becomes stale exits with 1 but still writes the receipts.

`receipt automated` executes the executable and argv after `--` directly, without a shell; global `--json`/`--project-root` parsing stops at `--`. The subprocess inherits only an allowlist of system environment values needed to run tests, never signing secrets. The default timeout is 120 seconds and the maximum is 3,600,000 milliseconds. Timeout terminates the process tree and produces a blocked receipt. Worktree drift or an after-fence scope/snapshot mismatch also blocks the receipt. Use `receipt manual` only for real human steps and observations, with explicit confirmation.

`receipt implement prepare/sign/finalize` separates Runtime derivation of current bindings, the complete acceptance set, and the run/scope execution ID from project-agnostic pure signing and private-key-free final revalidation. After the final report is complete, an external pre-trusted reviewer runs `receipt review prepare/approve/sign/finalize` with the attestation, report, and at least one required-check receipt. `approve` must run outside the current Agent: the Runtime rebuilds the canonical acceptance matrix, replays automated receipts, reruns static inspection, and requires the reviewer to cover every manual receipt with `--attest-manual`. The pure signer signs only the complete approval. Unresolved P0/P1 findings block a pass. High-risk scope must provide a real typed receipt for every unified-I/O, adversarial-path, generated-asset, and real lifecycle Eval check. `receipt waive` lets only an external pre-trusted waiver signer bind one non-passed blocking receipt and alternative automated/manual typed evidence. It cannot turn a failed/skipped/blocked result directly into pass or use a review as direct acceptance evidence.

Each signer/helper call receives its private-key environment variable only for that one invocation and clears it immediately afterward. Implementation/review `sign` is a pure signing boundary with no filesystem, project, Git, or subprocess access; in particular, never inject the private key into the reviewer `approve` process that replays project commands. The current Agent may request a signature and receive the receipt ref; it may not read private keys or sign for the reviewer/waiver signer. Verify and Archive use the same graph validator to recheck the matrix, policy, receipts, waivers, and replays. Any bound-fact change makes the review stale.

Before writing the `# Acceptance evidence` machine block, use `evidence format` to serialize the entries into canonical Markdown. It reads JSON from stdin or `--entries <path>` and emits the markers, fixed ordering, and indentation.

## Phase progression

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--receipt <runtime/evidence/receipts/...json>] \
  [--evidence-receipt <runtime/evidence/receipts/...json>]... \
  [--waiver <runtime/evidence/waivers/...json>]... \
  [--independent-review-receipt <runtime/evidence/receipts/...json>] \
  [--failure-category <token>]... \
  [--failed-check <token>]... \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <sha256> [--confirmed]
```

- Shape: advance after the brief and proposed specifications pass. Both Sequential and Batch must obtain the final shared-understanding confirmation and pass `--confirmed`. On successful entry to Build, the Runtime binds confirmed approval to the current contract hash.
- Build: recheck the brief and proposed specifications; provide at least one real project artifact or use `--no-code-reason`. An older change that still has `approval: implicit` must first confirm the current shared understanding. If the contract changed after approval, status/next requires the user to reconfirm the current contract. In either case, pass `--confirmed` only after obtaining confirmation. If complete scope cannot be proven, the first call returns a scope hash and bounded unattributed details without advancing; changes beyond the detail budget are represented by a `scope-detail-overflow` count and content hash. Retry only after the user accepts the specific risk, with the exact `--allow-partial-scope`, a reason, and `--confirmed`.
- Verify: provide both `--result` and a complete `--report`. A signed-v2 pass requires a fresh required receipt, acceptance receipt refs that exactly match the matrix, an independent acceptance-applicability review bound to a signed implementation attestation, and every waiver ref. Pass the review through both `--evidence-receipt` and `--independent-review-receipt`. `--receipt` may be omitted to run the built-in check under the lock. Failed/skipped/blocked/scan-limited/timed-out/invalid receipts block a pass, and every high-risk review check is mandatory. A failure returns to Build and may use failure categories and check IDs to form a no-progress signature; a pass enters Archive.
- Repair: the third identical failure returns a manual stop. A genuine scope change on an ordinary Build `next` closes the old repair episode and continues. With unchanged scope, only one override is allowed, using the exact signature returned by status plus a non-empty summary. Neither a semantic repair budget nor an exhausted override can be bypassed; the generic Run iteration is only an event sequence number, not a permanent stop condition for a long-lived change.
- Archive: only `archive` completes this phase; `next` cannot substitute for it. First run `--dry-run`; the preview returns a `preflightHash` and continuation bound to `native.archive_confirmation`. `automatic` commits with the unchanged hash from continuation. `required` returns `await-user`, and only an explicit **Archive now** choice permits committing with the unchanged hash plus `--confirmed`. The runtime recomputes the facts under the mutation lock and runs a final freshness fence after spec operations but before the `archive-change` move. Configuration or content drift leaves the active change in place for recovery by the same transaction.

## Diagnosis and recovery

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair
comet native doctor [<change-name>] --repair [--strategy continue|rollback]
```

Read-only doctor does not modify files. `--repair` is limited to provably safe selection cleanup, stale locks, evidence retention, ordinary phase transitions, workspace identity repair, and deterministic transaction recovery. It never rewrites user-authored YAML, Markdown, or specifications.

`--strategy` is an optional transaction-recovery argument, not a requirement for ordinary repair. Ordinary transitions support only `continue`, not `rollback`.

Doctor also reports evidence-retention candidates without changing them. Explicit `--repair` removes only derived evidence/receipts in active changes that are at least 30 days old, outside the latest 32 items of each evidence kind, and proven unreferenced by the dependency closure. Archived evidence, current-state references, dependencies, newer files, and the latest 32 of every kind are always retained. Removal is ordered dependents before dependencies and first moves files into a same-directory quarantine. After interruption, read-only doctor reports recovery required; explicit repair restores files only when there is no overwrite and identity still matches. Pending journals, damage, source/quarantine conflicts, and unknown or special files fail closed rather than deleting data to reclaim space.

Ordinary write commands such as `new`, `next`, `archive`, and `root move` never take over stale locks automatically. Only explicit `doctor --repair` may do so after proving the local owner is gone, lock identity is unchanged, and no conflicting recovery transaction exists. Active locks and locks that cannot be proven stale are always preserved.

## Output and exit codes

Every command supports `--json`. JSON mode emits exactly one object with `command`, `exitCode`, `data`, and a structured `error` on failure.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Built-in `check` completed but found issues or became stale |
| `64` | Invalid arguments or usage |
| `65` | Invalid configuration, state, or artifacts |
| `73` | Lock, transaction, concurrent hash, or root conflict |
| `75` | Repair stagnation or a hard stop blocks continuation |
| `70` | Unexpected internal failure |
