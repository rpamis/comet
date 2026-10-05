import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createRuntime,
  createMemoryRuntimeStore,
  hashRuntimeValue,
  type RuntimeOutcome,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { createApplicationArtifactValidator } from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-artifact-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const schema = {
  type: 'object',
  required: ['items'],
  additionalProperties: false,
  properties: { items: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } } },
};

it('rejects malformed actual JSON, stale hashes, wrong candidate and self-reported completion without changing the Action or files', async () => {
  let candidate = 'candidate-one';
  let business: { accepted: boolean } | undefined = { accepted: true };
  let bytes = JSON.stringify({ items: ['verified source'] });
  await fs.writeFile(path.join(root, 'report.json'), bytes);
  const validator = createApplicationArtifactValidator({
    id: 'actual-report',
    version: '1',
    projectRoot: root,
    artifacts: [{ ref: 'report.json', schema }],
    currentCandidate: () => candidate,
    candidateFromAction: ({ run }) => (run.input as { candidate: string }).candidate,
    validateActual: () => business as { accepted: boolean },
  });
  const store = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store,
    workflows: [
      {
        id: 'artifact-check',
        version: '1',
        entry: 'check',
        steps: {
          check: {
            type: 'handoff',
            ref: 'checker',
            validator: { id: validator.id, version: validator.version },
          },
        },
      },
    ],
    validators: [validator],
  });
  let run = await runtime.start({
    runId: 'check',
    workflow: { id: 'artifact-check', version: '1' },
    input: { candidate },
  });
  const dispatched = run.actions[0];
  run = await runtime.claim({
    runId: run.runId,
    actionId: dispatched.id,
    attempt: dispatched.attempt,
    inputHash: dispatched.inputHash,
    executorId: 'checker',
    claimToken: 'check-token',
  });
  const action = run.actions[0];
  const output = () => ({
    bindingHash: hashRuntimeValue(action.input),
    candidateHash: hashRuntimeValue(candidate),
    artifactHashes: { 'report.json': digest(bytes) },
  });
  let submission = 0;
  const outcome = (value: unknown): RuntimeOutcome => ({
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    outcomeId: `actual-check-${++submission}`,
    status: 'succeeded',
    output: value as RuntimeOutcome['output'],
  });
  const refuse = async (value: unknown) => {
    const before = await runtime.inspect(run.runId);
    const file = await fs.readFile(path.join(root, 'report.json'), 'utf8');
    await expect(
      runtime.recordOutcome({ runId: run.runId, outcome: outcome(value) }),
    ).rejects.toThrow(/修正|重新|核对/u);
    const after = await runtime.inspect(run.runId);
    expect(after.actions[0].status).toBe(before.actions[0].status);
    expect(after.actions[0].claim).toEqual(before.actions[0].claim);
    expect(after.actions[0].inputHash).toBe(before.actions[0].inputHash);
    expect(after.actions[0].outcome).toBeUndefined();
    expect(after.actions[0].rejectedOutcomes?.at(-1)?.outcome.output).toEqual(value);
    expect(after.outputs).toEqual(before.outputs);
    expect(await fs.readFile(path.join(root, 'report.json'), 'utf8')).toBe(file);
  };
  await refuse('completedChecks: all passed');
  await refuse({ completedChecks: ['actual-report'] });
  await refuse({ ...output(), candidateHash: hashRuntimeValue('other-candidate') });
  await refuse({ ...output(), bindingHash: hashRuntimeValue({ other: 'action' }) });
  const stale = output();
  bytes = JSON.stringify({ items: ['modified source'] });
  await fs.writeFile(path.join(root, 'report.json'), bytes);
  await refuse(stale);
  bytes = '{bad JSON';
  await fs.writeFile(path.join(root, 'report.json'), bytes);
  await refuse(output());
  bytes = JSON.stringify({ items: [] });
  await fs.writeFile(path.join(root, 'report.json'), bytes);
  await refuse(output());
  bytes = JSON.stringify({ completedChecks: ['passed'] });
  await fs.writeFile(path.join(root, 'report.json'), bytes);
  await refuse(output());
  bytes = JSON.stringify({ items: ['actual correction'] });
  await fs.writeFile(path.join(root, 'report.json'), bytes);
  const prior = output();
  candidate = 'candidate-two';
  await refuse(prior);
  await refuse(output());
  candidate = 'candidate-one';
  business = undefined;
  await refuse(output());
  business = { accepted: true };
  const completed = await runtime.recordOutcome({ runId: run.runId, outcome: outcome(output()) });
  expect(completed.status).toBe('completed');
});
