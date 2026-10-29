import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  prepareEditReview,
  prepareObservedEditReview,
  recordEditReview,
  inspectEditReviews,
  assertEditReviewsComplete,
  approvedEditFingerprint,
  claimedEditReviewAuthority,
  claimedAgentEditReviewAuthority,
  rememberApprovedEditOriginal,
  readApprovedEditOriginal,
  supersedeStaleAppliedEditReviews,
  isCheckInputRetained,
  areObservedEditsNonBehavioral,
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
  it('allows an applied current-Agent implementation decision only for revision and never treats it as equivalent accepted content', async () => {
    const f = await fixture();
    const scope = { ...f.scope, judgment: 'agent' as const };
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    const before = 'value = 1\n',
      after = 'value = 2\n';
    await fs.writeFile(path.join(scope.projectRoot, 'worker.py'), after);
    const changes = [{ path: 'worker.py', beforeHash: digest(before), afterHash: digest(after) }];
    const proposal = await prepareObservedEditReview(scope, changes);
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'implementation-changed',
        summary: 'Only the authorized left implementation changes; check B is unaffected.',
        retainedCheckActionIds: ['B'],
      },
      { kind: 'runtime-agent', executionRef: 'current-agent' },
    );
    await expect(assertEditReviewsComplete(scope)).rejects.toThrow('implementation-changed');
    await expect(
      assertEditReviewsComplete(scope, { allowImplementationRevision: true }),
    ).resolves.toBeUndefined();
    expect(await areObservedEditsNonBehavioral([scope], changes)).toBe(false);
    expect(await isCheckInputRetained(scope, 'B', changes)).toBe(true);
    await fs.writeFile(path.join(scope.projectRoot, 'worker.py'), 'value = 3\n');
    await expect(
      assertEditReviewsComplete(scope, { allowImplementationRevision: true }),
    ).rejects.toThrow('不匹配');
    const nextScope = { ...scope, candidateKey: 'next-candidate' };
    const next = await prepareObservedEditReview(nextScope, [
      { path: 'worker.py', beforeHash: digest(after), afterHash: digest('value = 3\n') },
    ]);
    await recordEditReview(
      nextScope,
      {
        proposalHash: next.proposalHash,
        decision: 'requirements-changed',
        summary: 'The next request exceeds existing approval.',
      },
      { kind: 'runtime-agent', executionRef: 'current-agent' },
    );
    await expect(
      assertEditReviewsComplete(nextScope, { allowImplementationRevision: true }),
    ).rejects.toThrow('requirements-changed');
  });
  it('keeps unaffected source judgments while a new approval retires only the corresponding formal edits', async () => {
    const f = await fixture('classic');
    const scope = {
      ...f.scope,
      judgment: 'agent' as const,
      approvedSources: { 'worker.py': 'a'.repeat(64), 'plan.unknown': 'b'.repeat(64) },
    };
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    const before = 'value = 1\n',
      after = '# Explanation\nvalue = 1\n';
    await fs.writeFile(path.join(scope.projectRoot, 'worker.py'), after);
    await fs.writeFile(path.join(scope.projectRoot, 'plan.unknown'), after);
    const changes = ['worker.py', 'plan.unknown'].map((ref) => ({
      path: ref,
      beforeHash: digest(before),
      afterHash: digest(after),
    }));
    const proposal = await prepareObservedEditReview(scope, changes);
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'non-behavioral',
        summary: 'Both explanations preserve their respective approved requirements.',
        retainedCheckActionIds: ['original-check'],
      },
      { kind: 'runtime-agent', executionRef: 'current-agent' },
    );
    const next = {
      ...scope,
      approvedSources: { ...scope.approvedSources, 'plan.unknown': 'c'.repeat(64) },
    };
    await assertEditReviewsComplete(next);
    expect(await areObservedEditsNonBehavioral([next], [changes[0]])).toBe(true);
    expect(await areObservedEditsNonBehavioral([next], [changes[1]])).toBe(false);
    expect(await isCheckInputRetained(next, 'original-check', [changes[0]])).toBe(true);
    expect(await isCheckInputRetained(next, 'original-check', [changes[1]])).toBe(false);
    expect((await inspectEditReviews(next))[0].edits).toEqual(proposal.edits);
    expect((await inspectEditReviews(next))[0].proposalHash).toBe(proposal.proposalHash);
    await expect(
      recordEditReview(
        next,
        {
          proposalHash: proposal.proposalHash,
          decision: 'non-behavioral',
          summary: 'Cannot reuse the old proposal for a newly approved plan.',
        },
        { kind: 'runtime-agent', executionRef: 'current-agent' },
      ),
    ).rejects.toThrow('批准已变化');
  });

  it('does not keep an old negative decision active after the same bytes receive a new source approval', async () => {
    const f = await fixture('classic');
    const scope = {
      ...f.scope,
      judgment: 'agent' as const,
      approvedSources: { 'worker.py': 'a'.repeat(64) },
    };
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    await fs.writeFile(path.join(scope.projectRoot, 'worker.py'), 'new requirement');
    const proposal = await prepareObservedEditReview(scope, [
      {
        path: 'worker.py',
        beforeHash: digest('value = 1\n'),
        afterHash: digest('new requirement'),
      },
    ]);
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'requirements-changed',
        summary: 'The changed requirement needs a new decision.',
      },
      { kind: 'runtime-agent', executionRef: 'current-agent' },
    );
    await expect(assertEditReviewsComplete(scope)).rejects.toThrow('requirements-changed');
    const accepted = { ...scope, approvedSources: { 'worker.py': 'b'.repeat(64) } };
    await assertEditReviewsComplete(accepted);
    expect(
      await editReviewContinuation(accepted, await inspectEditReviews(accepted), true),
    ).toBeNull();
    await expect(
      claimEditReview(accepted, {
        sessionId: 'current-agent',
        builderExecutionRef: 'original-builder',
        proposalHash: proposal.proposalHash,
      }),
    ).rejects.toThrow('批准来源已变化');
    expect((await inspectEditReviews(accepted))[0].receipt?.decision).toBe('requirements-changed');
    expect((await inspectEditReviews(accepted))[0].edits).toEqual(proposal.edits);
    await expect(
      prepareObservedEditReview({ ...accepted, approvedSources: {} }, [
        {
          path: 'worker.py',
          beforeHash: digest('value = 1\n'),
          afterHash: digest('new requirement'),
        },
      ]),
    ).rejects.toThrow('没有当前适用的批准来源');
  });

  it('batches raw binary, added and deleted files and rejects edits after observation', async () => {
    const f = await fixture();
    const scope = { ...f.scope, judgment: 'agent' as const };
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const original = Buffer.from([0, 255, 128]);
    await fs.writeFile(path.join(scope.projectRoot, 'opaque.bin'), original);
    await fs.writeFile(path.join(scope.projectRoot, 'removed.unknown'), original);
    for (let save = 0; save < 10; save++)
      await fs.writeFile(path.join(scope.projectRoot, 'opaque.bin'), Buffer.from([0, 255, save]));
    const current = Buffer.from([0, 255, 9]);
    await fs.writeFile(path.join(scope.projectRoot, 'added.unknown'), current);
    await fs.unlink(path.join(scope.projectRoot, 'removed.unknown'));
    const changes = [
      {
        path: 'opaque.bin',
        beforeHash: digest(original),
        afterHash: digest(current),
        beforeMode: '100644',
        afterMode: '100644',
      },
      {
        path: 'added.unknown',
        beforeHash: 'missing',
        afterHash: digest(current),
        beforeMode: 'missing',
        afterMode: '100644',
      },
      {
        path: 'removed.unknown',
        beforeHash: digest(original),
        afterHash: 'missing',
        beforeMode: '100644',
        afterMode: 'missing',
      },
    ];
    const proposal = await prepareObservedEditReview(scope, changes);
    expect((await prepareObservedEditReview(scope, changes)).proposalHash).toBe(
      proposal.proposalHash,
    );
    const result = {
      proposalHash: proposal.proposalHash,
      decision: 'non-behavioral' as const,
      summary:
        'These raw assets are outside the selected command; the current Agent retains that check.',
      retainedChecks: [{ actionId: 'batch', checkId: 'unaffected' }],
    };
    await recordEditReview(scope, result, { kind: 'runtime-agent', executionRef: 'current-agent' });
    expect(await isCheckInputRetained(scope, 'batch', changes, [], 'unaffected')).toBe(true);
    expect(await isCheckInputRetained(scope, 'batch', changes, [], 'affected')).toBe(false);
    await assertEditReviewsComplete(scope);
    expect(await inspectEditReviews(scope)).toHaveLength(1);
    await fs.writeFile(path.join(scope.projectRoot, 'opaque.bin'), original);
    await expect(
      recordEditReview(scope, result, { kind: 'runtime-agent', executionRef: 'current-agent' }),
    ).rejects.toThrow(/再次变化/);
    await expect(prepareObservedEditReview(scope, changes)).rejects.toThrow(/再次变化/);
    expect(await fs.readFile(path.join(scope.projectRoot, 'opaque.bin'))).toEqual(original);
  });
  it('retains only explicitly selected checks for exactly covered raw input changes', async () => {
    const f = await fixture();
    const scope = { ...f.scope, judgment: 'agent' as const };
    const proposal = await prepareEditReview(scope, f.request);
    const before = 'value = 1\n',
      after = '# Explain the value.\nvalue = 1\n';
    const digest = (source: string) => createHash('sha256').update(source).digest('hex');
    const changes = [{ path: 'worker.py', beforeHash: digest(before), afterHash: digest(after) }];
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'non-behavioral',
        summary: 'Check B is unaffected; check A still needs execution.',
        retainedCheckActionIds: ['check-B'],
        retainedChecks: [{ actionId: 'check-batch', checkId: 'B' }],
      },
      { kind: 'runtime-agent', executionRef: 'run:4/1/builder' },
    );
    expect(await isCheckInputRetained(scope, 'check-B', changes)).toBe(true);
    expect(
      await isCheckInputRetained({ ...scope, candidateKey: 'later-context' }, 'check-B', changes),
    ).toBe(true);
    const blob = `git:${createHash('sha1')
      .update(`blob ${Buffer.byteLength(before)}\0`)
      .update(before)
      .digest('hex')}`;
    expect(
      await isCheckInputRetained(scope, 'check-B', [{ ...changes[0], beforeHash: blob }]),
    ).toBe(true);
    expect(await isCheckInputRetained(scope, 'check-A', changes)).toBe(false);
    expect(await isCheckInputRetained(scope, 'check-batch', changes, [], 'B')).toBe(true);
    expect(await isCheckInputRetained(scope, 'check-batch', changes, [], 'A')).toBe(false);
    expect(await isCheckInputRetained(scope, 'check-batch', changes)).toBe(false);
    expect(
      await isCheckInputRetained(scope, 'check-B', [
        ...changes,
        { path: 'other.unknown', beforeHash: 'old', afterHash: 'new' },
      ]),
    ).toBe(false);
    expect(
      await isCheckInputRetained(scope, 'check-B', [
        { ...changes[0], afterHash: digest(after + 'another edit') },
      ]),
    ).toBe(false);
    expect(await isCheckInputRetained(scope, 'check-B', [])).toBe(false);
    expect(await isCheckInputRetained({ ...scope, change: 'other' }, 'check-B', changes)).toBe(
      false,
    );
  });
  it('supersedes only stale applied judgments and rejects a result for reverted content', async () => {
    const f = await fixture();
    const scope = { ...f.scope, judgment: 'agent' as const };
    const original = 'value = 1\n';
    const after = '# Explanation\nvalue = 1\n';
    const request = {
      intent: 'write' as const,
      toolName: 'Write',
      targets: ['worker.py'],
      writes: [{ path: 'worker.py', content: after }],
    };
    await fs.writeFile(path.join(scope.projectRoot, 'worker.py'), after);
    const first = await prepareEditReview(scope, request, new Map([['worker.py', original]]));
    await fs.writeFile(path.join(scope.projectRoot, 'worker.py'), original);
    await expect(
      recordEditReview(
        scope,
        {
          proposalHash: first.proposalHash,
          decision: 'non-behavioral',
          summary: 'Stale observation',
        },
        { kind: 'runtime-agent', executionRef: 'run:4/1/builder' },
      ),
    ).rejects.toThrow('再次变化');
    await supersedeStaleAppliedEditReviews(scope);
    expect((await inspectEditReviews(scope))[0].receipt?.authority.kind).toBe('runtime-superseded');
    expect(await fs.readFile(path.join(scope.projectRoot, 'worker.py'), 'utf8')).toBe(original);
  });
  it('retains exact approved originals without language normalization or compiler support', async () => {
    const f = await fixture();
    const source = '# 说明\r\nunknown syntax ???\r\n';
    const hash = createHash('sha256').update(source).digest('hex');
    await rememberApprovedEditOriginal(f.scope, 'design.unknown', source, hash);
    await expect(readApprovedEditOriginal(f.scope, 'design.unknown', hash)).resolves.toBe(source);
    await rememberApprovedEditOriginal(f.scope, 'design.unknown', source, hash);
    await expect(
      rememberApprovedEditOriginal(f.scope, 'design.unknown', source + 'edit', hash),
    ).rejects.toThrow('摘要');
    await expect(
      readApprovedEditOriginal({ ...f.scope, change: 'other' }, 'design.unknown', hash),
    ).rejects.toThrow();
  });
  it('uses the current Agent claim without creating another review session', () => {
    const claim = {
      actionId: 'run:4',
      attempt: 1,
      inputHash: 'input',
      claimToken: 'token',
      sessionId: 'builder',
    };
    const actions = [
      {
        id: 'run:4',
        stepId: 'build.builder',
        attempt: 1,
        inputHash: 'input',
        status: 'running',
        claim: { token: 'token', sessionId: 'builder' },
      },
    ];
    expect(claimedAgentEditReviewAuthority(actions, ['build.builder'], claim)).toEqual({
      kind: 'runtime-agent',
      executionRef: 'run:4/1/builder',
    });
    for (const invalid of [
      { ...claim, claimToken: 'old' },
      { ...claim, sessionId: 'other' },
      { ...claim, attempt: 2 },
      { ...claim, inputHash: 'old' },
    ])
      expect(() => claimedAgentEditReviewAuthority(actions, ['build.builder'], invalid)).toThrow();
    expect(() => claimedAgentEditReviewAuthority(actions, ['verify.verifier'], claim)).toThrow();
    expect(() =>
      claimedAgentEditReviewAuthority(
        [{ ...actions[0], status: 'succeeded' }],
        ['build.builder'],
        claim,
      ),
    ).toThrow();
  });

  it.each(['worker.py', 'worker.ts', 'document.unknown', 'AGENTS.md'])(
    'records raw edits for current Agent judgment in %s',
    async (file) => {
      const f = await fixture();
      await fs.writeFile(path.join(f.scope.projectRoot, file), 'value = 1\n');
      const request = {
        ...f.request,
        targets: [file],
        writes: f.request.writes.map((write) => ({ ...write, path: file })),
      };
      const scope = { ...f.scope, judgment: 'agent' as const };
      const proposal = await prepareEditReview(scope, request);
      expect(proposal.judgment).toBe('agent');
      expect(proposal.edits[0].beforeFingerprint).toBeNull();
      expect(proposal.edits[0].beforeInputHash).toMatch(/^[a-f0-9]{64}$/);
      const continuation = await editReviewContinuation(
        scope,
        await inspectEditReviews(scope),
        true,
      );
      expect(continuation?.commandArgs).toContain('record');
      expect(continuation?.commandArgs).not.toContain('claim');
      expect(
        (await editReviewContinuation(f.scope, await inspectEditReviews(f.scope), true))
          ?.commandArgs,
      ).toContain('record');
      const receipt = await recordEditReview(
        scope,
        {
          proposalHash: proposal.proposalHash,
          decision: 'non-behavioral',
          summary: '当前Agent核对实际使用方，只有说明变化。',
        },
        { kind: 'runtime-agent', executionRef: 'run:4/1/builder' },
      );
      expect((await inspectEditReviews(scope))[0].receipt).toEqual(receipt);
      await fs.writeFile(path.join(f.scope.projectRoot, file), 'value = 2\n');
      await expect(
        recordEditReview(
          scope,
          {
            proposalHash: proposal.proposalHash,
            decision: 'non-behavioral',
            summary: '旧判断',
          },
          { kind: 'runtime-agent', executionRef: 'run:4/1/builder' },
        ),
      ).rejects.toThrow('不匹配');
    },
  );
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
