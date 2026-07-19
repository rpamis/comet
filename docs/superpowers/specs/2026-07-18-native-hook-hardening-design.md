# Native Hook Hardening Design

## Goal

Strengthen the Comet Native phase Hook so ordinary implementation writes cannot silently bypass Shape, Verify, or Archive through an unrecognized write payload, a multi-file edit, or a dot-prefixed project path, while preserving Native control-artifact writes and non-write tools.

## Approved Scope

- Parse both Claude-compatible `tool_name/tool_input` payloads and native `toolName/toolArgs` payloads.
- Recognize the write-tool names emitted by the supported Hook adapters, including `Write`, `Edit`, `write_file`, `edit_file`, `create`, `edit`, `str_replace_editor`, and `apply_patch`.
- Collect every explicit target from singular and plural path fields and from supported patch headers.
- Treat malformed payloads or recognized write tools without a recoverable target as unknown writes. When an active change is outside Build, unknown writes fail closed; Build remains writable.
- Allow explicit non-write tools without requiring a target.
- Allow `.comet/config.yaml` and paths under the configured Native root in every phase.
- Remove the blanket exemption for dot-prefixed paths. Files such as `.github/workflows/*`, `.husky/*`, `.env`, and `.gitignore` are ordinary project writes and follow the active phase.
- Keep project-external targets outside this project-scoped guard. Shell command parsing remains out of scope because the supported hosts do not expose one portable command-write contract.
- Install GitHub Copilot's native `preToolUse` entry with its official write-tool matcher and invoke Native Hook output mode that emits `permissionDecision: "deny"`; do not rely on exit code 2 for Copilot denial.

## Architecture

Keep the behavior inside `domains/comet-native/native-hook-guard.ts`, but separate it into two decisions:

1. Normalize Hook stdin into `{ intent, targets }`, where `intent` is `write`, `non-write`, or `unknown`.
2. Resolve Native configuration and active selection, classify every target as control, ordinary, or external, then apply the phase decision once for the whole tool call.

The Hook blocks outside Build when the request is an unknown write or contains any ordinary project target. It allows a request outside Build only when it is explicitly non-write, no Native change is active, or every recovered target is a Native control artifact or external path. A mixed multi-target request is blocked when any target is ordinary.

## Error Handling

- Invalid JSON and empty stdin produce `unknown`, not a silent allow.
- A recognized write tool with no targets produces `unknown`.
- A recognized non-write tool remains allowed even when it has no path, preserving hosts whose before-tool event may still be unfiltered.
- GitHub Copilot allows return `{}` so its normal permission flow remains authoritative, while a blocked request returns a structured deny decision with exit code 0. Other Hook formats retain their existing exit-code contract.
- Invalid Native configuration or change state continues to propagate as a Hook process failure, preserving the existing fail-closed runtime behavior of command pre-tool hooks.
- Multiple active changes without a valid selection remain blocked before target-specific exceptions are considered.

## Rule Semantics

The bilingual Native phase Rule will state that Verify runs checks and records evidence. When verification exposes an implementation defect, the workflow must record a failed Verify transition, return to Build, and repair there. This removes the current ambiguity that Verify may itself edit implementation code.

## Testing

Use test-first coverage for:

- Shape, Build, Verify, and Archive ordinary writes;
- Native control artifacts and `.comet/config.yaml`;
- dot-prefixed project files;
- mixed multi-target requests;
- Claude-compatible and native Copilot payload shapes;
- patch-header target extraction;
- malformed, empty, and recognized-write-without-target payloads;
- explicit non-write tools;
- multiple active changes with and without selection;
- generated Native runtime parity and the existing cross-platform installer suite.

## Release Scope

Native remains unreleased relative to `origin/master` (`0.4.0-beta.5`), while the branch already owns `0.4.0-beta.6`. Do not bump the version. Rewrite the existing beta.6 “Native phase safeguards” bullet to describe the final hardened behavior instead of recording this development-stage correction as a separate fix.
