# Classic Reliability and Stable CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issues #185, #186, #187, and #192 by making archive annotations whitespace-safe, exposing stable top-level Classic commands, recording auditable manual command checks, and classifying mixed OpenSpec/Comet changes.

**Architecture:** Keep `domains/comet-classic/` as the only implementation of Classic behavior. Add a thin app facade for four public commands, store manual build/verify attestations as current-Run trajectory events, let Guard consume them only when command inference is unavailable, and make `comet status` render one normalized model for both managed and plain OpenSpec changes.

**Tech Stack:** TypeScript, Commander, Node.js `fs/path/child_process`, existing Classic Engine trajectory storage, Vitest, generated Classic runtime assets.

## Global Constraints

- Work on the existing `beta4` branch; do not merge, push, comment on GitHub, or open a PR without explicit approval.
- Keep `package.json` and `assets/manifest.json` at `0.4.0-beta.4`; `origin/master` is already `0.4.0-beta.4`.
- Do not restore `.comet/config.yaml` `build_command` or `verify_command` execution.
- `record-check` stores command text but must never execute it.
- Public Classic commands are exactly `state`, `guard`, `handoff`, and `archive`; do not expose `validate`, `intent`, `resume-probe`, or `hook-guard` at the top level.
- Keep existing `.mjs` launchers compatible and do not modify frozen `test/fixtures/classic-0.3.9/`.
- Any change under `domains/comet-classic/` must be followed by `pnpm build:classic-runtime` before final verification.
- Skill updates must be written in `assets/skills-zh/` first, paused for user confirmation, then synchronized to `assets/skills/`.
- Changelog text is English and belongs in the existing `0.4.0-beta.4` entry; describe final user-visible behavior, not development iterations.
- Use TDD for every behavior change: observe the new test fail for the intended reason before writing production code.

---

### Task 1: Preserve archive annotation EOF formatting (#185)

**Files:**

- Modify: `domains/comet-classic/classic-archive.ts:132-178`
- Modify: `test/domains/comet-classic/classic-archive.test.ts`

**Interfaces:**

- Consumes: UTF-8 Markdown content, archive name, and optional frontmatter fields.
- Produces: `annotatedMarkdown(original: string, archiveName: string, extraFields: string): string`, with internal blank lines preserved and exactly one final LF.

- [x] **Step 1: Add failing EOF and idempotency tests**

Add a table-driven test to `test/domains/comet-classic/classic-archive.test.ts`. Seed design/plan paths in `.comet.yaml`, let the fake OpenSpec command archive the change, and assert the resulting files. The core assertions must be:

```ts
expect(annotated).toContain(`archived-with: ${archiveName}`);
expect(annotated).toMatch(/[^\n]\n$/u);
expect(annotated).not.toMatch(/\n\n$/u);
expect(annotated).toContain('paragraph one\n\nparagraph two');
```

Run the archive a second time through the recoverable/idempotent path and assert:

```ts
expect(await fs.readFile(documentPath, 'utf8')).toBe(annotated);
```

Cover these initial contents in separate cases:

```ts
const cases = [
  '---\ntitle: Demo\n---\nparagraph one\n\nparagraph two\n',
  '---\ntitle: Demo\n---\nparagraph one\n\nparagraph two\n\n\n',
  'paragraph one\n\nparagraph two',
];
```

- [x] **Step 2: Run the archive test and confirm RED**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-archive.test.ts
```

Expected: at least the existing-frontmatter case fails because `annotateFrontmatter()` preserves the split-produced empty string and then appends another LF.

- [x] **Step 3: Extract a deterministic Markdown transformation**

In `domains/comet-classic/classic-archive.ts`, introduce:

```ts
function exactlyOneFinalNewline(content: string): string {
  return content.replace(/[\t ]*(?:\r?\n[\t ]*)*$/u, '') + '\n';
}

