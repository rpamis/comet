import { afterEach, expect, it, vi } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  type RuntimeValue,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  defineNativeWorkflowApplication,
  nativeSdkApplicationForRun,
} from '../../../domains/comet-native/native-sdk-application.js';
import * as definitions from '../../../domains/comet-native/native-sdk-definition.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';

const application = defineNativeWorkflowApplication();
const currentHash = hashRuntimeValue(defineWorkflow(application.workflow));
const legacy = definitions.nativeSdkLegacyDefinitions(application.workflow);
const reference = (hash: string) => ({ workflow: { id: 'comet-native', version: '1', hash } });
afterEach(() => vi.restoreAllMocks());

it('returns the exact current application without constructing legacy definitions', () => {
  const probe = vi.spyOn(definitions, 'nativeSdkLegacyDefinitions');
  expect(nativeSdkApplicationForRun(reference(currentHash), application)).toBe(application);
  expect(probe).not.toHaveBeenCalled();
});

it.each(legacy.map((workflow, index) => ({ workflow, index })))(
  'retains known legacy definition $index and its transition adapter',
  ({ workflow }) => {
    const hash = hashRuntimeValue(defineWorkflow(workflow));
    const probe = vi.spyOn(definitions, 'nativeSdkLegacyDefinitions');
    const selected = nativeSdkApplicationForRun(reference(hash), application);
    expect(probe).toHaveBeenCalledOnce();
    expect(hashRuntimeValue(defineWorkflow(selected.workflow))).toBe(hash);
    expect(selected.transitionHandler).not.toBe(application.transitionHandler);
  },
);

it('keeps a missing Run on the original selection path', () => {
  const probe = vi.spyOn(definitions, 'nativeSdkLegacyDefinitions');
  expect(nativeSdkApplicationForRun(null, application)).toBe(application);
  expect(probe).toHaveBeenCalledOnce();
});

it('leaves an unknown hash rejected by Runtime inspection', async () => {
  const runtime = createRuntime({
    ...application,
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
  });
  const run = await runtime.start({
    runId: 'definition-selection',
    workflow: { id: 'comet-native', version: '1' },
    input: { name: 'definition-selection', artifactRootRef: 'docs' },
    initialState: createNativePortableState({
      name: 'definition-selection',
      language: 'en',
    }) as unknown as RuntimeValue,
  });
  const unknown = 'f'.repeat(64);
  const corrupted = {
    ...run,
    workflow: { ...run.workflow, hash: unknown },
    definitionHashes: Object.fromEntries(
      Object.keys(run.definitionHashes).map((key) => [key, unknown]),
    ),
  };
  const probe = vi.spyOn(definitions, 'nativeSdkLegacyDefinitions');
  const selected = nativeSdkApplicationForRun(corrupted, application);
  expect(probe).toHaveBeenCalledOnce();
  const reader = createRuntime({
    ...selected,
    store: { read: async () => corrupted, compareAndSwap: async () => false },
    workflows: [selected.workflow],
    transitionHandlers: [selected.transitionHandler],
  });
  await expect(reader.inspect(run.runId)).rejects.toMatchObject({ code: 'WORKFLOW_CHANGED' });
});
