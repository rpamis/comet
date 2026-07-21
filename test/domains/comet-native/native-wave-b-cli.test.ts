import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';

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

describe('Native Wave B CLI contract', () => {
  let projectRoot: string;
  const projectArgs = () => ['--project-root', projectRoot] as const;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-wave-b-cli-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    await runNativeCli(['new', 'cold-resume', ...projectArgs()]);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps one envelope and returns the same continuation shape from mutations and status', async () => {
    const checkpoint = json(
      await runNativeCli([
        'checkpoint',
        'cold-resume',
        '--summary',
        'Parser work is complete',
        '--next-action',
        'Fill the remaining brief decisions',
        '--expect-revision',
        '1',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(Object.keys(checkpoint).sort()).toEqual(['command', 'data', 'exitCode']);
    expect(checkpoint).toMatchObject({
      command: 'checkpoint',
      exitCode: 0,
      data: {
        change: { phase: 'shape', revision: 2 },
        checkpoint: {
          manifestRef: expect.stringMatching(
            /^docs\/comet\/changes\/cold-resume\/runtime\/checkpoints\/manifests\//u,
          ),
        },
        expectedRevision: 1,
        previousRevision: 1,
        revision: 2,
        outcome: 'recorded',
        continuation: {
          schema: 'comet.native.continuation.v1',
          skill: 'comet-native',
          change: 'cold-resume',
          phase: 'shape',
          revision: 2,
          disposition: 'continue',
          action: 'work-phase',
          command: null,
          requiresUserDecision: false,
        },
      },
    });

    const status = json(await runNativeCli(['status', 'cold-resume', '--json', ...projectArgs()]));
    expect(status.data).toMatchObject({
      revision: 2,
      inspection: { freshness: 'fresh' },
      checkpoint: { summary: 'Parser work is complete' },
      detailsCommand: 'comet native status cold-resume --details',
      continuation: checkpoint.data!.continuation,
    });
    expect(status.data).not.toHaveProperty('findings');
    expect(status.data).not.toHaveProperty('checkpointDetails');
  });

  it('puts bounded finding and manifest details behind status --details', async () => {
    const details = json(
      await runNativeCli(['status', 'cold-resume', '--details', '--json', ...projectArgs()]),
    );
    expect(details.data).toMatchObject({
      findings: expect.any(Array),
      checkpointDetails: null,
      budgets: { maxFindings: 50, maxCheckpointArtifacts: 128 },
    });
    const invalid = json(await runNativeCli(['status', '--details', '--json', ...projectArgs()]));
    expect(invalid).toMatchObject({
      command: 'status',
      exitCode: 64,
      error: { code: 'usage', message: 'status --details requires a change name' },
    });
  });

  it('returns revision conflicts with exit 73 and decision findings with stable fields', async () => {
    await runNativeCli([
      'checkpoint',
      'cold-resume',
      '--summary',
      'First checkpoint',
      '--next-action',
      'Continue',
      '--expect-revision',
      '1',
      ...projectArgs(),
    ]);
    const conflict = json(
      await runNativeCli([
        'checkpoint',
        'cold-resume',
        '--summary',
        'Different checkpoint',
        '--next-action',
        'Continue elsewhere',
        '--expect-revision',
        '1',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(conflict).toMatchObject({
      command: 'checkpoint',
      exitCode: 73,
      data: {
        change: 'cold-resume',
        expectedRevision: 1,
        actualRevision: 2,
        outcome: 'revision-conflict',
      },
      error: { code: 'conflict' },
    });

    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const briefFile = path.join(paths.changesDir, 'cold-resume', 'brief.md');
    const source = await fs.readFile(briefFile, 'utf8');
    await fs.writeFile(
      briefFile,
      source
        .replace('# Outcome\n', '# Outcome\nA clear outcome.\n')
        .replace('# Scope\n', '# Scope\nA bounded scope.\n')
        .replace('# Non-goals\n', '# Non-goals\nNo unrelated work.\n')
        .replace('# Acceptance examples\n', '# Acceptance examples\n- It works.\n')
        .replace('# Open questions\n', '# Open questions\n- [blocking] Which behavior?\n'),
    );
    const blocked = json(
      await runNativeCli([
        'next',
        'cold-resume',
        '--summary',
        'Try to proceed',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(blocked).toMatchObject({
      exitCode: 65,
      data: {
        findings: [
          {
            code: 'brief-blocking-question',
            severity: 'error',
            path: 'docs/comet/changes/cold-resume/brief.md',
            requiredAction: 'answer-blocking-question',
            retryCommand: 'comet native next cold-resume --summary "<summary>"',
            repairCommand: null,
            requiresUserDecision: true,
          },
        ],
        continuation: {
          disposition: 'await-user',
          requiresUserDecision: true,
        },
      },
    });
  });
});
