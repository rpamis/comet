import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { readNativeCheckReceipt } from '../../../domains/comet-native/native-check-receipt-storage.js';
import { nativeChangeDir, readNativeChange } from '../../../domains/comet-native/native-change.js';
import { readNativeVerificationEvidence } from '../../../domains/comet-native/native-evidence-storage.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';

const brief = `# Outcome
Keep the focused source valid.
# Scope
Update the declared implementation.
# Non-goals
No unrelated refactor.
# Acceptance examples
- The source passes the built-in whitespace check.
# Constraints and invariants
Do not mutate workflow state while checking.
# Decisions
Use the built-in Native check.
# Open questions
None.
# Verification expectations
Run comet native check.
`;

interface JsonEnvelope {
  command: string | null;
  exitCode: number;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}

describe('Native check public seam', () => {
  let projectRoot: string;
  const name = 'safe-check';
  const projectArgs = () => ['--project-root', projectRoot] as const;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-check-cli-'));
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const value = 1;\n');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function prepareVerifyChange(
    changeName = name,
    implementation = 'export const value = 2;\n',
  ): Promise<{
    paths: Awaited<ReturnType<typeof nativeProjectPaths>>;
    changeDir: string;
  }> {
    const created = await runNativeCli(['new', changeName, '--json', ...projectArgs()]);
    expect(created.exitCode, created.stderr).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = nativeChangeDir(paths, changeName);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await fs.mkdir(path.join(changeDir, 'specs', changeName), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', changeName, 'spec.md'),
      '# Safe check\nThe implementation must remain valid.\n',
    );
    const shaped = await runNativeCli([
      'next',
      changeName,
      '--summary',
      'Requirements are ready',
      '--confirmed',
      '--json',
      ...projectArgs(),
    ]);
    expect(shaped.exitCode, shaped.stderr).toBe(0);
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), implementation);
    const built = await runNativeCli([
      'next',
      changeName,
      '--summary',
      'Implementation is ready',
      '--artifact',
      'feature.ts',
      '--json',
      ...projectArgs(),
    ]);
    expect(built.exitCode, built.stderr).toBe(0);
    await expect(readNativeChange(paths, changeName)).resolves.toMatchObject({
      phase: 'verify',
      implementation_scope: expect.stringMatching(
        /^runtime\/evidence\/scopes\/[a-f0-9]{64}\.json$/u,
      ),
    });
    return { paths, changeDir };
  }

  it('runs the internal scoped check through a whitelist-only CLI projection', async () => {
    const { paths, changeDir } = await prepareVerifyChange();
    const stateBefore = await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8');
    const runBefore = await fs.readFile(path.join(changeDir, 'runtime', 'run-state.json'), 'utf8');
    const trajectoryBefore = await fs.readFile(
      path.join(changeDir, 'runtime', 'trajectory.jsonl'),
      'utf8',
    );

    const checked = json(await runNativeCli(['check', name, '--json', ...projectArgs()]));
    expect(checked).toMatchObject({
      command: 'check',
      exitCode: 0,
      data: {
        status: 'passed',
        stale: false,
        issues: [],
        issuesTruncated: false,
        counts: {
          filesSelected: 1,
          filesScanned: 1,
          binaryFilesSkipped: 0,
          issueCount: 0,
          recordedIssueCount: 0,
        },
      },
    });
    expect(Object.keys(checked.data!).sort()).toEqual(
      [
        'checker',
        'counts',
        'endedAt',
        'hash',
        'issues',
        'issuesTruncated',
        'ref',
        'sourceRevision',
        'stale',
        'staleReasons',
        'startedAt',
        'status',
      ].sort(),
    );
    const firstRef = checked.data!.ref as string;
    const firstReceipt = await readNativeCheckReceipt(paths, name, firstRef);
    expect(firstReceipt.schema).toBe('comet.native.check-receipt.v1');

    const serializedProjection = JSON.stringify(checked.data);
    expect(serializedProjection).not.toContain(projectRoot);
    expect(serializedProjection).not.toContain('diff');
    expect(serializedProjection).not.toContain('argv');
    expect(serializedProjection).not.toContain('executable');
    expect(serializedProjection).not.toContain('stdout');
    expect(serializedProjection).not.toContain('stderr');
    expect(await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8')).toBe(stateBefore);
    expect(await fs.readFile(path.join(changeDir, 'runtime', 'run-state.json'), 'utf8')).toBe(
      runBefore,
    );
    expect(await fs.readFile(path.join(changeDir, 'runtime', 'trajectory.jsonl'), 'utf8')).toBe(
      trajectoryBefore,
    );
  });

  it('binds a fresh public check receipt into the Verify envelope', async () => {
    const { paths, changeDir } = await prepareVerifyChange();
    const checked = json(await runNativeCli(['check', name, '--json', ...projectArgs()]));
    expect(checked.exitCode).toBe(0);
    const receiptRef = checked.data!.ref as string;
    const status = json(
      await runNativeCli(['status', name, '--details', '--json', ...projectArgs()]),
    );
    const criteria = (
      status.data as { acceptancePage: { items: Array<{ id: string }> } }
    ).acceptancePage.items.map((criterion) => ({
      acceptance_id: criterion.id,
      evidence_refs: ['feature.ts'],
    }));
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
<!-- comet-native:acceptance-evidence:start -->
${JSON.stringify(criteria, null, 2)}
<!-- comet-native:acceptance-evidence:end -->
# Commands and results
The built-in check passed.
# Skipped checks
None.
# Spec consistency
Consistent.
# Known limitations and risks
None.
# Conclusion
Pass.
`,
    );

    const verified = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Verification passed with a bound receipt.',
        '--result',
        'pass',
        '--report',
        'verification.md',
        '--receipt',
        receiptRef,
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(verified).toMatchObject({ exitCode: 0, data: { change: { phase: 'archive' } } });
    const state = await readNativeChange(paths, name);
    const envelope = await readNativeVerificationEvidence(
      paths,
      name,
      state.verification_evidence!,
    );
    expect(envelope.receiptRef).toBe(receiptRef);
  });

  it('returns CLI exit 1 and persists bounded text issues without changing workflow state', async () => {
    const { paths, changeDir } = await prepareVerifyChange(
      name,
      'export const value = 3; \n<<<<<<< HEAD\n=======\n>>>>>>> branch\n',
    );
    const before = await readNativeChange(paths, name);
    const trajectoryBefore = await fs.readFile(
      path.join(changeDir, 'runtime', 'trajectory.jsonl'),
      'utf8',
    );
    const result = json(await runNativeCli(['check', name, '--json', ...projectArgs()]));

    expect(result).toMatchObject({
      command: 'check',
      exitCode: 1,
      data: {
        status: 'failed',
        stale: false,
        staleReasons: [],
        issues: [
          { path: 'feature.ts', line: 1, kind: 'trailing-whitespace' },
          { path: 'feature.ts', line: 2, kind: 'conflict-marker' },
          { path: 'feature.ts', line: 3, kind: 'conflict-marker' },
          { path: 'feature.ts', line: 4, kind: 'conflict-marker' },
        ],
        sourceRevision: before.revision,
      },
    });
    expect(result.error).toBeUndefined();
    const receipt = await readNativeCheckReceipt(paths, name, result.data!.ref as string);
    expect(receipt).toMatchObject({ status: 'failed', stale: false });
    await expect(readNativeChange(paths, name)).resolves.toEqual(before);
    expect(await fs.readFile(path.join(changeDir, 'runtime', 'trajectory.jsonl'), 'utf8')).toBe(
      trajectoryBefore,
    );
  });

  it('rejects non-Verify use and any attempt to supply a command or path', async () => {
    const shapeName = 'shape-check';
    await runNativeCli(['new', shapeName, '--json', ...projectArgs()]);
    const shape = json(await runNativeCli(['check', shapeName, '--json', ...projectArgs()]));
    expect(shape).toMatchObject({ exitCode: 65, error: { code: 'invalid-data' } });

    const { changeDir } = await prepareVerifyChange();
    const receiptDirectory = path.join(changeDir, 'runtime', 'evidence', 'check-receipts');
    const countReceipts = async (): Promise<number> => {
      try {
        return (await fs.readdir(receiptDirectory)).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
    };
    const beforeCount = await countReceipts();
    for (const extras of [
      ['git', 'diff', '--check'],
      ['--command', 'git'],
      ['--path', 'feature.ts'],
      ['--staged'],
      ['--timeout', '99'],
    ]) {
      const rejected = json(
        await runNativeCli(['check', name, ...extras, '--json', ...projectArgs()]),
      );
      expect(rejected).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
    }
    expect(await countReceipts()).toBe(beforeCount);
  });
});
