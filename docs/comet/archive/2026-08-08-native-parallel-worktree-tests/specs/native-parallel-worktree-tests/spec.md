# native-parallel-worktree-tests

## Purpose

Provide a deterministic CI regression guard for Native's actual parallel
development flow. The guard must exercise independent Git linked worktrees and
process-level Native Runtime coordination without requiring a model or network.

## Requirements

### Requirement: Real linked-worktree topology

The regression test MUST create a temporary Git repository with a committed
business source fixture and use the Native CLI to create two changes with
`worktree` isolation from the repository's primary worktree.

#### Scenario: Two changes are opened in parallel

- **WHEN** the test starts two distinct Native `new` operations concurrently
  from the primary worktree
- **THEN** Native MUST create or reuse two distinct linked worktrees
- **AND** each change MUST have a distinct change name, branch, physical
  project root, and selected-workspace binding
- **AND** the test MUST NOT model parallelism by putting two changes in one
  physical project root

#### Scenario: Worktree preparation is bounded

- **WHEN** either linked-worktree preparation or its initial Native command is
  delayed or fails
- **THEN** the child process MUST terminate with a bounded diagnostic
- **AND** the test MUST fail rather than wait indefinitely
- **AND** cleanup MUST still remove the temporary worktrees and repository

### Requirement: Process-level Native isolation

The test MUST run Native CLI commands as separate child processes from each
linked worktree and MUST verify that concurrent operations do not cross the
workspace boundary.

#### Scenario: Independent changes progress concurrently

- **WHEN** both linked worktrees concurrently run supported Native status,
  checkpoint, and continuation/progress operations
- **THEN** every command MUST finish within the test timeout
- **AND** each command MUST resolve its own change from its own physical
  worktree
- **AND** one worktree MUST NOT mutate the other worktree's selection, phase,
  checkpoint, runtime state, lock, or transaction journal

#### Scenario: Runtime artifacts are isolated

- **WHEN** both changes have completed their concurrent operations
- **THEN** each worktree MUST retain only its own Native Runtime state
- **AND** no cross-worktree lock or transaction artifact MAY remain
- **AND** the test MUST report the owning worktree and command when an
  isolation assertion fails

### Requirement: Manual business-source edit is recoverable

The test MUST cover a user editing a declared business source file while a
Native change is progressing and then resuming the workflow.

#### Scenario: Resume after a manual source edit

- **WHEN** a linked-worktree change has established a Build/verification
  boundary and the user changes the business source bytes manually
- **AND** the user invokes Native status/resume/continuation from that same
  linked worktree
- **THEN** Native MUST preserve the manually edited source bytes
- **AND** the command MUST finish within the bounded timeout
- **AND** Native MUST return either a valid continuation or an explicit,
  actionable stale-evidence/reverification or return-to-Build outcome
- **AND** Native MUST NOT silently claim that the old implementation evidence
  still describes the changed source

#### Scenario: Manual edit in one worktree does not affect the other

- **WHEN** the business source is manually edited in worktree A during the
  recovery scenario
- **THEN** worktree B's source bytes, change state, and Runtime artifacts MUST
  remain unchanged

### Requirement: Model-free cross-platform CI coverage

The test MUST be runnable from a dedicated package script and MUST be included
in the existing cross-platform Runtime smoke job after Native Runtime assets
are built.

#### Scenario: CI runs without model or network credentials

- **WHEN** the Runtime smoke matrix runs on Ubuntu, macOS, or Windows
- **THEN** the parallel-worktree test MUST use only local Git, Node, Native
  bundles, and temporary filesystem state
- **AND** it MUST NOT read model credentials or call a model/network endpoint

#### Scenario: Generated Native entrypoints stay covered

- **WHEN** Native Runtime source or command entrypoints change
- **THEN** the existing Native build step MUST regenerate the bundles before
  the parallel-worktree test runs
- **AND** the test MUST fail if the generated entrypoint cannot execute the
  real scenario

## Non-goals

- This change does not add randomized stress, remote Git operations, PR/merge
  behavior, or agent scheduling coverage.
- This change does not weaken Native's Build scope sealing, Verify evidence,
  Archive conflict detection, or Hook Guard policy.
- This change does not combine Native and Classic state machines.
