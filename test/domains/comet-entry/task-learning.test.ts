import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

import {
  parseTaskLearningInput,
  submitTaskLearning,
} from '../../../domains/comet-entry/task-learning.js';
import {
  FileMemoryRepository,
  PersonalMemoryService,
} from '../../../domains/comet-memory/index.js';
import { readProjectMemoryEntries } from '../../../domains/project-knowledge/index.js';
import { ProjectKnowledgeHostReview } from '../../../domains/project-knowledge/index.js';
import { createDefaultCometPluginBridge } from '../../../domains/comet-plugin/comet.js';
import { resolveStableProjectId } from '../../../platform/paths/project-identity.js';
import { AGENT_EXPERIENCE_SCHEMA } from '../../../domains/agent-learning/index.js';

test('submits both learning owners once and verifies durable receipts on retry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-learning-'));
  const projectRoot = path.join(directory, 'project');
  const homeDirectory = path.join(directory, 'home');
  const cacheRoot = path.join(directory, 'cache');
  await fs.mkdir(projectRoot);
  await fs.writeFile(
    path.join(projectRoot, 'evidence.md'),
    '# Verified migration\n\nUse the current migration before release.\n',
  );
  const input = {
    schema: 'comet.task-learning.v1',
    personal: {
      check: 'submitted',
      observations: [
        {
          scope: 'project',
          category: '验收协作',
          text: '以后验收时优先运行聚焦测试。',
          phases: ['verify'],
          candidateKey: 'focused-verification',
          userEvidence: ['以后验收时优先运行聚焦测试。'],
        },
      ],
    },
    project: {
      check: 'submitted',
      memories: [
        {
          title: 'Migration before release',
          text: 'Use the verified migration before release.',
          evidence: ['evidence.md'],
        },
      ],
    },
  };
  try {
    const request = {
      projectRoot,
      homeDirectory,
      cacheRoot,
      workflow: 'native',
      change: 'learning-batch',
      input,
    };
    const first = await submitTaskLearning(request);
    expect(first).toMatchObject({
      status: 'applied',
      personalVerified: true,
      projectLearning: { submissionVerified: true },
      errors: [],
    });
    const retried = await submitTaskLearning(request);
    expect(retried).toMatchObject({
      status: 'applied',
      memorySlugs: first.memorySlugs,
      errors: [],
    });
    expect(await readProjectMemoryEntries(projectRoot, cacheRoot)).toHaveLength(1);
    const memories = new PersonalMemoryService({
      repository: new FileMemoryRepository(path.join(homeDirectory, '.comet/memory')),
    });
    const state = await memories.status();
    expect(state.counts.trial).toBe(1);
    await fs.writeFile(path.join(projectRoot, 'evidence.md'), '# Changed migration\n');
    const staleReceipt = await submitTaskLearning({
      ...request,
      input: {
        schema: input.schema,
        personal: { check: 'no-observation' },
        project: { check: 'submitted', memorySlugs: first.memorySlugs },
      },
    });
    expect(staleReceipt.projectLearning.submissionVerified).toBe(false);
    expect(staleReceipt.status).toBe('accepted');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('validates learning declarations and adoption evidence before applying the file', () => {
  const empty = {
    schema: 'comet.task-learning.v1',
    personal: { check: 'no-observation' },
    project: { check: 'no-observation' },
  };
  expect(parseTaskLearningInput(empty)).toEqual(empty);
  expect(() => parseTaskLearningInput({ ...empty, personal: {} })).toThrow(/check/);
  expect(() =>
    parseTaskLearningInput({
      ...empty,
      project: { check: 'no-observation', memories: [{ title: 'x', text: 'y' }] },
    }),
  ).toThrow(/submitted/);
  expect(() =>
    parseTaskLearningInput({
      ...empty,
      personal: {
        check: 'submitted',
        observations: [
          {
            scope: 'global',
            category: '偏好',
            text: '偏好',
            explicitRequest: { action: 'remember' },
          },
        ],
      },
    }),
  ).toThrow(/explicitRequest/);
  expect(() =>
    parseTaskLearningInput({
      ...empty,
      outcomes: [{ applicationId: 'application', outcome: 'used-successfully' }],
    }),
  ).toThrow(/验证证据/);
});

test('verifies an explicit empty learning check without inventing an observation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-learning-empty-'));
  try {
    const result = await submitTaskLearning({
      projectRoot: directory,
      homeDirectory: path.join(directory, 'home'),
      cacheRoot: path.join(directory, 'cache'),
      workflow: 'native',
      change: 'empty',
      input: {
        schema: 'comet.task-learning.v1',
        personal: { check: 'no-observation' },
        project: { check: 'no-observation' },
      },
    });
    expect(result).toMatchObject({
      status: 'applied',
      personalVerified: true,
      memorySlugs: [],
      projectLearning: { submissionVerified: true },
    });
    expect(await readProjectMemoryEntries(directory, path.join(directory, 'cache'))).toEqual([]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('binds a global observation receipt to the project where the task occurred', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-learning-global-'));
  try {
    const result = await submitTaskLearning({
      projectRoot: directory,
      homeDirectory: path.join(directory, 'home'),
      cacheRoot: path.join(directory, 'cache'),
      workflow: 'native',
      change: 'global-observation',
      input: {
        schema: 'comet.task-learning.v1',
        project: { check: 'no-observation' },
        personal: {
          check: 'submitted',
          observations: [
            {
              scope: 'global',
              memoryClass: 'user-preference',
              category: '沟通偏好',
              candidateKey: 'conclusion-first',
              text: '我在所有项目中都习惯先看结论，再看验证细节。',
              userEvidence: ['我在所有项目中都习惯先看结论，再看验证细节。'],
            },
          ],
        },
      },
    });
    expect(result, JSON.stringify(result)).toMatchObject({
      status: 'applied',
      personalVerified: true,
      errors: [],
    });
    expect(result.personalObservations[0]?.result).toBe('candidate-created');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('retains successful entries when one lesson fails and reports partial completion', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-learning-partial-'));
  try {
    const result = await submitTaskLearning({
      projectRoot: directory,
      homeDirectory: path.join(directory, 'home'),
      cacheRoot: path.join(directory, 'cache'),
      workflow: 'classic',
      change: 'partial',
      input: {
        schema: 'comet.task-learning.v1',
        personal: { check: 'no-observation' },
        project: {
          check: 'submitted',
          memories: [
            { title: 'Valid decision', text: 'The team confirmed this reusable decision.' },
            { title: 'Missing evidence', text: 'A source-bound lesson.', evidence: ['missing.md'] },
          ],
        },
      },
    });
    expect(result.status).toBe('partial');
    expect(result.memorySlugs).toHaveLength(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ section: 'project.memories', index: 1 }),
    ]);
    expect(await readProjectMemoryEntries(directory, path.join(directory, 'cache'))).toHaveLength(
      1,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('keeps project receipts available when the personal store is unavailable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-learning-unavailable-'));
  const homeDirectory = path.join(directory, 'home');
  await fs.mkdir(path.join(homeDirectory, '.comet'), { recursive: true });
  await fs.writeFile(path.join(homeDirectory, '.comet', 'memory'), 'Unavailable store');
  try {
    const result = await submitTaskLearning({
      projectRoot: directory,
      homeDirectory,
      cacheRoot: path.join(directory, 'cache'),
      workflow: 'native',
      change: 'unavailable',
      input: {
        schema: 'comet.task-learning.v1',
        personal: { check: 'no-observation' },
        project: {
          check: 'submitted',
          memories: [
            { title: 'Verified decision', text: 'A confirmed reusable project decision.' },
          ],
        },
      },
    });
    expect(result).toMatchObject({
      status: 'partial',
      personalVerified: false,
      projectLearning: { submissionVerified: true },
    });
    expect(result.errors).toEqual([expect.objectContaining({ section: 'personal.check' })]);
    expect(result.memorySlugs).toHaveLength(1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('submits the current pending review once and rejects a review from another change', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-learning-review-'));
  const homeDirectory = path.join(directory, 'home');
  const cacheRoot = path.join(directory, 'cache');
  const projectId = resolveStableProjectId(directory);
  await fs.writeFile(path.join(directory, 'retry.ts'), 'retry(1);');
  execFileSync(process.execPath, ['--check', 'retry.ts'], { cwd: directory, windowsHide: true });
  const bridge = await createDefaultCometPluginBridge({
    projectRoot: directory,
    projectId,
    homeDirectory,
    knowledgeCacheRoot: cacheRoot,
    scheduleLearning: (task) => task(),
  });
  try {
    await bridge.dispatchExperience({
      schema: AGENT_EXPERIENCE_SCHEMA,
      eventId: 'verification:review-batch',
      episodeId: 'review-batch',
      occurredAt: '2026-10-16T00:00:00.000Z',
      type: 'verification.completed',
      actor: 'workflow',
      scope: 'project',
      projectId,
      source: { kind: 'workflow', name: 'native', workflow: 'native', changeId: 'review-batch' },
      context: {
        workflow: 'native',
        changeId: 'review-batch',
        paths: ['retry.ts'],
        phase: 'verify',
      },
      evidence: [
        { id: 'source', kind: 'source', summary: 'Checked retry source', source: 'retry.ts' },
        {
          id: 'check',
          kind: 'verification',
          summary: 'Syntax check passed',
          command: 'node --check retry.ts',
          success: true,
        },
      ],
      outcome: { status: 'used-successfully' },
    });
    const review = new ProjectKnowledgeHostReview(directory, cacheRoot);
    const pending = await review.pending();
    expect(pending).toHaveLength(1);
    const input = {
      schema: 'comet.task-learning.v1',
      personal: { check: 'no-observation' },
      project: { check: 'no-observation', reviews: [{ id: pending[0].id, actions: [] }] },
    };
    const request = {
      projectRoot: directory,
      homeDirectory,
      cacheRoot,
      workflow: 'native',
      change: 'another-change',
      input,
    };
    const wrong = await submitTaskLearning(request);
    expect(wrong.status).toBe('partial');
    expect(wrong.errors[0]?.message).toMatch(/different change/);
    expect(await review.pending()).toHaveLength(1);
    const completed = await submitTaskLearning({ ...request, change: 'review-batch' });
    expect(completed).toMatchObject({
      status: 'applied',
      errors: [],
      projectLearning: {
        pendingReflectionCount: 0,
        pendingHostReviewCount: 0,
        submissionVerified: true,
      },
    });
    expect((await submitTaskLearning({ ...request, change: 'review-batch' })).status).toBe(
      'applied',
    );
    expect(await review.pending()).toHaveLength(0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('records verified adoption through the batch without counting a retry twice', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-learning-outcome-'));
  const homeDirectory = path.join(directory, 'home');
  const cacheRoot = path.join(directory, 'cache');
  const bridge = await createDefaultCometPluginBridge({
    projectRoot: directory,
    projectId: resolveStableProjectId(directory),
    homeDirectory,
    knowledgeCacheRoot: cacheRoot,
    scheduleLearning: (task) => task(),
  });
  try {
    const memory = await bridge.remember({
      scope: 'global',
      category: '验证偏好',
      text: '验证语法时先运行 node --check retry.ts。',
      phases: ['verify'],
    });
    const context = await bridge.collectContext({
      task: '验证语法',
      phase: 'verify',
      sessionId: 'verifier',
    });
    const application = context
      .flatMap((entry) => entry.applications)
      .find((entry) => entry.candidateId === memory?.id)!;
    await fs.writeFile(path.join(directory, 'retry.ts'), 'retry(1);');
    execFileSync(process.execPath, ['--check', 'retry.ts'], { cwd: directory, windowsHide: true });
    const request = {
      projectRoot: directory,
      homeDirectory,
      cacheRoot,
      workflow: 'native',
      change: 'adoption-batch',
      input: {
        schema: 'comet.task-learning.v1',
        personal: { check: 'no-observation' },
        project: { check: 'no-observation' },
        outcomes: [
          {
            applicationId: application.applicationId,
            outcome: 'used-successfully',
            evidence: {
              decision: 'Used the remembered syntax-check command.',
              verification: { command: 'node --check retry.ts', success: true },
            },
          },
        ],
      },
    };
    expect((await submitTaskLearning(request)).status).toBe('applied');
    expect((await submitTaskLearning(request)).status).toBe('applied');
    const memories = new PersonalMemoryService({
      repository: new FileMemoryRepository(path.join(homeDirectory, '.comet/memory')),
    });
    expect(await memories.get(memory!.id)).toMatchObject({ successCount: 1 });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
