import { describe, expect, test } from 'vitest';

import {
  createUserProjectKnowledgeRecord,
  mergeProjectKnowledgeRecord,
  parseProjectKnowledgeRecord,
  type ProjectKnowledgeRecord,
} from '../../../domains/project-knowledge/records.js';

function sampleRecord(): ProjectKnowledgeRecord {
  return {
    id: 'record-main-flow',
    projectId: 'comet-core',
    type: 'dependency',
    state: 'proven',
    authority: 'automatic',
    title: '主流程模块',
    summary: '主流程负责协调入口与验证。',
    applicablePaths: ['domains/project-knowledge/'],
    operations: ['implement', 'verify'],
    phases: [],
    conclusions: [
      {
        text: '修改入口后必须同步验证 Provider 契约。',
        sources: [{ source: 'domains/project-knowledge/types.ts', anchor: 'provider-contract' }],
      },
    ],
    relations: [
      {
        type: 'validated-by',
        targetId: 'record-build-test',
        sources: [{ source: 'package.json', anchor: 'scripts' }],
      },
    ],
    verification: [{ command: 'npx vitest run test/domains/project-knowledge/*.test.ts' }],
    sourceVersions: [
      {
        source: 'domains/project-knowledge/types.ts',
        size: 2048,
        modifiedAt: 1_723_456_789_000,
      },
    ],
    applicationCount: 0,
    successCount: 0,
    failureCount: 0,
    updatedAt: '2026-08-22T09:00:00.000Z',
  };
}

describe('project knowledge records', () => {
  test('creates a user record from structured input and preserves optional evidence', () => {
    const record = createUserProjectKnowledgeRecord(
      {
        type: 'pattern',
        title: '构建约定',
        summary: '修改后先运行定向测试。',
        applicablePaths: ['domains/'],
        operations: ['verify'],
        sources: [{ source: 'docs/rules.md', anchor: 'focused-tests' }],
        verification: [{ command: 'pnpm test --filter project-knowledge' }],
      },
      'comet-core',
      '2026-08-23T10:00:00.000Z',
      'manual-build-convention',
    );

    expect(record).toMatchObject({
      id: 'manual-build-convention',
      projectId: 'comet-core',
      type: 'pattern',
      state: 'proven',
      authority: 'user',
      title: '构建约定',
      summary: '修改后先运行定向测试。',
      applicablePaths: ['domains/'],
      operations: ['verify'],
      conclusions: [
        {
          text: '修改后先运行定向测试。',
          sources: [{ source: 'docs/rules.md', anchor: 'focused-tests' }],
        },
      ],
      verification: [{ command: 'pnpm test --filter project-knowledge' }],
      sourceVersions: [],
      updatedAt: '2026-08-23T10:00:00.000Z',
    });
  });

  test('parses a valid record without losing bounded data', () => {
    const record = sampleRecord();

    const parsed = parseProjectKnowledgeRecord(JSON.parse(JSON.stringify(record)));

    expect(parsed).toEqual(record);
  });

  test('rejects invalid state, authority, and empty required text', () => {
    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        state: 'draft',
      }),
    ).toThrow(/state/i);

    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        authority: 'generated',
      }),
    ).toThrow(/authority/i);

    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        title: '   ',
      }),
    ).toThrow(/title/i);
  });

  test('keeps user summary and conclusions when an automatic upsert is merged', () => {
    const current = parseProjectKnowledgeRecord({
      ...sampleRecord(),
      authority: 'user',
      summary: '用户维护的摘要',
      conclusions: [
        {
          text: '用户维护的结论',
          sources: [{ source: 'docs/knowledge.md', anchor: 'manual' }],
        },
      ],
    });
    const incoming = parseProjectKnowledgeRecord({
      ...sampleRecord(),
      summary: '自动生成的新摘要',
      conclusions: [
        {
          text: '自动生成的新结论',
          sources: [{ source: 'domains/project-knowledge/records.ts', anchor: 'merge' }],
        },
      ],
      updatedAt: '2026-08-22T10:00:00.000Z',
    });

    const merged = mergeProjectKnowledgeRecord(current, incoming);

    expect(merged.authority).toBe('user');
    expect(merged.summary).toBe('用户维护的摘要');
    expect(merged.conclusions).toEqual(current.conclusions);
    expect(merged.updatedAt).toBe('2026-08-22T10:00:00.000Z');
  });

  test('accepts changed automatic evidence after a record was superseded', () => {
    const current = parseProjectKnowledgeRecord({
      ...sampleRecord(),
      state: 'superseded',
      authority: 'user',
      summary: '已退役的用户摘要',
    });
    const incoming = parseProjectKnowledgeRecord({
      ...sampleRecord(),
      summary: '新来源版本的自动摘要',
      sourceVersions: [{ source: 'docs/new-source.md', size: 4, modifiedAt: 2 }],
    });

    expect(mergeProjectKnowledgeRecord(current, incoming)).toMatchObject({
      authority: 'automatic',
      state: 'proven',
      summary: '新来源版本的自动摘要',
    });
  });

  test('rejects unsafe ids, excessive references, and malformed source versions', () => {
    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        id: '../escape',
      }),
    ).toThrow(/id/i);

    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        conclusions: [
          {
            text: 'too many sources',
            sources: Array.from({ length: 33 }, (_, index) => ({
              source: `docs/source-${index}.md`,
            })),
          },
        ],
      }),
    ).toThrow(/sources/i);

    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        sourceVersions: [
          {
            source: '/absolute/path.md',
            size: -1,
            modifiedAt: 'yesterday',
          },
        ],
      }),
    ).toThrow(/sourceVersions/i);
  });

  test('rejects conclusions and relations with missing or empty sources', () => {
    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        conclusions: [
          {
            text: 'missing sources',
          },
        ],
      }),
    ).toThrow(/conclusions\[0\]\.sources/i);

    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        conclusions: [
          {
            text: 'empty sources',
            sources: [],
          },
        ],
      }),
    ).toThrow(/conclusions\[0\]\.sources/i);

    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        relations: [
          {
            type: 'validated-by',
            targetId: 'record-build-test',
          },
        ],
      }),
    ).toThrow(/relations\[0\]\.sources/i);

    expect(() =>
      parseProjectKnowledgeRecord({
        ...sampleRecord(),
        relations: [
          {
            type: 'validated-by',
            targetId: 'record-build-test',
            sources: [],
          },
        ],
      }),
    ).toThrow(/relations\[0\]\.sources/i);
  });
});
