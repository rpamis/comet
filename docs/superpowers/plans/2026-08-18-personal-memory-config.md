# Personal Memory Project Policy Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-level personal-memory learning and retrieval policy to `.comet/config.yaml` without replacing user-level Runtime controls or plugin lifecycle state.

**Architecture:** Extend the shared workflow project-config model with an optional top-level `memory` mapping whose normalized defaults are both enabled. Read that policy when creating the Comet plugin bridge, enforce it only at automatic event/context boundaries, and expose it to the Dashboard so disabled controls are explained rather than silently ineffective.

**Tech Stack:** TypeScript, YAML parser, Vitest, React/Ant Design Dashboard, generated workflow runtime helper.

## Global Constraints

- Missing `memory` configuration means `learning: true` and `retrieval: true`.
- Project policy is a hard upper bound; user Runtime settings and project pauses remain separate lower-level switches.
- Explicit memory management remains available when automatic learning or retrieval is disabled.
- Uninstalling `comet.personal-memory` remains a lifecycle operation and must not modify project config or delete memory data.
- Chinese project config comments and the English `CHANGELOG.md` must remain consistent with repository conventions.

---

### Task 1: Add the normalized project memory policy contract

**Files:**

- Modify: `domains/workflow-contract/types.ts`
- Modify: `domains/workflow-contract/project-config.ts`
- Modify: `test/domains/workflow-contract/workflow-contract.test.ts`

**Interfaces:**

- Produce `WorkflowMemoryProjectConfig` with `learning: boolean` and `retrieval: boolean`.
- Produce `config.memory` and `ParsedWorkflowProjectConfigDocument.memory` when the block is present or defaulted by the normalized project config.

- [ ] **Step 1: Write failing parser tests** for omitted memory defaults, valid false values, invalid mapping/value errors, and managed merge preserving unrelated fields.
- [ ] \*\*Step 2: Run `npx vitest run test/domains/workflow-contract/workflow-contract.test.ts` and verify the new assertions fail because the model/parser has no memory policy.
- [ ] \*\*Step 3: Implement the type, bilingual config comments, normalization, managed projection, merge behavior, and generated runtime helper parity.
- [ ] \*\*Step 4: Run the same workflow-contract test file and verify it passes.

### Task 2: Enforce policy at Personal Memory automatic boundaries

**Files:**

- Modify: `domains/comet-plugin/integration.ts`
- Modify: `domains/comet-memory/plugin.ts`
- Modify: `test/domains/comet-plugin/plugin-integration.test.ts`
- Modify: `test/domains/comet-memory/memory-experience.test.ts`

**Interfaces:**

- Consume `readWorkflowProjectConfig(projectRoot)` through the existing bridge construction path.
- Produce plugin dashboard data with `policy: { learning: boolean; retrieval: boolean }`.

- [ ] **Step 1: Write failing integration tests** proving `memory.learning: false` skips lifecycle learning, `memory.retrieval: false` returns no automatic context, and omitted memory preserves both behaviors.
- [ ] \*\*Step 2: Run the focused plugin integration and memory experience tests and verify the policy assertions fail.
- [ ] \*\*Step 3: Pass the normalized project policy into the first-party descriptor; skip automatic `onEvent` review and automatic `provideContext` retrieval when the relevant policy is false while leaving explicit capabilities available.
- [ ] \*\*Step 4: Run the focused tests and verify they pass, including existing uninstall and explicit memory operation coverage.

### Task 3: Reflect project policy in the Dashboard

**Files:**

- Modify: `domains/comet-memory/plugin.ts`
- Modify: `domains/dashboard/web/src/main.jsx`
- Modify: `test/domains/comet-memory/memory-experience.test.ts`

**Interfaces:**

- Consume the plugin page `policy` projection.
- Render policy-disabled project learning/retrieval controls as explanatory, disabled actions.

- [ ] \*\*Step 1: Add a failing Dashboard page test asserting the policy projection and a policy-disabled page state.
- [ ] \*\*Step 2: Run the focused memory experience and Dashboard tests to verify the new assertions fail.
- [ ] \*\*Step 3: Add localized policy copy and disable only the project pause controls that cannot affect a policy-disabled operation; keep global Runtime settings and memory management usable.
- [ ] \*\*Step 4: Run focused tests and the affected Dashboard formatting check.

### Task 4: Publish configuration and documentation

**Files:**

- Modify: `.comet/config.yaml`
- Modify: `docs/operations/PERSONAL-MEMORY.md`
- Modify: `CHANGELOG.md`
- Modify: relevant config fixture strings in `test/domains/comet-memory/memory-experience.test.ts` and `test/domains/workflow-contract/workflow-contract.test.ts` only when the generated default is intentionally changed.

- [ ] \*\*Step 1: Add the project config example and document defaults, precedence, explicit operations, and uninstall distinction.
- [ ] \*\*Step 2: Add one concise user-visible English changelog entry under the existing beta20 entry after comparing the current version baseline.
- [ ] \*\*Step 3: Run Prettier on affected source/config/docs files and verify bilingual/config examples are valid.

### Task 5: Final verification

**Files:**

- No new files; inspect all modified files and generated assets.

- [ ] \*\*Step 1: Run `npx vitest run test/domains/workflow-contract/workflow-contract.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-memory/memory-experience.test.ts test/domains/dashboard/default-plugin-host.test.ts`.
- [ ] \*\*Step 2: Run `pnpm lint` and `pnpm format:check` for the affected scope.
- [ ] \*\*Step 3: If generated runtime helper output changed, run the repository-required build and runtime asset checks.
- [ ] \*\*Step 4: Review `git diff --check`, `git status`, and the complete diff to ensure no unrelated user changes were touched.
