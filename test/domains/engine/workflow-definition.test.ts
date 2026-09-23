import { describe, expect, it } from 'vitest';
import * as workflowDefinition from '../../../domains/engine/workflow-definition.js';
import {
  approval,
  childWorkflow,
  defineWorkflow,
  skill,
  tool,
  type DefineWorkflowOptions,
} from '../../../domains/engine/workflow-definition.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime-json.js';

function editorialOptions(): DefineWorkflowOptions {
  return {
    id: 'editorial',
    version: '1.0.0',
    entry: 'draft',
    steps: {
      draft: { type: 'invoke_skill', ref: 'writer' },
      review: { type: 'ask_user', proposalFrom: 'draft' },
      publish: { type: 'call_tool', ref: 'export-article', retry: 'reconcile' },
    },
    transitions: [
      { from: 'draft', to: 'review' },
      { from: 'review', to: 'publish', on: 'approved' },
      { from: 'review', to: 'draft', on: 'rejected' },
    ],
  };
}

describe('workflow definition contract', () => {
  it('exposes a tool builder for call_tool steps', () => {
    expect(workflowDefinition).toHaveProperty('tool');
  });

  it('normalizes a cyclic editorial workflow into a portable frozen definition', () => {
    const options = editorialOptions();
    const workflow = defineWorkflow(options);
    expect(workflow).toEqual({
      id: 'editorial',
      version: '1.0.0',
      entry: ['draft'],
      steps: {
        draft: { type: 'invoke_skill', ref: 'writer', retry: 'manual' },
        review: {
          type: 'ask_user',
          proposalFrom: ['draft'],
          choices: ['approved', 'rejected'],
          retry: 'manual',
        },
        publish: { type: 'call_tool', ref: 'export-article', retry: 'reconcile' },
      },
      transitions: [
        { from: 'draft', to: 'review', on: 'succeeded' },
        { from: 'review', to: 'publish', on: 'approved' },
        { from: 'review', to: 'draft', on: 'rejected' },
      ],
      maxTransitions: 1000,
    });
    expect(JSON.parse(JSON.stringify(workflow))).toEqual(workflow);
    options.steps.draft.ref = 'changed-after-definition';
    expect(workflow.steps.draft).toMatchObject({ ref: 'writer' });
    expect(() => workflow.entry.push('publish')).toThrow();
    expect(() => {
      workflow.transitions[0].to = 'publish';
    }).toThrow();
  });

  it('normalizes builder inputs without retaining caller-owned nested values', () => {
    const input = { context: { audience: 'editors' } };
    const step = skill({
      ref: 'writer',
      input,
      outputSchema: {
        type: 'object',
        required: ['article'],
        properties: { article: { type: 'string' } },
      },
      validator: { id: 'article-quality', version: '1' },
      requiredCapabilities: ['skills'],
    });
    input.context.audience = 'changed';
    expect(step).toMatchObject({
      type: 'invoke_skill',
      retry: 'manual',
      input: { context: { audience: 'editors' } },
      validator: { id: 'article-quality', version: '1' },
    });
    expect(Object.isFrozen(step.input)).toBe(true);
    expect(tool({ ref: 'export' })).toEqual({ type: 'call_tool', ref: 'export', retry: 'manual' });
    expect(approval({ proposalFrom: 'draft', choices: 'accept' })).toEqual({
      type: 'ask_user',
      proposalFrom: ['draft'],
      choices: ['accept'],
      retry: 'manual',
    });
    expect(childWorkflow({ workflow: { id: 'fact-check', version: '2' } })).toEqual({
      type: 'child_workflow',
      workflow: { id: 'fact-check', version: '2' },
      retry: 'manual',
    });
  });

  it('accepts parallel entries and fan-in dependencies without imposing a DAG', () => {
    const workflow = defineWorkflow({
      id: 'research',
      version: '1',
      entry: ['sources', 'facts'],
      steps: {
        sources: skill({ ref: 'find-sources' }),
        facts: childWorkflow({ workflow: { id: 'fact-check', version: '1' } }),
        summarize: skill({ ref: 'summarize', join: ['sources', 'facts'] }),
        editor: { type: 'handoff', ref: 'editor' },
      },
      transitions: [
        { from: 'sources', to: 'summarize' },
        { from: 'facts', to: 'summarize' },
        { from: 'summarize', to: 'editor' },
        { from: 'editor', to: 'sources', on: 'revise' },
      ],
      maxTransitions: 20,
    });
    expect(workflow.entry).toEqual(['sources', 'facts']);
    expect(workflow.steps.summarize.join).toEqual(['sources', 'facts']);
    expect(workflow.maxTransitions).toBe(20);
  });

  it('binds normalized equivalent definitions to the same hash', () => {
    const concise = defineWorkflow(editorialOptions());
    const explicit = JSON.parse(JSON.stringify(concise)) as DefineWorkflowOptions;
    expect(hashRuntimeValue(defineWorkflow(explicit))).toBe(hashRuntimeValue(concise));
    const changed = editorialOptions();
    changed.steps.draft.ref = 'different-writer';
    expect(hashRuntimeValue(defineWorkflow(changed))).not.toBe(hashRuntimeValue(concise));
  });

  it('rejects joins that omit an incoming parent', () => {
    expect(() =>
      defineWorkflow({
        id: 'parallel',
        version: '1',
        entry: ['left', 'right'],
        steps: {
          left: { type: 'invoke_skill', ref: 'left' },
          right: { type: 'invoke_skill', ref: 'right' },
          merge: { type: 'invoke_skill', ref: 'merge', join: ['left'] },
        },
        transitions: [
          { from: 'left', to: 'merge' },
          { from: 'right', to: 'merge' },
        ],
      }),
    ).toThrow(/INVALID_WORKFLOW/u);
  });

  it.each([
    ['blank id', { id: ' ' }],
    ['blank version', { version: '' }],
    ['missing entry', { entry: undefined }],
    ['empty entry', { entry: [] }],
    ['unknown entry', { entry: 'absent' }],
    ['duplicate entry', { entry: ['draft', 'draft'] }],
    ['no steps', { steps: {} }],
    ['zero transition budget', { maxTransitions: 0 }],
    ['fractional transition budget', { maxTransitions: 1.5 }],
    ['unsafe transition budget', { maxTransitions: Number.MAX_SAFE_INTEGER + 1 }],
    ['null transition budget', { maxTransitions: null }],
    ['null transitions', { transitions: null }],
    ['implicit branch cancellation', { completeAfter: ['draft'] }],
  ])('rejects %s before creating a workflow', (_name, changes) => {
    expect(() =>
      defineWorkflow({ ...editorialOptions(), ...changes } as DefineWorkflowOptions),
    ).toThrow(/INVALID_(WORKFLOW|JSON)/u);
  });

  it.each([
    ['unknown source', [{ from: 'absent', to: 'review' }]],
    ['unknown target', [{ from: 'draft', to: 'absent' }]],
    ['blank event', [{ from: 'draft', to: 'review', on: '' }]],
    [
      'duplicate edge after default normalization',
      [
        { from: 'draft', to: 'review' },
        { from: 'draft', to: 'review', on: 'succeeded' },
      ],
    ],
  ])('rejects %s', (_name, transitions) => {
    expect(() => defineWorkflow({ ...editorialOptions(), transitions })).toThrow(
      /INVALID_(WORKFLOW|JSON)/u,
    );
  });

  it.each([
    ['unknown join parent', { type: 'call_tool', ref: 'export', join: ['absent'] }],
    ['join without incoming edge', { type: 'call_tool', ref: 'export', join: ['draft'] }],
    ['duplicate dependency', { type: 'call_tool', ref: 'export', join: ['review', 'review'] }],
    ['empty join', { type: 'call_tool', ref: 'export', join: [] }],
    ['unknown proposal source', { type: 'ask_user', proposalFrom: ['absent'] }],
    ['duplicate proposal source', { type: 'ask_user', proposalFrom: ['draft', 'draft'] }],
  ])('rejects %s', (_name, step) => {
    const options = editorialOptions();
    options.steps.publish = step as DefineWorkflowOptions['steps'][string];
    expect(() => defineWorkflow(options)).toThrow(/INVALID_(WORKFLOW|JSON)/u);
  });

  it.each([
    ['blank skill reference', () => skill({ ref: '' })],
    ['blank tool reference', () => tool({ ref: ' ' })],
    ['empty proposal sources', () => approval({ proposalFrom: [] })],
    ['duplicate choices', () => approval({ proposalFrom: 'draft', choices: ['yes', 'yes'] })],
    ['blank child version', () => childWorkflow({ workflow: { id: 'child', version: '' } })],
    [
      'blank validator version',
      () => skill({ ref: 'writer', validator: { id: 'quality', version: ' ' } }),
    ],
    ['empty capability', () => skill({ ref: 'writer', requiredCapabilities: [''] })],
    ['unknown retry policy', () => skill({ ref: 'writer', retry: 'always' as 'manual' })],
    ['null retry policy', () => skill({ ref: 'writer', retry: null as never })],
    ['null approval choices', () => approval({ proposalFrom: 'draft', choices: null as never })],
    ['invalid output schema', () => skill({ ref: 'writer', outputSchema: { type: 'not-a-type' } })],
    [
      'unresolved schema reference',
      () => skill({ ref: 'writer', outputSchema: { $ref: 'https://example.invalid/schema' } }),
    ],
    [
      'asynchronous output schema',
      () => skill({ ref: 'writer', outputSchema: { $async: true, type: 'string' } }),
    ],
    [
      'runtime function validator',
      () => skill({ ref: 'writer', validator: (() => true) as never }),
    ],
    ['non-JSON input', () => skill({ ref: 'writer', input: { now: new Date() } as never })],
    [
      'undefined nested input',
      () => skill({ ref: 'writer', input: { missing: undefined } as never }),
    ],
    ['non-finite input', () => skill({ ref: 'writer', input: Infinity })],
  ])('rejects %s at the builder boundary', (_name, build) => {
    expect(build).toThrow(/INVALID_(WORKFLOW|JSON)/u);
  });

  it('rejects a null transition event instead of defaulting it', () => {
    const options = editorialOptions();
    options.transitions = [{ from: 'draft', to: 'review', on: null as never }];
    expect(() => defineWorkflow(options)).toThrow(/INVALID_WORKFLOW/u);
  });

  it('accepts self-contained boolean and referenced JSON Schemas', () => {
    expect(skill({ ref: 'writer', outputSchema: false }).outputSchema).toBe(false);
    expect(
      skill({
        ref: 'writer',
        outputSchema: {
          definitions: { text: { type: 'string' } },
          $ref: '#/definitions/text',
        },
      }).outputSchema,
    ).toEqual({
      definitions: { text: { type: 'string' } },
      $ref: '#/definitions/text',
    });
  });

  it('rejects unsupported fields and non-JSON properties before getters can execute', () => {
    let reads = 0;
    const options = editorialOptions();
    Object.defineProperty(options.steps.draft, 'input', {
      enumerable: true,
      get() {
        reads += 1;
        return { secret: 'value' };
      },
    });
    expect(() => defineWorkflow(options)).toThrow(/INVALID_(WORKFLOW|JSON)/u);
    expect(reads).toBe(0);
    expect(() => skill({ ref: 'writer', unknownSetting: true } as never)).toThrow(
      /INVALID_(WORKFLOW|JSON)/u,
    );
  });
});
