# Skill, Hook, and Rule Lifecycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Skill, Hook, and Rule installation, diagnosis, update, and uninstall fail safely and report one truthful component-level result.

**Architecture:** Keep existing platform-specific Hook encoders, but consolidate their shared JSON safety and outcome contracts. Propagate component results through init/update/uninstall, then reuse manifest and managed-command knowledge to let Doctor detect partial Rule and Hook installations.

**Tech Stack:** TypeScript 5.9, Node.js 20+, Vitest 4, Commander CLI, JSON platform configuration.

## Global Constraints

- Do not modify original Superpowers or OpenSpec Skills.
- Preserve the Codex split: Skills under `.agents/skills`; configuration, Rules, and Hooks under `.codex`.
- Never overwrite malformed or unreadable user-owned Hook JSON.
- Dedicated Comet-owned Hook files may be replaced; shared platform settings must be merged.
- A target is successful only when all required Skill, Rule, and Hook components succeed.
- Do not install a Hook when its managed Skill scripts were not copied successfully.
- Codex historical Hook files remain best-effort after canonical cleanup; canonical configuration failures are blocking.
- Use TDD and capture RED before production changes for every behavior.
- Preserve unrelated changes and stage only task files.
- Current `package.json` is `0.4.0-beta.5` and `origin/master` is `0.4.0-beta.4`; append to beta.5 without bumping the version.

---

### Task 1: Fail-Closed Hook Configuration and Explicit Outcomes

**Files:**

- Modify: `domains/skill/platform-install.ts`
- Modify: `domains/skill/uninstall.ts`
- Modify: `app/commands/init.ts`
- Modify: `app/commands/update.ts`
- Modify: `test/domains/skill/skills.test.ts`
- Modify: `test/domains/skill/uninstall.test.ts`
- Modify: `test/app/uninstall.test.ts`

**Interfaces:**

- Produce and export `HookInstallResult` as `{ status: 'installed' | 'skipped' | 'failed'; reason?: string }`.
- Preserve `RemovalResult` as `{ removed: number; failed: number }`.
- Reuse `readSettingsJsonObject(settingsPath, hookFormat)` for every shared JSON Hook installer.

- [ ] **Step 1: Add failing install regressions**

Add table-driven tests proving malformed Claude Code, Amazon Q, Gemini, and Windsurf JSON remains byte-for-byte unchanged and returns `status: 'failed'`. Keep the existing invalid CodeBuddy case and update all successful Hook assertions to `status: 'installed'`.

- [ ] **Step 2: Run install regressions and verify RED**

Run:

```bash
npx vitest run test/domains/skill/skills.test.ts -t "invalid|malformed|Hook"
```

Expected: Claude/Amazon Q/Gemini/Windsurf invalid JSON cases fail because current code rewrites the files; result-shape assertions fail because the current API uses `installed: boolean`.

- [ ] **Step 3: Add failing canonical uninstall regressions**

For Qwen, Gemini, and Windsurf, write malformed canonical Hook JSON, call `removeCometHooksForPlatform()`, and expect `{ removed: 0, failed: 1 }` with unchanged bytes.

- [ ] **Step 4: Run uninstall regressions and verify RED**

Run:

```bash
npx vitest run test/domains/skill/uninstall.test.ts test/app/uninstall.test.ts -t "malformed|canonical"
```

Expected: each new platform case returns `failed: 0` before the fix.

- [ ] **Step 5: Implement the minimal Hook contract**

In `platform-install.ts`:

```ts
type HookInstallStatus = 'installed' | 'skipped' | 'failed';

interface HookInstallResult {
  status: HookInstallStatus;
  reason?: string;
}
```

Use `skipped` only for a platform without Hook support or a manifest without Hooks. Use `failed` for unsupported declared formats, invalid shared configuration, or any read/write error. Use `readSettingsJsonObject()` for Claude-shaped, Gemini, and Windsurf shared files; preserve the platform name in the error reason. Update init/update callers to consume `status` without yet changing their aggregate result models.

In `uninstall.ts`, canonical Qwen/Gemini/Windsurf read or parse errors return `{ removed: 0, failed: 1 }`. Keep Codex legacy files best-effort.

- [ ] **Step 6: Verify GREEN and idempotency**

Run:

```bash
npx vitest run test/domains/skill/skills.test.ts test/domains/skill/uninstall.test.ts test/app/uninstall.test.ts
```

Expected: all tests pass and existing user-Hook merge/idempotency cases remain green.

