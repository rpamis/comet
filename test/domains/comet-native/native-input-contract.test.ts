import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseNativeRunnerInput,
  readNativeRunnerInput,
} from '../../../domains/comet-native/native-runner-input.js';
import { errorResult } from '../../../domains/comet-native/native-cli-shared.js';
import { projectNativeSupervisorTask } from '../../../domains/comet-native/native-supervisor.js';

describe('Agent runner input contract', () => {
  it('reports missing and unknown fields at the nested JSON pointer without values', () => {
    try {
      parseNativeRunnerInput({
        kind: 'dispatch-verifier',
        checks: [{ id: 'check', unexpected: 'secret-value' }],
      });
      throw new Error('Expected rejection');
    } catch (error) {
      const result = errorResult('next', error);
      expect(result.exitCode).toBe(65);
      expect(result.error?.issues?.[0]).toMatchObject({
        path: '/checks/0',
        unknownFields: ['unexpected'],
      });
      expect(result.error?.issues?.[0].missingFields).toContain('executable');
      expect(JSON.stringify(result)).not.toContain('secret-value');
    }
  });

  it('accepts UTF-8 BOM JSON written by Windows tools', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-input-bom-'));
    try {
      await fs.writeFile(
        path.join(root, 'input.json'),
        '\ufeff{"kind":"dispatch-verifier","checks":[]}',
      );
      expect(await readNativeRunnerInput('input.json', root)).toEqual({
        kind: 'dispatch-verifier',
        checks: [],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns controller cwd and a directly parsable Builder result template', () => {
    const task = projectNativeSupervisorTask(
      {
        role: 'builder',
        child: 'child-a',
        runId: 'run-a',
        projectRoot: '/child',
        baseCommit: 'a'.repeat(40),
      },
      'parent',
      '/controller',
    );
    expect(task.returnAction.cwd).toBe('/controller');
    const template = task.returnAction.inputOptions[0].template;
    expect(parseNativeRunnerInput({ ...template, candidateCommit: 'b'.repeat(40) })).toMatchObject({
      kind: 'supervisor-builder-result',
      child: 'child-a',
      runId: 'run-a',
    });
  });

  it('returns directly parsable Verifier templates with a usable controller command', () => {
    const task = projectNativeSupervisorTask(
      {
        role: 'verifier',
        child: 'child-a',
        runId: 'run-a',
        projectRoot: '/child',
        baseCommit: 'a'.repeat(40),
        acceptance: [{ id: 'acceptance-a', source: 'spec.md', text: 'The change works.' }],
      },
      'parent',
      '/controller',
    );

    expect(task.returnAction).toMatchObject({
      cwd: '/controller',
      commandArgs: [
        'comet',
        'native',
        'next',
        'parent',
        '--runner-input',
        '<temporary-json-file>',
        '--json',
      ],
    });
    for (const option of task.returnAction.inputOptions) {
      expect(() => parseNativeRunnerInput(option.template)).not.toThrow();
    }
  });
});
