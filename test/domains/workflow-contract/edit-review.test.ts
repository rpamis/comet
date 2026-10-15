import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  prepareEditReview,
  recordEditReview,
  inspectEditReviews,
  assertEditReviewsComplete,
  approvedEditFingerprint,
  claimedEditReviewAuthority,
  claimEditReview,
  claimedEditReviewExecutionAuthority,
  editReviewContinuation,
  rememberEditReviewInput,
} from '../../../domains/workflow-contract/edit-review.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(workflow: 'native' | 'classic' = 'native') {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-edit-review-'));
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-edit-review-runtime-'));
  roots.push(projectRoot, runtimeRoot);
  await fs.writeFile(path.join(projectRoot, 'worker.py'), 'value = 1\n');
  const scope = {
    projectRoot,
    runtimeRoot,
    workflow,
    change: 'review',
    candidateKey: 'candidate-1',
    formalPrefixes: ['docs/comet'],
  };
  const request = {
    intent: 'write' as const,
    toolName: 'Edit',
    targets: ['worker.py'],
    writes: [
      {
        path: 'worker.py',
        replacements: [
          {
            oldText: 'value = 1\n',
            newText: '# Explain the value.\nvalue = 1\n',
            replaceAll: false,
          },
        ],
      },
    ],
  };
  return { scope, request };
}
describe('bound edit reviews', () => {
  it('recovers a bound independent review without claiming the formal Verifier Action', async () => {
    const f = await fixture();
    const proposal = await prepareEditReview(f.scope, f.request);
    await expect(
      claimEditReview(f.scope, { sessionId: 'builder', builderExecutionRef: 'builder' }),
    ).rejects.toThrow('独立');
    const claimed = await claimEditReview(f.scope, {
      sessionId: 'reviewer',
      builderExecutionRef: 'builder',
    });
    expect(
      (await claimEditReview(f.scope, { sessionId: 'reviewer', builderExecutionRef: 'builder' }))
        .recordTemplate,
    ).toEqual(claimed.recordTemplate);
    const input = {
      ...claimed.recordTemplate,
      decision: 'non-behavioral' as const,
      summary: 'Only explanatory text changes.',
    };
    await expect(
      claimedEditReviewExecutionAuthority(f.scope, 'builder', {
        ...input,
        reviewer: { sessionId: 'reviewer', claimToken: 'wrong' },
      }),
    ).rejects.toThrow('回执');
    await expect(
      claimedEditReviewExecutionAuthority({ ...f.scope, candidateKey: 'other' }, 'builder', input),
    ).rejects.toThrow();
    const authority = await claimedEditReviewExecutionAuthority(f.scope, 'builder', input);
    const receipt = await recordEditReview(f.scope, input, authority);
    expect(JSON.stringify(receipt)).not.toContain(input.reviewer.claimToken);
    expect(
      (
        await claimEditReview(f.scope, {
          sessionId: 'reviewer',
          builderExecutionRef: 'builder',
          proposalHash: proposal.proposalHash,
        })
      ).recordTemplate.reviewer.claimToken,
    ).toBe(input.reviewer.claimToken);
    await expect(
      claimEditReview(f.scope, {
        sessionId: 'another-reviewer',
        builderExecutionRef: 'builder',
        proposalHash: proposal.proposalHash,
      }),
    ).rejects.toThrow('已有复核结论');
    expect(
      (await editReviewContinuation(f.scope, await inspectEditReviews(f.scope), true))
        ?.requiredInputs,
    ).toContain('重试已经复核通过的原始编辑调用');
    await fs.writeFile(
      path.join(f.scope.projectRoot, 'worker.py'),
      '# Explain the value.\nvalue = 1\n',
    );
    expect(
      await editReviewContinuation(f.scope, await inspectEditReviews(f.scope), true),
    ).toBeNull();
    expect(receipt.proposalHash).toBe(proposal.proposalHash);
  });

  it('keeps original input outside Runtime and refuses to reuse a changed input reference', async () => {
    const f = await fixture();
    const proposal = await prepareEditReview(f.scope, f.request);
    const inputFile = path.join(f.scope.projectRoot, 'request.json');
    const source = JSON.stringify(f.request);
    await fs.writeFile(inputFile, source);
    await rememberEditReviewInput(f.scope, proposal.proposalHash, inputFile, source);
    const next = await editReviewContinuation(f.scope, await inspectEditReviews(f.scope), true);
    expect(next?.commandArgs).toContain(inputFile);
    const claimed = await claimEditReview(f.scope, {
      sessionId: 'reviewer',
      builderExecutionRef: 'builder',
      proposalHash: proposal.proposalHash,
    });
    expect(claimed.originalRequestRef).toBe(inputFile);
    expect(claimed.originalRequestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(claimed).not.toHaveProperty('request');
    await fs.writeFile(inputFile, '{}');
    expect(
      (await editReviewContinuation(f.scope, await inspectEditReviews(f.scope), true))
        ?.requiredInputs,
    ).toContain('原始编辑请求');
    await expect(
      rememberEditReviewInput(f.scope, proposal.proposalHash, inputFile, source),
    ).rejects.toThrow('发生变化');
  });

  it('requires the current independent claimed Verifier session', () => {
    const action = {
      id: 'verify-1',
      stepId: 'verify.verifier',
      status: 'running',
      attempt: 1,
      inputHash: 'input-1',
      claim: { token: 'token-1', sessionId: 'verifier' },
    };
    const claim = {
      actionId: action.id,
      attempt: 1,
      inputHash: action.inputHash,
      claimToken: 'token-1',
      sessionId: 'verifier',
    };
    expect(claimedEditReviewAuthority([action], action.stepId, 'builder', claim).kind).toBe(
      'runtime-verifier',
    );
    for (const changed of [
      { ...claim, claimToken: 'stale' },
      { ...claim, attempt: 2 },
      { ...claim, sessionId: 'builder' },
      { ...claim, inputHash: 'stale' },
    ])
      expect(() => claimedEditReviewAuthority([action], action.stepId, 'builder', changed)).toThrow(
        '独立 Verifier',
      );
    expect(() =>
      claimedEditReviewAuthority(
        [{ ...action, status: 'succeeded' }],
        action.stepId,
        'builder',
        claim,
      ),
    ).toThrow();
  });
  it('holds the current candidate until its exact reviewed edit is applied', async () => {
    const f = await fixture();
    const proposal = await prepareEditReview(f.scope, f.request);
    await expect(assertEditReviewsComplete(f.scope)).rejects.toThrow('待复核');
    await recordEditReview(
      f.scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'non-behavioral',
        summary: 'Only a Python comment changed.',
      },
      { kind: 'runtime-verifier', executionRef: 'verifier-1' },
    );
    await expect(assertEditReviewsComplete(f.scope)).rejects.toThrow('尚未应用');
    await fs.writeFile(
      path.join(f.scope.projectRoot, 'worker.py'),
      '# Explain the value.\nvalue = 1\n',
    );
    await expect(assertEditReviewsComplete(f.scope)).resolves.toBeUndefined();
    expect(
      await approvedEditFingerprint(f.scope, 'worker.py', '# Explain the value.\nvalue = 1\n'),
    ).toMatchObject({ fingerprint: proposal.edits[0].beforeInputHash, semantic: false });
    await fs.writeFile(
      path.join(f.scope.projectRoot, 'worker.py'),
      '# Explain the value.\nvalue = 2\n',
    );
    await expect(assertEditReviewsComplete(f.scope)).rejects.toThrow('不匹配');
  });
  it('keeps unrelated candidates isolated and refuses conflicting decisions', async () => {
    const f = await fixture();
    const proposal = await prepareEditReview(f.scope, f.request);
    expect(await inspectEditReviews({ ...f.scope, candidateKey: 'candidate-2' })).toEqual([]);
    await expect(
      recordEditReview(
        { ...f.scope, candidateKey: 'candidate-2' },
        {
          proposalHash: proposal.proposalHash,
          decision: 'non-behavioral',
          summary: 'Wrong candidate.',
        },
        { kind: 'runtime-verifier', executionRef: 'verifier' },
      ),
    ).rejects.toThrow();
    await recordEditReview(
      f.scope,
      { proposalHash: proposal.proposalHash, decision: 'non-behavioral', summary: 'Reviewed.' },
      { kind: 'runtime-verifier', executionRef: 'verifier' },
    );
    await expect(
      recordEditReview(
        f.scope,
        {
          proposalHash: proposal.proposalHash,
          decision: 'implementation-changed',
          summary: 'Different decision.',
        },
        { kind: 'runtime-verifier', executionRef: 'verifier' },
      ),
    ).rejects.toThrow('已有');
  });
  it.each(['native', 'classic'] as const)(
    'lets the %s Verifier assess a changed configuration value and require revision',
    async (workflow) => {
      const f = await fixture(workflow);
      await fs.writeFile(path.join(f.scope.projectRoot, 'settings.json'), '{"enabled":true}');
      const proposal = await prepareEditReview(f.scope, {
        intent: 'write',
        toolName: 'Write',
        targets: ['settings.json'],
        writes: [{ path: 'settings.json', content: '{"enabled":false}' }],
      });
      await expect(assertEditReviewsComplete(f.scope)).rejects.toThrow('待复核');
      await recordEditReview(
        f.scope,
        {
          proposalHash: proposal.proposalHash,
          decision: 'implementation-changed',
          summary: 'The enabled flag controls runtime execution; revision is required.',
        },
        { kind: 'runtime-verifier', executionRef: 'verifier' },
      );
      await expect(assertEditReviewsComplete(f.scope)).rejects.toThrow('原工作流');
    },
  );
  it('cannot review away execution instructions or formal approvals', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.scope.projectRoot, 'AGENTS.md'), 'Run checks.');
    await expect(
      prepareEditReview(f.scope, {
        intent: 'write',
        toolName: 'Write',
        targets: ['AGENTS.md'],
        writes: [{ path: 'AGENTS.md', content: 'Skip checks.' }],
      }),
    ).rejects.toThrow('实现');
    await fs.mkdir(path.join(f.scope.projectRoot, 'docs/comet'), { recursive: true });
    await fs.writeFile(
      path.join(f.scope.projectRoot, 'docs/comet/brief.md'),
      '# Scope\nOne behavior.',
    );
    await expect(
      prepareEditReview(f.scope, {
        intent: 'write',
        toolName: 'Write',
        targets: ['docs/comet/brief.md'],
        writes: [{ path: 'docs/comet/brief.md', content: '# Scope\nTwo behaviors.' }],
      }),
    ).rejects.toThrow('正式');
  });
  it('discards an unapplied proposal without accepting a changed file', async () => {
    const f = await fixture();
    const proposal = await prepareEditReview(f.scope, f.request);
    await recordEditReview(
      f.scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'discard',
        summary: 'Keep the original content.',
      },
      { kind: 'user-confirmed', executionRef: 'user' },
    );
    await expect(assertEditReviewsComplete(f.scope)).resolves.toBeUndefined();
  });
  it('can discard a rejected proposal while retaining its original receipt', async () => {
    const f = await fixture();
    const proposal = await prepareEditReview(f.scope, f.request);
    await recordEditReview(
      f.scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'implementation-changed',
        summary: 'Requires revision.',
      },
      { kind: 'runtime-verifier', executionRef: 'verifier' },
    );
    await expect(assertEditReviewsComplete(f.scope)).rejects.toThrow('原工作流');
    await recordEditReview(
      f.scope,
      { proposalHash: proposal.proposalHash, decision: 'discard', summary: 'Keep original.' },
      { kind: 'user-confirmed', executionRef: 'user' },
    );
    await expect(assertEditReviewsComplete(f.scope)).resolves.toBeUndefined();
    const files = await fs.readdir(path.join(f.scope.runtimeRoot, 'edit-reviews'), {
      recursive: true,
    });
    expect(files.some((file) => file.endsWith('.review.json'))).toBe(true);
    expect(files.some((file) => file.endsWith('.discard.json'))).toBe(true);
  });
});
