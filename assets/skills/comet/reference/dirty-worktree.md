# Dirty Worktree Protocol

Canonical path: `comet/reference/dirty-worktree.md`

This protocol is shared by all Comet sub-skills that may modify code. When an agent resumes context or continues execution, it must handle uncommitted working tree changes through this protocol.

## 1. Checks

Before continuing or starting code changes, run:

```bash
git status --short
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
```

When needed, inspect `git diff`, `git diff --cached`, and newly created file contents.

## 2. Core Rules

- The user may not say which files they changed. If the worktree is dirty, including new files shown as `??` in Git status, assume changes may come from the user or mixed sources.
- **Build artifact exclusion**: `??` files matching `.gitignore` patterns (e.g., `node_modules/`, `dist/`, `__pycache__/`, `*.o`, `target/`, `build/`) are automatically skipped during attribution and not treated as user changes.
- A dirty worktree is code evidence only. It does not automatically advance `.comet.yaml` `phase` or check off `tasks.md`; Comet state may advance only after attribution, verification, required document synchronization, and the relevant phase guard.

## 3. Attribution

Classify dirty diffs into three groups:

1. **Belongs to the current change**: Files and content match the current change goal, tasks.md, plan, or delta spec. Incorporate the diff into the current task and avoid redoing the same work.
2. **Does not belong to the current change**: Files or content are unrelated. Pause and ask whether to include it in the current change, split it into a new change, leave it alone, or discard it with explicit authorization.
3. **Unclear source**: The diff and documents are not enough to determine ownership. Pause, report the file list and reasoning, and do not advance the phase.

## 4. Common Patterns

### Implemented But tasks.md Is Not Checked

Verify the implementation with build and tests. If it passes, check off the task. Do not redo work just because the task is unchecked, and do not ignore code evidence because state files lag behind. If the current sub-skill defines a phase-specific rule, follow that sub-skill.

### Plan Or Scope Changed

Follow the current sub-skill's escalation, incremental-update, or rollback rules. This protocol does not repeat phase-specific details.

### Ambiguous Resume Intent

When the user says things like "continue", "keep going", "I changed a bit", "I wasn't happy with it", "redo it", "code changed", or "use what is there", follow this protocol. Do not require the user to remember exactly what they changed.

### Code Changes During open/design

If the current phase is still `open` or `design` but the dirty worktree already contains code changes, first attribute the changes through this protocol and do not advance the phase directly:

- If the changes belong to the current change, treat them as requirements or design input and record them in proposal/design/spec/design doc/tasks as appropriate. The current phase guard must still pass before entering build.
- If the changes do not belong to the current change or ownership is unclear, pause and ask whether to include them, split them into a new change, leave them alone, or discard them with explicit authorization.
- Do not treat code changes made during open/design as completed implementation ready for verify.

## 5. Prohibitions

- Do not overwrite, revert, reformat over, or ignore user changes before understanding the dirty diff source.
- Do not mark verification as passed while dirty diff remains unexplained.
