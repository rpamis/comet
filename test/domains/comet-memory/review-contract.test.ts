import { describe, expect, it } from 'vitest';

import {
  validateMemoryReviewActions,
  validateMemoryReviewPacket,
} from '../../../domains/comet-memory/index.js';

function packet(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'comet.memory.review.v1',
    language: 'zh-CN',
    projectIdentity: 'repo-a',
    projectKey: 'project-a',
    workflow: 'native',
    changeId: 'change-1',
    createdAt: '2026-08-14T00:00:00.000Z',
    checkpoint: 'verification.completed',
    userEvidence: ['提交前只暂存本次改动文件'],
    evidence: [
      {
        key: 'candidate:staging:change-1',
        scope: 'project',
        projectIdentity: 'repo-a',
        projectKey: 'project-a',
        candidateKey: 'staging',
        changeId: 'change-1',
        success: true,
        observedAt: '2026-08-14T00:00:00.000Z',
      },
    ],
    memories: [],
    budget: { maxActions: 4, maxEvidence: 8, maxBytes: 4096 },
    ...overrides,
  };
}

describe('semantic memory review contract', () => {
  it('validates a bounded packet and action set', () => {
    const validated = validateMemoryReviewPacket(packet());
    expect(
      validateMemoryReviewActions(validated, [
        {
          action: 'create',
          language: 'zh-CN',
          scope: 'project',
          projectKey: 'project-a',
          candidateKey: 'staging',
          category: '协作习惯',
          text: '提交前只暂存本次改动文件',
          evidenceKeys: ['candidate:staging:change-1'],
        },
      ]),
    ).toMatchObject({ schema: 'comet.memory.actions.v1', actions: [{ action: 'create' }] });
  });

  it('rejects invalid targets, mismatched language, unsafe content and oversized budgets', () => {
    const validated = validateMemoryReviewPacket(
      packet({
        memories: [
          {
            id: 'memory-1',
            scope: 'project',
            projectKey: 'project-a',
            category: '协作习惯',
            text: '提交前只暂存本次改动文件',
            kind: 'explicit',
            active: true,
          },
        ],
      }),
    );
    expect(() =>
      validateMemoryReviewActions(validated, [
        { action: 'forget', language: 'zh-CN', targetId: 'missing' },
      ]),
    ).toThrow('unknown target');
    expect(() =>
      validateMemoryReviewActions(validated, [
        {
          action: 'create',
          language: 'en',
          scope: 'project',
          projectKey: 'project-a',
          category: '偏好',
          text: '使用中文回复',
        },
      ]),
    ).toThrow('language');
    expect(() =>
      validateMemoryReviewActions(validated, [
        {
          action: 'create',
          language: 'zh-CN',
          scope: 'project',
          projectKey: 'project-a',
          category: '安全',
          text: 'password=secret-value',
        },
      ]),
    ).toThrow('unsafe');
    expect(() =>
      validateMemoryReviewPacket(
        packet({ budget: { maxActions: 100, maxEvidence: 8, maxBytes: 4096 } }),
      ),
    ).toThrow('budget');
  });

  it('accepts a skip action without changing memory state', () => {
    const validated = validateMemoryReviewPacket(packet());
    expect(
      validateMemoryReviewActions(validated, [
        { action: 'skip', language: 'zh-CN', reason: '没有长期可复用内容' },
      ]).actions[0],
    ).toEqual({
      action: 'skip',
      language: 'zh-CN',
      reason: '没有长期可复用内容',
      evidenceKeys: [],
    });
  });

  it('binds action targets and evidence to the packet context', () => {
    const validated = validateMemoryReviewPacket(
      packet({
        memories: [
          {
            id: 'memory-1',
            scope: 'project',
            projectKey: 'project-a',
            category: '协作习惯',
            text: '提交前只暂存本次改动文件',
            kind: 'explicit',
            active: true,
          },
        ],
      }),
    );
    expect(() =>
      validateMemoryReviewActions(validated, [
        {
          action: 'update',
          language: 'zh-CN',
          targetId: 'memory-1',
          scope: 'global',
          text: '提交前只暂存本次改动文件',
          evidenceKeys: ['candidate:staging:change-1'],
        },
      ]),
    ).toThrow('scope does not match');
    expect(() =>
      validateMemoryReviewActions(validated, [
        {
          action: 'create',
          language: 'zh-CN',
          scope: 'project',
          projectKey: 'project-a',
          candidateKey: 'other',
          category: '协作习惯',
          text: '提交前只暂存本次改动文件',
          evidenceKeys: ['candidate:staging:change-1'],
        },
      ]),
    ).toThrow('candidate does not match');
    expect(() =>
      validateMemoryReviewPacket(
        packet({
          evidence: [
            {
              key: 'future',
              scope: 'project',
              projectIdentity: 'repo-a',
              projectKey: 'project-a',
              changeId: 'change-1',
              success: true,
              observedAt: '2026-08-15T00:00:00.000Z',
            },
          ],
        }),
      ),
    ).toThrow('freshness window');
  });

  it('validates tags and rejects unsafe automatic content variants', () => {
    const validated = validateMemoryReviewPacket(packet());
    expect(() =>
      validateMemoryReviewActions(validated, [
        {
          action: 'create',
          language: 'zh-CN',
          scope: 'project',
          projectKey: 'project-a',
          category: '协作习惯',
          text: '提交前只暂存本次改动文件',
          tags: ['preference'],
        },
      ]),
    ).toThrow('tags');
    expect(() =>
      validateMemoryReviewActions(validated, [
        {
          action: 'create',
          language: 'zh-CN',
          scope: 'project',
          projectKey: 'project-a',
          category: '协作习惯',
          text: 'diff --git a/a.ts b/a.ts',
        },
      ]),
    ).toThrow('unsafe');
  });
});
