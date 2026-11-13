import { expect, it } from 'vitest';
import { defineWorkflow, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  defineNativeWorkflowApplication,
  nativeSdkApplicationForRun,
} from '../../../domains/comet-native/native-sdk-application.js';
import { nativeSdkMatchesRun } from '../../../domains/comet-native/native-sdk-definition.js';

it('selects only the current Native definition after business data adaptation', () => {
  const app = defineNativeWorkflowApplication(),
    definition = defineWorkflow(app.workflow);
  const current = {
    workflow: {
      id: definition.id,
      version: definition.version,
      hash: hashRuntimeValue(definition),
    },
  };
  expect(nativeSdkApplicationForRun(current, app)).toBe(app);
  expect(nativeSdkApplicationForRun(null, app)).toBe(app);
  for (const version of ['1', '2', '3'])
    expect(() =>
      nativeSdkApplicationForRun({ workflow: { ...current.workflow, version } }, app),
    ).toThrow('业务数据适配');
  for (const step of [
    'shape.revalidate',
    'verify.revalidate',
    'verify.checks',
    'verify.requested-checks',
    'supervisor.child.checks',
    'supervisor.child.integration-checks',
  ])
    expect(app.workflow.steps).not.toHaveProperty(step);
  expect(app.executors.some((executor) => executor.id === 'comet-native-checks')).toBe(false);
});
it('rejects an unadapted definition and preserves canonical definition isolation', () => {
  const app = defineNativeWorkflowApplication(),
    definition = defineWorkflow(app.workflow);
  const current = {
    workflow: {
      id: definition.id,
      version: definition.version,
      hash: hashRuntimeValue(definition),
    },
  };
  expect(() =>
    nativeSdkApplicationForRun({ workflow: { ...current.workflow, hash: 'f'.repeat(64) } }, app),
  ).toThrow('业务数据适配');
  const compiled = { ...app, workflow: definition };
  expect(nativeSdkMatchesRun(compiled.workflow, current)).toBe(true);
  const fresh = defineNativeWorkflowApplication();
  fresh.workflow.steps['shape.prepare'].ref = 'changed';
  expect(nativeSdkMatchesRun(fresh.workflow, current)).toBe(false);
  expect(defineNativeWorkflowApplication().workflow.steps['shape.prepare'].ref).not.toBe('changed');
});
