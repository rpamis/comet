import { stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';

it.each(['1', '2', '3'] as const)(
  'does not construct the retired managed-check Native definition %s',
  (version) => {
    expect(() => defineNativeWorkflowApplication(version)).toThrow(/不再支持|no longer supported/u);
  },
);

it('exposes Agent tasks and acceptance without any managed-check executor or refresh command', () => {
  const application = defineNativeWorkflowApplication();
  expect(application.workflow.version).toBe('4');
  expect(application.workflow.commands).not.toHaveProperty('refresh-checks');
  expect(Object.keys(application.workflow.steps)).toEqual(
    expect.arrayContaining([
      'shape.prepare',
      'build.builder',
      'verify.verifier',
      'archive.prepare',
    ]),
  );
  expect(
    Object.values(application.workflow.steps).some((step) =>
      /(?:checks|requested-checks)$/u.test(step.ref ?? ''),
    ),
  ).toBe(false);
  expect(application.executors.some((executor) => executor.id === 'comet-native-checks')).toBe(
    false,
  );
});

it('does not ship retired Native execution and snapshot implementations', async () => {
  for (const name of [
    'native-check-executor',
    'native-sdk-check-execution',
    'native-sdk-checks',
    'native-portable-checks',
    'native-local-execution',
    'native-local-execution-binding',
    'native-check-stop-evidence',
    'native-snapshot',
    'native-verification-receipt-runtime',
    'native-supervisor-check-binding',
    'native-progress-checkpoint',
    'native-checkpoint-journal',
    'native-checkpoint-storage',
    'native-resume-view',
  ])
    await expect(
      stat(path.resolve('dist/domains/comet-native', name + '.js')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
});
