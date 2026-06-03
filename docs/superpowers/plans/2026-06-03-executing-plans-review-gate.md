# Executing-Plans Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a code reviewer dispatch before `comet-build + executing-plans` can leave build for verify.

**Architecture:** This is a focused skill workflow change. Add a prose regression test that locks the Chinese `comet-build` requirements, then update only the Chinese skill so the new gate is explicit in the execution flow and exit conditions.

**Tech Stack:** TypeScript, Vitest, Markdown skill assets.

---

change: enforce-executing-plans-review
design-doc: docs/superpowers/specs/2026-06-03-executing-plans-review-gate-design.md
base-ref: 07a13d9d19d855933c277e5cf2a099da7083c82d

---

### Task 1: Add the Skill Safeguard Regression Test

**Files:**
- Modify: `test/ts/skills.test.ts`

- [ ] **Step 1: Add a failing assertion block for the Chinese executing-plans review gate**

In `test/ts/skills.test.ts`, inside `describe('Chinese Comet workflow safeguards')`, extend the existing test after the plan-ready assertions:

```ts
      // HIGH: comet-build + executing-plans must dispatch a reviewer before verify
      expect(zhBuild).toContain('`build_mode` 为 `executing-plans`');
      expect(zhBuild).toContain('至少 dispatch 一次 code reviewer');
      expect(zhBuild).toContain('build → verify');
      expect(zhBuild).toContain('CRITICAL review 发现必须先修复');
      expect(zhBuild).toContain('非 CRITICAL review 发现');
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npx vitest run test/ts/skills.test.ts
```

Expected: FAIL because `assets/skills-zh/comet-build/SKILL.md` does not yet contain the new mandatory executing-plans review gate text.

### Task 2: Add the Chinese comet-build Review Gate

**Files:**
- Modify: `assets/skills-zh/comet-build/SKILL.md`
- Modify: `openspec/changes/enforce-executing-plans-review/tasks.md`

- [ ] **Step 1: Add the gate after execution skill completion**

In `assets/skills-zh/comet-build/SKILL.md`, after the bullet list that describes what the selected execution skill must do, add a subsection:

```markdown
**`executing-plans` review gate**：

当 `build_mode` 为 `executing-plans` 时，在所有计划任务完成后、运行 build → verify 阶段守卫前，必须至少 dispatch 一次 code reviewer。

要求：
- review 必须发生在 `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply` 之前
- CRITICAL review 发现必须先修复，不得带入 verify
- 非 CRITICAL review 发现如选择接受，必须在 tasks.md、commit body、验证报告草稿或其他持久产物中记录接受原因和影响范围
```

- [ ] **Step 2: Add the exit condition**

In the same file's `## 退出条件` list, add:

```markdown
- 若 `build_mode` 为 `executing-plans`，已至少 dispatch 一次 code reviewer，且 CRITICAL review 发现已修复或非 CRITICAL review 发现已记录接受理由
```

- [ ] **Step 3: Mark OpenSpec tasks complete after implementation and verification**

After the focused test passes and verification commands complete, update `openspec/changes/enforce-executing-plans-review/tasks.md`:

```markdown
- [x] Update `assets/skills-zh/comet-build/SKILL.md` so `executing-plans` requires at least one code reviewer dispatch before build -> verify.
- [x] Run focused verification and record that English synchronization is pending user confirmation.
```

### Task 3: Verify and Commit

**Files:**
- Modify: `test/ts/skills.test.ts`
- Modify: `assets/skills-zh/comet-build/SKILL.md`
- Modify: `openspec/changes/enforce-executing-plans-review/tasks.md`
- Include ignored AST docs with `git add -f docs/superpowers/specs/2026-06-03-executing-plans-review-gate-design.md docs/superpowers/plans/2026-06-03-executing-plans-review-gate.md`

- [ ] **Step 1: Run focused skill test**

Run:

```bash
npx vitest run test/ts/skills.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run baseline shell-script test**

Run:

```bash
npx vitest run test/ts/comet-scripts.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Commit the milestone**

Run:

```bash
git add test/ts/skills.test.ts assets/skills-zh/comet-build/SKILL.md openspec/changes/enforce-executing-plans-review
git add -f docs/superpowers/specs/2026-06-03-executing-plans-review-gate-design.md docs/superpowers/plans/2026-06-03-executing-plans-review-gate.md
git commit -m "fix(build): 强化 executing-plans 审查门禁"
```

### Task 4: Sync English Skill After User Confirmation

**Files:**
- Modify: `assets/skills/comet-build/SKILL.md`
- Modify: `test/ts/skills.test.ts`
- Modify: `openspec/changes/enforce-executing-plans-review/tasks.md`

- [x] **Step 1: Add English regression assertions**

Add assertions under `describe('English Comet workflow safeguards')` that require the English `comet-build` skill to mention:

```ts
expect(enBuild).toContain('`build_mode` is `executing-plans`');
expect(enBuild).toContain('dispatch a code reviewer at least once');
expect(enBuild).toContain('build → verify');
expect(enBuild).toContain('CRITICAL review findings must be fixed first');
expect(enBuild).toContain('non-CRITICAL review findings');
```

- [x] **Step 2: Verify the assertions fail before the English skill is updated**

Run:

```bash
npx vitest run test/ts/skills.test.ts
```

Expected before implementation: FAIL because `assets/skills/comet-build/SKILL.md` does not yet contain the English review gate.

- [x] **Step 3: Sync the English skill text**

Add the same gate semantics to `assets/skills/comet-build/SKILL.md` after execution skill completion and in the exit conditions.

- [x] **Step 4: Run the focused test again**

Run:

```bash
npx vitest run test/ts/skills.test.ts
```

Expected after implementation: PASS.
