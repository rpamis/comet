# .comet.yaml Field Reference

Canonical path: `comet/reference/comet-yaml-fields.md`

This file is the field reference for each change-level `.comet.yaml` state file under `openspec/changes/<name>/`.
Consult on demand; not loaded inline with skills. Project defaults live in `.comet/config.yaml`.

## Example

```yaml
workflow: full
language: en
phase: build
design_doc: docs/superpowers/specs/YYYY-MM-DD-topic-design.md
plan: docs/superpowers/plans/YYYY-MM-DD-feature.md
base_ref: a1b2c3d4e5f6...
build_mode: subagent-driven-development
build_pause: null
subagent_dispatch: confirmed
tdd_mode: tdd
review_mode: standard
auto_transition: true
isolation: branch
verify_mode: light
verify_result: pending
verification_report: null
branch_status: pending
created_at: 2026-05-26
verified_at: null
archived: false
```

## Required Fields

| Field | Meaning |
|-------|---------|
| `workflow` | `full`, `hotfix`, or `tweak` |
| `language` | Artifact language, `en` or `zh-CN`. Written to `.comet/config.yaml` by `comet init`, snapshotted into `.comet.yaml` when a change is created, and used as the main-language constraint for OpenSpec / Superpowers artifacts |
| `phase` | Current phase: `open`, `design`, `build`, `verify`, `archive` (init sets `open`; guard handles transitions) |
| `design_doc` | Associated Superpowers Design Doc path; may be empty |
| `plan` | Associated Superpowers Plan path; may be empty |
| `base_ref` | Git commit SHA recorded at init for scale assessment. Used as baseline for changed-file counting when no plan exists |
| `build_mode` | Selected execution mode; may be empty. Values: `subagent-driven-development` (isolated background subagents implement and review each task), `executing-plans` (main session executes sequentially by plan), `direct` (main session codes directly; allowed by default only for hotfix/tweak, full workflow requires `direct_override: true`) |
| `build_pause` | Build phase internal pause point. `null` = no pause, `plan-ready` = plan generated, paused for user model switch |
| `subagent_dispatch` | `null` or `confirmed`. Only when the platform's real background subagent/Task/multi-agent dispatch capability is confirmed may `build_mode: subagent-driven-development` be written and used to leave the build phase |
| `tdd_mode` | `tdd` or `direct`. Full workflow must select before leaving build. `tdd` forces write-failing-test-first per task; `direct` skips TDD enforcement. hotfix/tweak default to `direct` |
| `review_mode` | `off`, `standard`, or `thorough`. Full workflow must select before leaving build; hotfix/tweak default to `off` |
| `isolation` | `branch` or `worktree`, workspace isolation mode. Full init may be `null` but only until `/comet-build` Step 3; hotfix/tweak default to `branch` |
| `verify_mode` | `light` or `full`; may be empty |
| `auto_transition` | `true` or `false`. Only controls whether to automatically invoke the next skill after phase guard advances phase; `false` outputs `manual` from `comet-state next`, pausing next-skill invocation but not blocking phase field updates |
| `verify_result` | `pending`, `pass`, or `fail` |
| `verification_report` | Verification report file path; must point to an existing file before verify passes |
| `branch_status` | `pending` or `handled`; set to `handled` after branch handling completes |
| `created_at` | Change creation date (auto-written at init), format `YYYY-MM-DD` |
| `verified_at` | Verification pass timestamp; may be empty |
| `archived` | Whether the change has been archived |

## Optional Fields

| Field | Meaning |
|-------|---------|
| `direct_override` | `true`/`false`. Full workflow must explicitly set to `true` to use `build_mode: direct` |

## State Machine Hard Constraints

- Before `build → verify`, `isolation` must be `branch` or `worktree`
- Before `build → verify`, `build_mode` must be selected
- `build_mode: subagent-driven-development` requires `subagent_dispatch: confirmed`
- Full workflow must select `tdd_mode` as `tdd` or `direct` before leaving build
- Full workflow must select `review_mode` as `off`, `standard`, or `thorough` before leaving build
- `build_mode: direct` defaults to `hotfix`/`tweak` only; full workflow requires `direct_override: true`
- `build_pause` is not an execution mode; must not be written to `build_mode`
- These constraints exist in both `comet-guard.mjs build --apply` and `comet-state.mjs transition <name> build-complete`
- `preset-escalate` event: only allows `hotfix`/`tweak` workflow at `phase: build`; atomically sets `workflow`/`classic_profile` to `full`, rewinds `phase` to `design`, and clears `design_doc` (satisfying the comet-design entry requirement). This is the only legal channel for a preset → full upgrade — direct `set phase design` is hard-blocked by the state machine, and `set classic_profile` is a machine-owned field that cannot be set manually
