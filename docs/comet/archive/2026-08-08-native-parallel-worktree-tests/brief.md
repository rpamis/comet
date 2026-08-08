# Outcome

Add a deterministic, model-free Native regression test that exercises the real
parallel development topology: two Native changes opened from one repository
through Git linked worktrees. The test must prove that concurrent Runtime
operations finish within bounded time, remain isolated per worktree, and do not
leave the user blocked by a stale lock or transaction.

# Scope

- Add a focused Vitest test under `test/domains/comet-native/`.
- Create two real linked worktrees through the Native CLI and run independent
  Native CLI processes in parallel from those worktrees.
- Assert isolation of project root, branch, Native change, selection, runtime
  state, locks, and transactions.
- Cover the recovery path where a user manually edits a business source file
  while a change is progressing, then resumes the Native workflow. The source
  must remain user-authored; the Runtime must return a bounded, actionable
  stale/reverification or return-to-Build result instead of hanging or silently
  overwriting it.
- Add a package script and run the test in the existing cross-platform Runtime
  smoke CI matrix after the Native assets are built.

# Non-goals

- Do not invoke a model, network service, agent scheduler, or remote Git host.
- Do not introduce random stress testing, a new Native phase, or a production
  Runtime redesign as part of this change.
- Do not test two active changes by merely placing them under one project root;
  the scenario must use actual Git linked worktrees.
- Do not change Classic workflow behavior.

# Acceptance examples

- CI can run the test on Ubuntu, macOS, and Windows without model credentials
  or network access.
- Two linked-worktree Native changes can progress concurrently and each CLI
  invocation completes before the test timeout.
- A failure in one worktree cannot change the other worktree's selected change,
  branch, source file, checkpoint, or Runtime state.
- After a business-source manual edit, status/resume/continuation never waits
  indefinitely and never overwrites the edited bytes; any required stale
  evidence or re-build is reported as an explicit Native outcome.
- Test cleanup removes temporary repositories and linked worktrees, and the
  exercised Native Runtime has no leftover lock or transaction artifacts.

# Constraints and invariants

- Use the generated Native CLI bundles that CI has just built, launched as
  bounded child processes, so the test exercises process-level locks and the
  same entrypoints users run.
- Use fixed fixture content and bounded timeouts; avoid timing assertions and
  random scheduling.
- Keep all test state in temporary directories and clean it up even after a
  failed assertion.
- Preserve the existing Native phase, evidence, workspace-binding, and
  fail-closed semantics; the test must describe current behavior rather than
  weaken those contracts.

# Decisions

- The real parallel unit is a repository plus two linked worktrees, not two
  changes in one physical project directory.
- Cross-platform coverage belongs in the existing `runtime-smoke` matrix to
  reuse the already-built runtime assets without creating another CI job.
- Manual source edits are treated as user-authored input: Native may require a
  new Build/Verify cycle, but it must not silently revert the edit or block the
  workflow.

# Open questions

- None blocking. The exact CLI commands and assertions will follow the
  existing Native command contracts and generated bundle entrypoints.

# Verification expectations

- Run the focused parallel-worktree test locally first.
- Run formatting and lint checks for changed source, test, package, and CI
  files.
- Run the repository test suite before delivery because the change adds a
  cross-platform Runtime/CI guard.
