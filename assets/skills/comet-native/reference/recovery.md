# Native Recovery Reference

Read this file only when Runtime reports interruption, stale evidence, repair stop, conflict, migration, or damaged state.

## General rule

Stop writing, rerun `status --details --json`, and run read-only `doctor`. Execute only actions returned by the continuation, findings, or doctor. Do not edit state, workspace, hashes, evidence, locks, or transactions. Preserve the scene and wait for the user when automatic repair cannot be proven safe.

## Workspace

`status` searches registered worktrees for the binding-consistent change and returns its actual `workspace.projectRoot`. Resume and `select` there. Do not copy an active change, recreate the same name elsewhere, or edit workspace metadata to take ownership.

Root, branch, worktree-kind, or Git-availability binding errors block writes. If the original directory or branch is truly lost, preserve artifacts and inspect doctor; only the user chooses whether to restore the directory, reconstruct from a trusted backup, or abandon the change. Legacy root advisories do not block by themselves or authorize automatic baseline refresh.

## Transition, baseline, and evidence

- Unfinished transition: retry through the continuation first; doctor permits only the continue/rollback direction it explicitly returns.
- Entire project-local Runtime missing: `status` still shows the change state with `runtime.status: missing`; explicitly execute its `next` continuation to rebuild execution context. Shape remains in Shape, Build remains in Build, and Verify/Archive returns to Build for revalidation. This cannot restore another device's Run, trajectory, or unsynchronized content.
- Runtime present but baseline missing, incomplete, or damaged: treat it as `invalid`; restore a trusted original or execute only a repair explicitly allowed by doctor. Never infer a baseline from current files or overwrite damaged evidence automatically.
- Legacy `<change>/runtime` layout: normal reads remain compatible; use `comet native doctor <change> --repair` to migrate it explicitly into `.comet/runtime/native/`. Do not move it manually.
- Changed brief, specification, implementation, report, or receipt: return to Build, reconfirm affected behavior, regenerate scope, and reverify. Do not reuse an old pass or preflight.
- Receipt binding mismatch: follow its classification. Refresh only source-revision-only manual receipts; rerun automated receipts; reverify contract, scope, snapshot, or artifact mismatches.

## Verify fail and repair stop

After Verify fail, read failed or missing acceptance items and failed checks, actually repair them, and verify again.

`repair-stagnation-stop` is not a user decision. Form one different concrete hypothesis from the current signature, make the corresponding change, and apply one override. Do not ask the user for a signature or hash.

Only `repair-continuation-decision` asks the user to choose whether to continue trying, change the confirmed contract, or stop. You update configuration or formal artifacts and execute follow-up actions.

## Specification and Archive conflicts

When a canonical specification changes, reread the latest canonical, brief, and proposed complete specification; rewrite according to user intent, execute the finding's rebase action, then implement and verify again. Never overwrite concurrent changes.

For interrupted Archive or root move, use only the transaction and direction returned by doctor. If journal, paths, or actual files disagree, preserve both sides; do not invent a rollback or delete either side.

If `workspaceFinishResult.status` is `blocked`, the change may already be archived or committed. Inspect Git state with `recoveryArgs` first. Do not repeat Archive, reuse an old preflight, force-remove the worktree, or merge/push again from an unknown state.

## Damaged state

- Never delete locks manually; repair only when doctor explicitly permits it.
- Do not guess and rewrite damaged config, change, brief, specification, or verification content.
- Preserve the scene and stop when owner, transaction, or file identity cannot be established.