export function annotatedMarkdown(
  original: string,
  archiveName: string,
  extraFields: string,
): string {
  const lines = original.replace(/\r\n?/gu, '\n').split('\n');
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  const hasFrontmatter = lines[0] === '---' && closing > 0;
  let updated: string;

  if (hasFrontmatter) {
    const extraKey = extraFields.split(':', 1)[0];
    const frontmatter = lines
      .slice(1, closing)
      .filter((line) => !/^archived-with:/u.test(line))
      .filter((line) => !extraKey || !line.startsWith(`${extraKey}:`));
    frontmatter.push(`archived-with: ${archiveName}`);
    if (extraFields) frontmatter.push(extraFields);
    updated = ['---', ...frontmatter, '---', ...lines.slice(closing + 1)].join('\n');
  } else {
    const header = ['---', `archived-with: ${archiveName}`];
    if (extraFields) header.push(extraFields);
    header.push('status: final', '---');
    updated = `${header.join('\n')}\n${original}`;
  }

  return exactlyOneFinalNewline(updated);
}
```

Replace the inline string construction in `annotateFrontmatter()` with:

```ts
const original = await fs.readFile(file, 'utf8');
await fs.writeFile(file, annotatedMarkdown(original, archiveName, extraFields));
```

- [x] **Step 4: Verify archive formatting GREEN**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-archive.test.ts
npx prettier --check domains/comet-classic/classic-archive.ts test/domains/comet-classic/classic-archive.test.ts
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 5: Commit Task 1**

```bash
git add domains/comet-classic/classic-archive.ts test/domains/comet-classic/classic-archive.test.ts
git commit -m "fix(classic): preserve archive markdown formatting"
```

---

### Task 2: Expose four stable public Classic commands (#186)

**Files:**

- Create: `app/commands/classic.ts`
- Modify: `app/cli/index.ts:50-100`
- Create: `test/app/classic-command.test.ts`
- Modify: `test/app/cli-help.test.ts`

**Interfaces:**

- Consumes: `runClassicCli(argv: readonly string[]): Promise<ClassicCommandResult>`.
- Produces: `runClassicFacade(command: PublicClassicCommand, args: readonly string[]): Promise<number>` and Commander commands `comet state|guard|handoff|archive`.

- [x] **Step 1: Write failing facade forwarding tests**

Create `test/app/classic-command.test.ts`, mock the domain dispatcher, and assert exact argument/output/exit behavior:

```ts
vi.mock('../../domains/comet-classic/classic-cli.js', () => ({
  runClassicCli: vi.fn(),
}));

it('forwards public Classic arguments and preserves output and exit code', async () => {
  vi.mocked(runClassicCli).mockResolvedValue({
    exitCode: 9,
    stdout: 'machine output\n',
    stderr: 'diagnostic\n',
  });
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  await expect(runClassicFacade('guard', ['demo', 'build', '--apply'])).resolves.toBe(9);
  expect(runClassicCli).toHaveBeenCalledWith(['guard', 'demo', 'build', '--apply']);
  expect(stdout).toHaveBeenCalledWith('machine output\n');
  expect(stderr).toHaveBeenCalledWith('diagnostic\n');
});
```

Add one parameterized assertion that the accepted command type/runtime allowlist contains exactly:

```ts
['state', 'guard', 'handoff', 'archive'];
```

- [x] **Step 2: Run the new test and confirm RED**

Run:

```bash
npx vitest run test/app/classic-command.test.ts
```

Expected: FAIL because `app/commands/classic.ts` does not exist.

- [x] **Step 3: Implement the thin facade**

Create `app/commands/classic.ts`:

```ts
import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';

export const PUBLIC_CLASSIC_COMMANDS = ['state', 'guard', 'handoff', 'archive'] as const;
export type PublicClassicCommand = (typeof PUBLIC_CLASSIC_COMMANDS)[number];

export async function runClassicFacade(
  command: PublicClassicCommand,
  args: readonly string[],
): Promise<number> {
  const result = await runClassicCli([command, ...args]);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}
