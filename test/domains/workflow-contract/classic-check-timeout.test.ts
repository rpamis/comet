import { expect, it } from 'vitest';
import path from 'node:path';
import { stringify } from 'yaml';
import {
  parseWorkflowProjectConfigDocument,
  workflowProjectConfigManagedValue,
  mergeWorkflowProjectConfigDocument,
  workflowProjectConfigRuntimeHelperScript,
  renderStructuredProjectConfig,
} from '../../../domains/workflow-contract/project-config.js';

const source = (value: unknown) =>
  stringify({
    schema: 'comet.project.v1',
    default_workflow: 'classic',
    workflows: ['classic'],
    classic: { check_timeout_ms: value },
    extension: { keep: true },
  });
const validateGenerated = new Function(
  'path',
  `${workflowProjectConfigRuntimeHelperScript()}\nreturn managedWorkflowConfigFields;`,
)(path) as (source: string) => unknown;

it.each([1, 300000, 3600000])(
  'validates and preserves check_timeout_ms=%s through config round trips',
  (timeout) => {
    const parsed = parseWorkflowProjectConfigDocument(source(timeout));
    expect(parsed.classic?.check_timeout_ms).toBe(timeout);
    expect(workflowProjectConfigManagedValue(parsed.config!).classic).toMatchObject({
      check_timeout_ms: timeout,
    });
    const merged = mergeWorkflowProjectConfigDocument(parsed.value, parsed.config!);
    expect(merged.extension).toEqual({ keep: true });
    expect(
      parseWorkflowProjectConfigDocument(renderStructuredProjectConfig(merged, 'zh-CN')).classic
        ?.check_timeout_ms,
    ).toBe(timeout);
    expect(() => validateGenerated(source(timeout))).not.toThrow();
  },
);

it.each([0, -1, 3600001, 1.5, '300000', null, true, [], {}].map((value) => ({ value })))(
  'rejects invalid check_timeout_ms=%j in source and generated validators',
  ({ value: timeout }) => {
    expect(() => parseWorkflowProjectConfigDocument(source(timeout))).toThrow(
      /classic.check_timeout_ms.*1.*3600000/,
    );
    expect(() => validateGenerated(source(timeout))).toThrow(
      /classic.check_timeout_ms.*1.*3600000/,
    );
  },
);
