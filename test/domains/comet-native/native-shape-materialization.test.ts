import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  applyNativeDelta,
  nativeLegacySectionHash,
  nativeTotalSpecHash,
  type NativeDeltaDocument,
} from '../../../domains/comet-native/native-delta-spec.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(entry: 'source' | 'generated') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-create-delta-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const invoke = async (command: 'new' | 'next', ...args: string[]) => {
    const argv = [...args, '--project-root', root, '--json'];
    const result =
      entry === 'source'
        ? await runNativeCli([command, ...argv])
        : await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
            (resolve, reject) => {
              execFile(
                process.execPath,
                [
                  path.resolve(`assets/skills/comet-native/scripts/comet-native-${command}.mjs`),
                  ...argv,
                ],
                { cwd: root, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
                (error, stdout, stderr) => {
                  if (error && (typeof error.code !== 'number' || error.killed || error.signal))
                    reject(error);
                  else resolve({ exitCode: error?.code ?? 0, stdout, stderr });
                },
              );
            },
          );
    return { ...result, output: JSON.parse(result.stdout) };
  };
  const created = await invoke('new', 'new-delta');
  expect(created.exitCode, created.stdout).toBe(0);
  const change = path.join(root, 'docs/comet/changes/new-delta');
  await fs.writeFile(
    path.join(change, 'brief.md'),
    `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
## Directory structure
### Created
- app/workflow.ts: implement the workflow.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
  );
  const delta: NativeDeltaDocument = {
    schema: 'comet.native.delta.v1',
    capability: 'workflow',
    base_hash: nativeTotalSpecHash(''),
    base_version: 1,
    legacy_hash: nativeLegacySectionHash(''),
    base_requirements: {},
    operations: [
      {
        id: 'workflow.added',
        operation: 'add',
        title: 'Added behavior',
        body: 'The selected workflow resumes.',
      },
    ],
  };
  const target = applyNativeDelta({ baselineMarkdown: '', delta }).markdown;
  const directory = path.join(change, 'specs/workflow');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'spec.md');
  await fs.writeFile(file, target);
  await fs.writeFile(path.join(directory, 'delta.yaml'), JSON.stringify(delta));
  return { root, file, target, invoke };
}

it.each(['source', 'generated'] as const)(
  'prepares a new capability with an empty-baseline Delta through %s without granting approval',
  async (entry) => {
    const f = await fixture(entry);
    const prepared = await f.invoke('next', 'new-delta');
    expect(prepared.exitCode, prepared.stdout).toBe(0);
    expect(prepared.output.agent).toMatchObject({ phase: 'shape', status: 'await-user' });
    expect(prepared.output.agent.continuation).toMatchObject({
      action: 'confirm-shape',
      requiresUserDecision: true,
    });
    const repeated = await f.invoke('next', 'new-delta');
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect(repeated.output.agent).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      stateVersion: prepared.output.agent.stateVersion,
    });
    expect(await fs.readFile(f.file, 'utf8')).toBe(f.target);
    await expect(
      fs.lstat(path.join(f.root, 'docs/comet/specs/workflow/spec.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each(['source', 'generated'] as const)(
  'preserves an independently edited new target when its empty-baseline Delta disagrees through %s',
  async (entry) => {
    const f = await fixture(entry);
    const independent = f.target.replace(
      'The selected workflow resumes.',
      'A different workflow is required.',
    );
    await fs.writeFile(f.file, independent);
    const result = await f.invoke('next', 'new-delta');
    expect(result.exitCode, result.stdout).toBe(0);
    expect(result.output.agent).toMatchObject({ phase: 'shape', status: 'await-user' });
    expect(result.output.agent.continuation).toMatchObject({
      action: 'confirm-shape',
      requiresUserDecision: true,
    });
    expect(await fs.readFile(f.file, 'utf8')).toBe(independent);
    await expect(
      fs.lstat(path.join(f.root, 'docs/comet/specs/workflow/spec.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