```

- [x] **Step 4: Register real Commander passthrough commands**

In `app/cli/index.ts`, add a helper that registers each command with a variadic positional argument and unknown-option passthrough:

```ts
function registerClassicFacade(name: PublicClassicCommand, description: string): void {
  program
    .command(`${name} [args...]`)
    .description(description)
    .allowUnknownOption(true)
    .passThroughOptions()
    .action(async (args: string[] = []) => {
      process.exitCode = await runClassicFacade(name, args);
    });
}

registerClassicFacade('state', 'Read, update, and inspect Comet workflow state');
registerClassicFacade('guard', 'Run a Comet workflow phase guard');
registerClassicFacade('handoff', 'Create or inspect a Comet design handoff');
registerClassicFacade('archive', 'Archive a completed Comet-managed change');
```

If the installed Commander version requires `.enablePositionalOptions()` on `program` for passthrough, add it once before command registration and prove existing CLI option tests still pass.

- [x] **Step 5: Add real CLI parsing and help tests**

In `test/app/cli-help.test.ts`, assert root help includes the four names and excludes internal names:

```ts
for (const name of ['state', 'guard', 'handoff', 'archive']) {
  expect(help.stdout).toContain(name);
}
for (const name of ['validate', 'intent', 'hook-guard']) {
  expect(help.stdout).not.toMatch(new RegExp(`^\\s+${name}\\b`, 'mu'));
}
```

Add a real CLI parsing test using `bin/comet.js` or a fresh Commander import. Invoke a harmless invalid/usage path and assert that `--json`, `--apply`, and `--dry-run` reach the dispatcher unchanged. Do not satisfy this requirement only with the mocked facade unit test.

- [x] **Step 6: Verify public CLI GREEN**

Run:

```bash
npx vitest run test/app/classic-command.test.ts test/app/cli-help.test.ts test/app/cli-smoke.test.ts
npx eslint app/commands/classic.ts app/cli/index.ts test/app/classic-command.test.ts
npx prettier --check app/commands/classic.ts app/cli/index.ts test/app/classic-command.test.ts test/app/cli-help.test.ts
```

Expected: all commands exit 0.

- [x] **Step 7: Commit Task 2**

```bash
git add app/commands/classic.ts app/cli/index.ts test/app/classic-command.test.ts test/app/cli-help.test.ts
git commit -m "feat(cli): expose stable Classic commands"
```

---

### Task 3: Record and query current-Run command checks (#192 domain capability)

**Files:**

- Create: `domains/comet-classic/classic-command-checks.ts`
- Modify: `domains/engine/types.ts:36-51`
- Modify: `domains/comet-classic/classic-state-command.ts:1140-1180`
- Create: `test/domains/comet-classic/classic-command-checks.test.ts`
- Modify: `test/domains/comet-classic/classic-runtime.test.ts`

**Interfaces:**

- Consumes: `RunState`, `readTrajectory()`, `appendTrajectory()`, a Classic change directory, and validated record input.
- Produces: `recordCommandCheck()` and `latestCommandCheck()` for Task 4 and Task 5.

```ts
export type CommandCheckScope = 'build' | 'verify';

export interface RecordedCommandCheck {
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd: string;
  recordedAt: string;
  runId: string;
}

export interface RecordCommandCheckInput {
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd?: string;
}

export async function recordCommandCheck(
  changeDir: string,
  run: RunState,
  input: RecordCommandCheckInput,
): Promise<RecordedCommandCheck>;