- [ ] **Step 7: Commit**

```bash
git add domains/skill/platform-install.ts domains/skill/uninstall.ts app/commands/init.ts app/commands/update.ts test/domains/skill/skills.test.ts test/domains/skill/uninstall.test.ts test/app/uninstall.test.ts
git commit -m "fix(skill): fail closed on invalid Hook configuration"
```

---

### Task 2: Truthful Rule Copy and Filesystem Removal Results

**Files:**

- Modify: `platform/fs/file-system.ts`
- Modify: `domains/skill/platform-install.ts`
- Modify: `domains/skill/uninstall.ts`
- Regenerate: `assets/skills/comet/scripts/comet-runtime.mjs`
- Modify: `test/platform/file-system.test.ts`
- Modify: `test/domains/skill/skills.test.ts`
- Modify: `test/domains/skill/uninstall.test.ts`
- Modify: `test/app/uninstall.test.ts`

**Interfaces:**

- `copyCometRulesForPlatform()` returns `{ copied, skipped, failed }`.
- `removeFile()` and `removeDir()` return `false` only for `ENOENT`, return `true` only after removal, and throw other filesystem errors.
- Domain removal functions catch errors per managed artifact and add them to `failed`.

- [ ] **Step 1: Add failing filesystem and Rule tests**

Mock `fs.unlink`, `fs.rm`, and Rule source/destination operations to prove permission errors are not reported as missing. Add a missing Rule source assertion that expects `failed: 1` rather than only a console message.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run test/platform/file-system.test.ts test/domains/skill/skills.test.ts test/app/uninstall.test.ts -t "permission|missing Rule|removal failure"
```

Expected: `removeFile()` masks the mocked error, `removeDir()` reports missing as removed, and Rule copy has no failure field.

- [ ] **Step 3: Implement strict removal semantics and Rule counters**

Make `removeFile()`/`removeDir()` inspect `ENOENT` and rethrow every other error. Count missing manifest Rule sources and copy/write exceptions in `failed`. Wrap independent Skill, Rule, Hook-file, and empty-directory removals so one error increments the relevant component counter without deleting unrelated user data.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run test/platform/file-system.test.ts test/domains/skill/skills.test.ts test/domains/skill/uninstall.test.ts test/app/uninstall.test.ts
npx vitest run test/domains/comet-classic/comet-scripts.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add platform/fs/file-system.ts domains/skill/platform-install.ts domains/skill/uninstall.ts assets/skills/comet/scripts/comet-runtime.mjs test/platform/file-system.test.ts test/domains/skill/skills.test.ts test/domains/skill/uninstall.test.ts test/app/uninstall.test.ts
git commit -m "fix(skill): propagate Rule and removal failures"
```

---

### Task 3: End-to-End Init and Update Failure Propagation

**Files:**

- Modify: `app/commands/init.ts`
- Modify: `app/commands/update.ts`
- Modify: `test/app/init-e2e.test.ts`
- Modify: `test/app/update.test.ts`

**Interfaces:**

- Init platform results expose one `comet` status derived from all required Comet components.
- Update result adds `skills.totalFailed`, `rules.totalFailed`, and `hooks.totalFailed`, plus per-target failure counts/reasons.
- Registry updates occur only when the target has zero component failures.

- [ ] **Step 1: Add failing init dependency tests**

Force Skill copying to fail and assert that Rule/Hook installation does not run, the platform summary reports `Comet failed`, and the project is not registered as a complete target.

- [ ] **Step 2: Add failing update result tests**

Cover Skill copy failure, Rule copy failure, and Hook install failure independently. Assert text and JSON outputs say `incomplete`, all-project updates use `status: 'failed'`, and registry targets are not refreshed.

- [ ] **Step 3: Verify RED**

Run:

```bash
npx vitest run test/app/init-e2e.test.ts test/app/update.test.ts -t "Skill failure|Rule failure|Hook failure|incomplete"
```

- [ ] **Step 4: Implement target-level aggregation**

