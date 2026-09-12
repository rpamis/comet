# Dirty Worktree Protocol

Canonical path: `comet-classic/reference/dirty-worktree.md`

All Comet sub-skills that modify code follow this protocol. On context recovery or continuation, handle uncommitted workspace changes through it. A phase may add its own rules, such as Verify's requirements for implementation changes; follow the phase Skill for those details.

## 1. Inspect the Workspace

Before continuing or starting edits, run:

```bash
git status --short
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
```

Inspect `git diff`, `git diff --cached`, and new-file contents as needed.

## 2. Core Rules

- Users may not say what they changed. Treat uncommitted work (including new files shown as `??`) as potentially user-authored or produced by several contributors.
- **Exclude build outputs**: if a `??` file matches a `.gitignore` pattern such as `node_modules/`, `dist/`, `__pycache__/`, `*.o`, `target/`, or `build/`, skip attribution automatically; do not treat it as a user edit.
- Code changes in the workspace do not authorize updating `.comet.yaml` `phase` or checking off `tasks.md`. First establish origin and ownership, verify the work, update required documents, and pass the corresponding phase Guard.

## 3. Determine Which Work the Changes Belong To

Classify uncommitted changes into three groups:

1. **Current change**: files and content match this change's goal, tasks.md, plan, or delta spec. Incorporate them and continue without repeating the same edits.
2. **Unrelated to the current change**: files or content do not match its goal. Pause and ask whether to include them, create a separate change, leave them untouched, or explicitly authorize discarding them.
3. **Uncertain origin**: diff and documents do not establish ownership. Pause, report the files and evidence, and do not advance the phase.

## 4. Common Cases

### Implementation Exists but tasks.md Is Unchecked

Verify the implementation with build and tests, then record completion. An unchecked task does not justify redoing work, and stale state does not justify ignoring implementation. Follow any phase-specific requirements in the current Skill.

### The Plan or Scope Has Changed

Follow the current Skill's escalation, incremental-update, or rollback rules. This reference does not repeat phase-specific cases.

### The User Has Not Described the Edits

Apply this protocol when the user says “continue,” “keep going,” “I changed something,” “the previous result was unsatisfactory,” “redo it,” “the code changed,” or “use the current version” without describing the edits. Do not require the user to reconstruct what they changed first.

### Code Changes Exist During open/design

If phase is still `open` or `design` but code changes exist, establish origin and ownership before advancing:

- Current-change edits: record them as requirement/design input in proposal/design/spec/design doc/tasks. The relevant phase Guard must still pass before build.
- Unrelated or uncertain edits: ask whether to include them, split a new change, leave them untouched, or explicitly authorize discarding them.
- Do not treat code changes during open/design as completed implementation and jump to verify.

## 5. Prohibited Actions

- Do not overwrite, revert, reformat away, or ignore user changes before establishing their origin.
- Do not declare verification passed without explaining the origin and ownership of these edits.