export async function latestCommandCheck(
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<RecordedCommandCheck | null>;
```

- [x] **Step 1: Add `command_check_recorded` to the trajectory contract**

Write a failing test in `classic-command-checks.test.ts` that creates a Run, calls the not-yet-existing `recordCommandCheck()`, reads its trajectory, and expects:

```ts
expect(events.at(-1)).toMatchObject({
  type: 'command_check_recorded',
  runId: run.runId,
  data: {
    scope: 'build',
    command: 'python scripts/build.py',
    exitCode: 0,
    cwd: '.',
  },
});
```

Run:

```bash
npx vitest run test/domains/comet-classic/classic-command-checks.test.ts
```

Expected: FAIL because the module/event type does not exist.

Then extend `TrajectoryEvent['type']` in `domains/engine/types.ts` with:

```ts
| 'command_check_recorded'
```

- [x] **Step 2: Implement validation and append-only recording**

Create `classic-command-checks.ts`. Use `path.resolve(changeDir, '..', '..', '..')` only after verifying the change is under `openspec/changes`; normalize cwd with `path.relative(projectRoot, resolvedCwd)` and reject if it is absolute-outside (`relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)`).

The append must use:

```ts
const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
const recordedAt = new Date().toISOString();
await appendTrajectory(changeDir, run.trajectoryRef, {
  sequence: trajectory.length + 1,
  timestamp: recordedAt,
  type: 'command_check_recorded',
  runId: run.runId,
  data: { scope, command: command.trim(), exitCode, cwd: normalizedCwd },
});
```

`latestCommandCheck()` must filter both `event.runId === run.runId` and `event.data.scope === scope`, scan newest-to-oldest, validate the stored field types, and return null if no matching event exists.

- [x] **Step 3: Add validation/latest-event tests**

Add explicit tests for:

```ts
await expect(record({ scope: 'deploy' as never })).rejects.toThrow('build or verify');
await expect(record({ command: '   ' })).rejects.toThrow('command cannot be empty');
await expect(record({ exitCode: 0.5 })).rejects.toThrow('exit code must be an integer');
await expect(record({ cwd: '../outside' })).rejects.toThrow('cwd must stay inside');
```

Record success followed by failure and assert the latest failure wins. Seed an event with another runId and assert it is ignored. Spy on `child_process.spawnSync` and assert recording never invokes it.

- [x] **Step 4: Add `state record-check` parsing**

In `classic-state-command.ts`, add a small exact-option parser for:

```text
record-check <change> <build|verify> --command <text> --exit-code <integer> [--cwd <path>]
```

Do not use shell parsing. Consume each array element exactly once, reject unknown flags and missing values, resolve the active change with `resolveClassicChangeDirectory()`, load its synchronized Run, call `recordCommandCheck()`, and emit one audit line:

```text
[RECORDED] build command check exit=0 command=python scripts/build.py
```

Update state usage text from launcher-specific `comet-state.mjs` wording to stable `comet state` wording for this new subcommand; existing legacy usage strings may remain compatible in this task.

- [x] **Step 5: Add state dispatcher tests**

In `classic-runtime.test.ts`, call:

```ts
await runClassicCli([
  'state',
  'record-check',
  'demo',
  'build',
  '--command',
  'python scripts/build.py',
  '--exit-code',
  '0',
]);
```

Assert exit code 0 and the latest trajectory event. Add invalid scope, missing command, non-integer exit code, and unknown option cases with exit code 1 and actionable stderr.

- [x] **Step 6: Verify Task 3 GREEN**

Run:

```bash
npx vitest run test/domains/comet-classic/classic-command-checks.test.ts test/domains/comet-classic/classic-runtime.test.ts
npx eslint domains/comet-classic/classic-command-checks.ts domains/comet-classic/classic-state-command.ts domains/engine/types.ts
npx tsc --noEmit
```

Expected: all commands exit 0.

- [x] **Step 7: Commit Task 3**

```bash
git add domains/comet-classic/classic-command-checks.ts domains/comet-classic/classic-state-command.ts domains/engine/types.ts test/domains/comet-classic/classic-command-checks.test.ts test/domains/comet-classic/classic-runtime.test.ts
git commit -m "feat(classic): record command check evidence"
```

---

### Task 4: Let Guard consume evidence only when inference is unavailable (#192 guard fix)

**Files:**

- Modify: `domains/comet-classic/classic-guard.ts:340-416,780-840`
- Modify: `test/domains/comet-classic/comet-scripts-guard.test.ts`
- Modify: `test/domains/comet-classic/comet-scripts.test.ts`
- Regenerate: `assets/skills/comet/scripts/comet-runtime.mjs`

**Interfaces:**

- Consumes: Task 3 `latestCommandCheck(changeDir, run, scope)` and the current Classic Run context already loaded by `classicGuardCommand`.
- Produces: explicit inferred-command outcomes and commandless-project recovery outcomes for build and verify Guard checks.

- [x] **Step 1: Write failing commandless-project diagnostics tests**

Create a valid build-phase change with no `package.json`, `pom.xml`, or `Cargo.toml`. Run build Guard and assert stderr contains all of:

```ts
expect(result.stderr).toContain('No supported build command was inferred.');
expect(result.stderr).toContain('package.json with a build script');
expect(result.stderr).toContain('pom.xml');
expect(result.stderr).toContain('Cargo.toml');
expect(result.stderr).toContain(
  'comet state record-check demo build --command "<command>" --exit-code 0',
);
```

Run the focused test and confirm it fails because current output is blank:

```bash
npx vitest run test/domains/comet-classic/comet-scripts-guard.test.ts
```

- [x] **Step 2: Separate inference from execution**

Replace the implicit fallback in `classic-guard.ts` with an explicit result:

```ts
interface InferredCommand {
  command: string | null;
  checked: string[];
}

