# Native Hook Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Native phase Hook fail safely for ordinary single-file, multi-file, patch, and unparseable write requests outside Build without blocking explicit non-write tools or Native control artifacts.

**Architecture:** Normalize every supported Hook payload into one intent-and-target request, then apply one active-change phase decision over all targets. Keep parsing and policy in `native-hook-guard.ts`, regenerate the bundled runtime, and synchronize the bilingual Rule plus the existing beta.6 release note.

**Tech Stack:** TypeScript 5.9, Node.js 20+, Vitest 4, generated ESM Native runtime, Markdown Rules.

## Global Constraints

- Do not modify original Superpowers or OpenSpec Skills.
- Native and Classic Hook behavior remain independent.
- Use TDD: every new behavior must fail before implementation.
- Explicit non-write Hook events remain allowed.
- Unknown or malformed write events fail closed outside Build.
- GitHub Copilot must receive its native write matcher and structured deny output; an allowed Hook must not grant tool permission.
- Only `.comet/config.yaml` and the configured Native root are phase-independent project writes.
- Project-external paths and shell command parsing remain out of scope.
- Modify Chinese Rule wording before synchronizing the English Rule.
- Keep `package.json` at `0.4.0-beta.6`; update the existing beta.6 changelog entry.

---

### Task 1: Define Hook Request Parsing and Phase Policy

**Files:**

- Modify: `test/domains/comet-native/native-hook-guard.test.ts`
- Modify: `domains/comet-native/native-hook-guard.ts`
- Modify: `domains/comet-native/native-cli.ts`

**Interfaces:**

- Produce `NativeHookRequest` with `intent: 'write' | 'non-write' | 'unknown'` and `targets: string[]`.
- Export `parseNativeHookRequest(source: string): NativeHookRequest` for deterministic tests.
- Replace `readNativeHookTarget()` with `readNativeHookRequest()`.
- Change `inspectNativeHookGuard(projectRoot, request)` to evaluate the complete request atomically.
- Add `hook-guard --hook-output copilot` so Copilot denial uses `permissionDecision: "deny"` with exit code 0 while allowed events return `{}`.

- [ ] **Step 1: Add failing parser tests**

Cover Claude `tool_name/tool_input`, native `toolName/toolArgs` where `toolArgs` is an object or JSON string, plural target arrays, `apply_patch` headers, explicit non-write tools, malformed JSON, empty input, and write tools without targets.

- [ ] **Step 2: Verify parser RED**

Run:

```bash
npx vitest run test/domains/comet-native/native-hook-guard.test.ts
```

Expected: fail because `parseNativeHookRequest` and the request-level API do not exist.

- [ ] **Step 3: Add failing policy tests**

Assert that Shape/Verify/Archive block unknown writes and any ordinary target, Build allows them, control-only writes pass, a mixed control-and-ordinary request blocks, dot-prefixed project files block, explicit non-write requests pass, and multiple active changes require selection.

- [ ] **Step 4: Verify policy RED**

Run the same focused test file. Expected: failures show the single-target API, fail-open missing target, and dot-path exemption.

- [ ] **Step 5: Implement minimal normalization and policy**

Implement `NativeHookRequest`, path collection, patch-header extraction, write-tool classification, request reading, target classification, and one whole-request phase decision. Update `native-cli.ts` to pass `readNativeHookRequest()` into the guard.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npx vitest run test/domains/comet-native/native-hook-guard.test.ts
```

Expected: all Native Hook guard tests pass.

---

### Task 2: Synchronize Rule, Runtime, and Release Surface

**Files:**

- Modify: `assets/skills/comet-native/rules/comet-native-phase-guard.md`
- Modify: `assets/skills/comet-native/rules/comet-native-phase-guard.en.md`
- Regenerate: `assets/skills/comet-native/scripts/comet-native-runtime.mjs`
- Modify: `test/domains/skill/skills.test.ts`
- Modify: `test/repository/native-runtime-assets.test.ts`
- Modify: `docs/superpowers/specs/2026-07-16-comet-native-evolution-record.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Chinese and English Rules state that failed Verify transitions back to Build before implementation repair.
- The generated runtime contains the same request parser and Hook policy as the TypeScript source.
- The beta.6 safeguard bullet describes fail-closed write payloads and the narrow control-artifact exemption.

- [ ] **Step 1: Add failing Rule and runtime assertions**

Assert bilingual Verify-to-Build wording, absence of the platform-configuration blanket exemption, and generated runtime markers for the request-level parser.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run test/domains/skill/skills.test.ts test/repository/native-runtime-assets.test.ts -t "Native|native"
```

Expected: fail on the old Rule wording and old generated runtime.

- [ ] **Step 3: Update Chinese then English Rule**

Replace the ambiguous Verify repair sentence with an explicit failed-Verify-to-Build transition and describe Hook coverage as ordinary project writes, including dot-prefixed paths.

- [ ] **Step 4: Regenerate Native runtime**

Run:

```bash
pnpm build:native-runtime
```

- [ ] **Step 5: Update design history and beta.6 final-state wording**

Append the hardening decision to the Native evolution record. Rewrite the existing “Native phase safeguards” changelog bullet; do not add a development-process Fixed entry or bump the version.

- [ ] **Step 6: Verify GREEN**

Run the Rule, runtime asset, Hook guard, and installer suites.

---

### Task 3: Repository Verification

**Files:**

- Verify all files changed by Tasks 1–2.

**Interfaces:**

- No new runtime dependency or platform concept.
- Generated assets match TypeScript source.
- All project-required checks remain green.

- [ ] **Step 1: Run focused tests**

```bash
npx vitest run test/domains/comet-native/native-hook-guard.test.ts test/domains/skill/skills.test.ts test/repository/native-runtime-assets.test.ts
```

- [ ] **Step 2: Run formatting, lint, build, and full tests**

```bash
pnpm format:check
pnpm lint
pnpm build
npx vitest run
git diff --check
```

- [ ] **Step 3: Audit the final diff**

Confirm the diff contains only the Hook hardening, bilingual Rule alignment, generated runtime, focused design/plan records, and rewritten beta.6 final-state release note. Do not create a GitHub comment, PR, or push without explicit user approval.