After Skill copying, skip dependent Rule/Hook work if `failed > 0`. Otherwise collect Rule `failed` and Hook `status`. Derive init `comet: 'failed'` if any required component failed. Add explicit totals and target details to update results, JSON, text summaries, all-project status, and registry gates.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx vitest run test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add app/commands/init.ts app/commands/update.ts test/app/init-e2e.test.ts test/app/update.test.ts
git commit -m "fix(skill): surface incomplete Comet lifecycle updates"
```

---

### Task 4: Doctor Checks Rule and Hook Completeness

**Files:**

- Create: `domains/skill/platform-inspect.ts`
- Modify: `app/commands/doctor.ts`
- Modify: `test/app/doctor.test.ts`
- Create: `test/domains/skill/platform-inspect.test.ts`

**Interfaces:**

- Export `getPlatformRuleDestinations(baseDir, platform, scope)` for normalized, language-independent Rule destinations.
- Export `inspectCometHooksForPlatform(baseDir, platform, scope): Promise<{ present: boolean; error?: string }>` from the focused inspection module.
- Doctor emits `rules: <platform> (<scope>)` and `hooks: <platform> (<scope>)` checks only when a Comet Skill installation is detected and the platform supports that component.

- [ ] **Step 1: Add failing Doctor component tests**

Create complete managed Skill files but omit the Rule and Hook. Expect Rule/Hook warnings. Install both and expect pass. Corrupt shared Hook JSON and expect a Hook warning containing the parse failure.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run test/app/doctor.test.ts -t "Rule|Hook|partial"
```

Expected: Doctor currently reports Skill completeness only.

- [ ] **Step 3: Implement read-only component inspection**

Reuse manifest Rule destination logic instead of duplicating filenames. Because every language variant normalizes to the same installed filename, do not add a language parameter. Inspect Hook formats with the existing managed-command parser: Claude/Qwen/Gemini groups, Windsurf command arrays, Copilot’s dedicated file, and Kiro’s dedicated Hook file. Inspection must never create or rewrite configuration.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run test/app/doctor.test.ts test/domains/skill/platform-inspect.test.ts test/platform/detect.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add domains/skill/platform-inspect.ts app/commands/doctor.ts test/app/doctor.test.ts test/domains/skill/platform-inspect.test.ts
git commit -m "feat(doctor): detect incomplete Rule and Hook installs"
```

---

### Task 5: Release Note and Repository Verification

**Files:**

- Modify: `CHANGELOG.md`
- Verify: all files changed by Tasks 1–4

- [ ] **Step 1: Reconfirm release baseline**

Run:

```bash
node -p "require('./package.json').version"
git show origin/master:package.json | rg '"version"'
git describe --tags --abbrev=0
git log "$(git describe --tags --abbrev=0)..HEAD" --oneline
```

Expected: current beta.5, master beta.4, existing beta.5 changelog section.

- [ ] **Step 2: Add one final-state Fixed bullet**

Under beta.5 `### Fixed`, add:

```markdown
- **Skill lifecycle integrity**: Comet now preserves malformed user Hook configuration, reports Skill, Rule, and Hook failures consistently across init, update, Doctor, and uninstall, and avoids registering partial installations as complete.
```

- [ ] **Step 3: Run targeted formatting and lifecycle suites**

```bash
npx prettier --check platform/fs/file-system.ts domains/skill/platform-install.ts domains/skill/platform-inspect.ts domains/skill/uninstall.ts app/commands/init.ts app/commands/update.ts app/commands/doctor.ts test/platform/file-system.test.ts test/domains/skill/skills.test.ts test/domains/skill/platform-inspect.test.ts test/domains/skill/uninstall.test.ts test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/doctor.test.ts CHANGELOG.md
npx vitest run test/platform/file-system.test.ts test/domains/skill/skills.test.ts test/domains/skill/platform-inspect.test.ts test/domains/skill/uninstall.test.ts test/app/init-e2e.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/doctor.test.ts test/platform/detect.test.ts
```

- [ ] **Step 4: Run repository-required verification**

```bash
pnpm format:check
pnpm lint
pnpm build
npx vitest run
git diff --check
```

If repository formatting reports untouched CRLF or unrelated files, prove the changed-file formatter set is clean and do not rewrite unrelated files.

- [ ] **Step 5: Final lifecycle audit**

Confirm from current code and tests:

```text
[ ] Skill, Rule, and Hook required components share truthful failure semantics.
[ ] Shared user configuration is never overwritten after invalid JSON.
[ ] A failed Skill copy cannot leave a newly installed dangling Hook.
[ ] Init/update do not report or register partial targets as complete.
[ ] Canonical uninstall failures block follow-on cleanup.
[ ] Doctor detects missing or malformed Rule/Hook components.
[ ] Bilingual Rule semantics and Classic Hook behavior remain unchanged.
```

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: document Skill lifecycle integrity fixes"
```