async function inferBuildCommand(): Promise<InferredCommand> {
  const checked = ['package.json with a build script', 'pom.xml', 'Cargo.toml'];
  // preserve the existing Windows Maven wrapper selection
  // return { command: null, checked } when none match
}
```

Preserve the exact existing npm/Maven/Cargo commands. Do not add Python/Make/Julia inference in this issue.

- [x] **Step 3: Implement explicit manual-evidence fallback**

Change `buildPasses` and `verificationCommandPasses` to accept `change`, `changeDir`, and current `RunState`. Centralize fallback in:

```ts
async function inferredOrRecordedCheck(
  change: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<CommandRun>;
```

Behavior:

```ts
const inferred = await inferBuildCommand();
if (inferred.command) return runInferred(inferred.command);

const recorded = await latestCommandCheck(changeDir, run, scope);
if (recorded?.exitCode === 0) {
  return {
    status: 0,
    output: `Recorded ${scope} check passed at ${recorded.recordedAt}: ${recorded.command}`,
  };
}

return {
  status: 1,
  output: noInferredCommandMessage(change, scope, inferred.checked, recorded),
};
```

For an inferred command that exists and fails, return its failure directly; do not read recorded evidence.

When `COMET_SKIP_BUILD=1`, return a successful outcome whose output explicitly contains `SKIPPED via COMET_SKIP_BUILD=1`. Update `pushCheck`/success rendering only as needed so successful evidence text remains visible without changing unrelated PASS output.

- [x] **Step 4: Add evidence isolation and precedence tests**

Add tests proving:

- successful build evidence passes only build Guard;
- successful verify evidence passes only verify Guard;
- a latest nonzero event blocks despite an older success;
- evidence from another runId/change is ignored;
- a failing inferred npm build remains failed even when a successful manual event exists;
- `COMET_SKIP_BUILD=1` output includes `SKIPPED`.

- [x] **Step 5: Regenerate and verify the Classic runtime**

Run:

```bash
pnpm build:classic-runtime
npx vitest run test/domains/comet-classic/comet-scripts-guard.test.ts test/domains/comet-classic/comet-scripts.test.ts
```

Expected: all tests pass; `assets/skills/comet/scripts/comet-runtime.mjs` contains `command_check_recorded` and the actionable no-inference message. Launcher files remain thin imports and do not contain copied logic.

- [x] **Step 6: Run static checks and commit Task 4**

```bash
npx eslint domains/comet-classic/classic-guard.ts domains/comet-classic/classic-command-checks.ts
npx prettier --check domains/comet-classic/classic-guard.ts test/domains/comet-classic/comet-scripts-guard.test.ts
git diff --check
git add domains/comet-classic/classic-guard.ts test/domains/comet-classic/comet-scripts-guard.test.ts test/domains/comet-classic/comet-scripts.test.ts assets/skills/comet/scripts/comet-runtime.mjs
git commit -m "fix(classic): support recorded build checks"
```

---

### Task 5: Classify mixed OpenSpec and Comet changes (#187)

**Files:**

- Modify: `app/commands/status.ts`
- Modify: `test/app/status.test.ts`

**Interfaces:**

- Consumes: Task 3 `latestCommandCheck()`, existing `readClassicState()` and `inspectClassicChange()`.
- Produces: one exported `ChangeStatus` model for text and JSON output with `cometManaged`, `archiveReady`, `recommendedArchiveCommand`, and `commandChecks`.

- [x] **Step 1: Add a failing mixed-repository JSON test**

In one temporary project create:

```text
openspec/changes/a-comet/.comet.yaml       valid
openspec/changes/b-invalid/.comet.yaml     invalid
openspec/changes/c-plain/tasks.md           all checked
openspec/changes/d-incomplete/tasks.md      one unchecked
openspec/changes/archive/2026-07-11-old/    excluded
```

Assert JSON contains exactly four active changes in name order and includes:

```ts
expect(changes).toMatchObject([
  {
    name: 'a-comet',
    cometManaged: true,
    recommendedArchiveCommand: 'comet archive a-comet',
  },
  {
    name: 'b-invalid',
    cometManaged: true,
    phase: 'invalid',
    error: expect.any(String),
  },
  {
    name: 'c-plain',
    cometManaged: false,
    archiveReady: true,
    recommendedArchiveCommand: 'openspec archive c-plain -y',
    workflow: null,
    commandChecks: null,
  },
  {
    name: 'd-incomplete',
    cometManaged: false,
    archiveReady: false,
  },
]);
```

Run:

```bash
npx vitest run test/app/status.test.ts
```

Expected: FAIL because current code skips directories without `.comet.yaml` and does not expose classification fields.

- [x] **Step 2: Normalize the status type and plain-change builder**

Export `RecordedCommandCheck` from Task 3 and define/export `ChangeStatus` in `app/commands/status.ts` with nullable Comet fields exactly as specified by the design doc.

Add:

```ts
async function plainOpenSpecStatus(name: string, changeDir: string): Promise<ChangeStatus> {
  const { done, total } = await countTasks(path.join(changeDir, 'tasks.md'));
  return {
    name,
    cometManaged: false,
    archiveReady: total > 0 && done === total,
    recommendedArchiveCommand: `openspec archive ${name} -y`,
    workflow: null,
    phase: null,
    buildMode: null,
    isolation: null,
    verifyMode: null,
    verifyResult: null,
    designDoc: null,
    plan: null,
    tasksCompleted: done,
    tasksTotal: total,
    nextCommand: null,
    currentStep: null,
    runtimeMode: null,
    runtimeEval: null,
    commandChecks: null,
  };
}
```

When `.comet.yaml` exists, set `cometManaged: true` before parsing so exceptions remain classified as managed. Define Comet archiveReady as valid `phase === 'archive'`, `verifyResult === 'pass'`, and `archived === false`; do not derive it from tasks alone.

- [x] **Step 3: Include current command checks for valid Comet changes**

For a valid synchronized Run, query:

```ts
commandChecks: {
  build: await latestCommandCheck(changeDir, projection.run, 'build'),
  verify: await latestCommandCheck(changeDir, projection.run, 'verify'),
}
```

If no synchronized Run exists in an invalid state, return `commandChecks: null` with the existing error rather than creating/migrating state solely for display.

- [x] **Step 4: Update text output tests**

Assert text output labels managed/plain changes and only emphasizes archive commands when ready:

```ts
expect(output).toContain('c-plain [OpenSpec]');
expect(output).toContain('recommended archive: openspec archive c-plain -y');
expect(output).toContain('a-comet [Comet]');
expect(output).not.toContain('recommended archive: openspec archive d-incomplete -y');
```

For a recorded successful check, assert the command, exit code, and recorded time appear in JSON and a concise audit line appears in text.

- [x] **Step 5: Verify status GREEN and commit Task 5**

```bash
npx vitest run test/app/status.test.ts test/app/cli-smoke.test.ts
npx eslint app/commands/status.ts test/app/status.test.ts
npx prettier --check app/commands/status.ts test/app/status.test.ts
git diff --check
git add app/commands/status.ts test/app/status.test.ts
git commit -m "feat(status): classify OpenSpec and Comet changes"
```

---

### Task 6: Update Chinese Skill instructions and pause for approval

**Files:**

- Modify: `assets/skills-zh/comet/reference/scripts.md`
- Modify: `assets/skills-zh/comet-build/SKILL.md`
- Modify: `assets/skills-zh/comet-verify/SKILL.md`
- Modify: `assets/skills-zh/comet-archive/SKILL.md`

**Interfaces:**

- Consumes: the stable commands from Task 2 and the `record-check` recovery contract from Task 3/4.
- Produces: the Chinese source-of-truth workflow wording that Task 7 must translate faithfully.

- [x] **Step 1: Replace public script-path calls in the Chinese reference**

In `assets/skills-zh/comet/reference/scripts.md`, make these the primary examples:

```bash
comet state check <change-name> <phase>
comet guard <change-name> <phase> --apply
comet handoff <change-name>
comet archive <change-name>
```

Keep the bootstrap variables only in a clearly labeled compatibility/recovery section for older installed Comet versions and internal-only commands.

- [x] **Step 2: Update Chinese build/verify recovery wording**

In build and verify Skills, replace public `node "$COMET_STATE"`, `node "$COMET_GUARD"`, and `node "$COMET_HANDOFF"` examples with the stable CLI equivalents.

Add the commandless project path exactly once in the shared or most relevant section:

```bash
# 先实际运行项目自己的命令；Comet 不会执行 --command 中的文本
<project-build-command>
comet state record-check <change-name> build \
  --command "<project-build-command>" \
  --exit-code 0
```

For verify, use scope `verify`. State explicitly that build and verify evidence cannot substitute for each other and that `COMET_SKIP_BUILD=1` is only a compatibility bypass, not auditable evidence.

- [x] **Step 3: Update Chinese archive instructions**

Replace public archive/state/guard calls with `comet archive`, `comet state`, and `comet guard`, while preserving the existing final-confirmation blocking point exactly.

- [x] **Step 4: Validate Chinese wording and commit**

Run:

```bash
rg -n 'node "\$COMET_(STATE|GUARD|HANDOFF|ARCHIVE)"' assets/skills-zh/comet/reference/scripts.md assets/skills-zh/comet-build/SKILL.md assets/skills-zh/comet-verify/SKILL.md assets/skills-zh/comet-archive/SKILL.md
rg -n 'record-check|comet state|comet guard|comet handoff|comet archive' assets/skills-zh/comet/reference/scripts.md assets/skills-zh/comet-build/SKILL.md assets/skills-zh/comet-verify/SKILL.md assets/skills-zh/comet-archive/SKILL.md
git diff --check
```

Expected: the first search only finds the explicitly labeled legacy compatibility block; the second finds every new public contract.

Commit:

```bash
git add assets/skills-zh/comet/reference/scripts.md assets/skills-zh/comet-build/SKILL.md assets/skills-zh/comet-verify/SKILL.md assets/skills-zh/comet-archive/SKILL.md
git commit -m "docs(zh): use stable Classic CLI commands"
```

- [x] **Step 5: Hard user-review checkpoint** (satisfied by the user's explicit instruction to complete all remaining content without stopping)

Stop execution and ask the user to review the Chinese Skill changes. Do not modify English Skill files or Changelog until the user explicitly confirms the Chinese wording.

---

### Task 7: Synchronize English Skills, Changelog, runtime, and full verification

**Files:**

- Modify: `assets/skills/comet/reference/scripts.md`
- Modify: `assets/skills/comet-build/SKILL.md`
- Modify: `assets/skills/comet-verify/SKILL.md`
- Modify: `assets/skills/comet-archive/SKILL.md`
- Modify: `CHANGELOG.md`
- Verify/regenerate: `assets/skills/comet/scripts/comet-runtime.mjs`

**Interfaces:**

- Consumes: user-approved Chinese wording and all prior runtime behavior.
- Produces: bilingual public instructions, final beta4 release notes, generated runtime parity, and merge-readiness evidence.

- [x] **Step 1: Translate approved Chinese behavior into English**

Mirror every approved command and safety statement. Preserve technical tokens exactly:

```text
comet state
comet guard
comet handoff
comet archive
record-check
build
verify
COMET_SKIP_BUILD=1
```

Do not reintroduce direct launcher paths as the primary English workflow.

- [x] **Step 2: Add user-visible beta4 Changelog entries**

Under the existing `0.4.0-beta.4` entry, merge the final behavior into concise English bullets. Use these outcomes, adjusting only to avoid duplication with existing beta4 bullets:

```markdown
### Added

- **Stable Classic commands**: Added top-level `comet state`, `comet guard`, `comet handoff`, and `comet archive` commands so agents no longer depend on internal installed script paths ([#186](https://github.com/rpamis/comet/issues/186)).
- **Mixed change status**: `comet status` now distinguishes Comet-managed and plain OpenSpec changes and recommends the correct archive command for ready changes ([#187](https://github.com/rpamis/comet/issues/187)).

### Fixed

- **Archive annotations**: Classic archive annotations now preserve clean Markdown EOF formatting and remain idempotent, preventing `git diff --check` failures ([#185](https://github.com/rpamis/comet/issues/185)).
- **Custom project build evidence**: Projects without an inferred npm, Maven, or Cargo command can now record auditable build and verification results instead of relying on an undocumented skip path ([#192](https://github.com/rpamis/comet/issues/192)).
```

- [x] **Step 3: Rebuild runtime and run focused verification**

```bash
pnpm build:classic-runtime
npx vitest run test/domains/comet-classic/classic-archive.test.ts test/domains/comet-classic/classic-command-checks.test.ts test/domains/comet-classic/classic-runtime.test.ts test/domains/comet-classic/comet-scripts-guard.test.ts test/domains/comet-classic/comet-scripts.test.ts test/app/classic-command.test.ts test/app/status.test.ts test/app/cli-help.test.ts test/app/cli-smoke.test.ts
```

Expected: all focused tests pass.

- [x] **Step 4: Run repository checks**

```bash
pnpm format:check
pnpm lint
pnpm build
git diff --check
npx vitest run --no-file-parallelism
```

Expected: Prettier, ESLint, architecture lint, TypeScript/dashboard/runtime build, diff whitespace, and the full serial Vitest suite all exit 0. Use serial file mode because parallel CLI tests share generated `dist/` state on Windows.

- [x] **Step 5: Confirm release and compatibility invariants**

Run:

```bash
node -e "const p=require('./package.json'); if(p.version!=='0.4.0-beta.4') process.exit(1)"
node -e "const m=require('./assets/manifest.json'); if(m.version!=='0.4.0-beta.4') process.exit(1)"
git diff -- test/fixtures/classic-0.3.9
git status --short
```

Expected: both versions remain beta4, frozen fixture diff is empty, and the only uncommitted files are the intended English/Changelog/runtime changes.

- [x] **Step 6: Commit Task 7**

```bash
git add assets/skills/comet/reference/scripts.md assets/skills/comet-build/SKILL.md assets/skills/comet-verify/SKILL.md assets/skills/comet-archive/SKILL.md assets/skills/comet/scripts/comet-runtime.mjs CHANGELOG.md
git commit -m "docs: document stable Classic command workflows"
```

- [x] **Step 7: Request final review**

Use the `requesting-code-review` skill with the design commit as base and current HEAD as head. Fix all Critical and Important findings, rerun the affected focused tests, then rerun the full serial suite before claiming completion.
