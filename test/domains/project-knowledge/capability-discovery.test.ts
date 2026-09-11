import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  discoverWorkflowCapabilityCandidates,
  parseCapabilityAssociationDraft,
  renderCapabilityAssociationDraft,
  type WorkflowCapabilityDiscoveryScope,
} from '../../../domains/project-knowledge/capability-discovery.js';
import type {
  ProjectKnowledgeProvider,
  ProjectKnowledgeQueryResult,
  ProjectKnowledgeResult,
} from '../../../domains/project-knowledge/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function provider(results: readonly ProjectKnowledgeResult[]) {
  const query = vi.fn(async (): Promise<ProjectKnowledgeQueryResult> => ({
    kind: 'search',
    hits: [],
    results,
    records: [],
    truncated: false,
    diagnostics: [],
  }));
  return {
    query,
    provider: {
      status: async () => ({
        provider: 'local' as const,
        healthy: true,
        writable: true,
        diagnostics: [],
      }),
      query,
      apply: async () => ({ kind: 'refresh' as const, changed: false, diagnostics: [] }),
    } satisfies ProjectKnowledgeProvider,
  };
}

function sourceResult(
  root: string,
  source: string,
  kind: 'native-spec' | 'native-archive' | 'classic-spec' | 'classic-archive',
  content: string,
  score = 0.8,
): ProjectKnowledgeResult {
  return {
    source,
    title: 'Authentication',
    content,
    score,
    document: { absolutePath: path.join(root, ...source.split('/')), source, kind },
  };
}

function scope(workflow: 'native' | 'classic'): WorkflowCapabilityDiscoveryScope {
  return workflow === 'native'
    ? { workflow, currentSpecRoot: 'docs/comet/specs', archiveRoot: 'docs/comet/archive' }
    : {
        workflow,
        currentSpecRoot: 'docs/openspec/specs',
        archiveRoot: 'docs/openspec/changes/archive',
      };
}

describe('workflow capability discovery', () => {
  it('groups current and historical evidence, then creates a high-confidence draft', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-capability-discovery-'));
    roots.push(root);
    const current = path.join(root, 'docs/comet/specs/authentication/spec.md');
    await fs.mkdir(path.dirname(current), { recursive: true });
    await fs.writeFile(current, '# Authentication\n\nPassword and SMS login.\n', 'utf8');
    const found = provider([
      sourceResult(
        root,
        'docs/comet/specs/authentication/spec.md',
        'native-spec',
        'Password and SMS login.',
      ),
      sourceResult(
        root,
        'docs/comet/archive/2026-09-01-password-login/specs/authentication/spec.md',
        'native-archive',
        'Password login was introduced.',
      ),
    ]);

    const result = await discoverWorkflowCapabilityCandidates({
      projectRoot: root,
      scope: scope('native'),
      task: 'add SMS login to authentication',
      provider: found.provider,
    });

    expect(found.query).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      workflow: 'native',
      capability: 'authentication',
      confidence: 'high',
      currentSpec: {
        source: 'docs/comet/specs/authentication/spec.md',
        hash: createHash('sha256')
          .update('# Authentication\n\nPassword and SMS login.\n')
          .digest('hex'),
      },
    });
    expect(result.candidates[0].historicalSources).toEqual([
      'docs/comet/archive/2026-09-01-password-login/specs/authentication/spec.md',
    ]);
    expect(result.associationDraft).toMatchObject({
      status: 'suggested',
      capability: 'authentication',
      current_spec: 'docs/comet/specs/authentication/spec.md',
    });
    expect(renderCapabilityAssociationDraft(result.associationDraft!)).toContain(
      'schema: comet.capability-association.v1',
    );
  });

  it('does not associate a stale historical candidate and asks when current candidates are ambiguous', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-capability-discovery-'));
    roots.push(root);
    for (const capability of ['authentication', 'identity']) {
      const current = path.join(root, `docs/openspec/specs/${capability}/spec.md`);
      await fs.mkdir(path.dirname(current), { recursive: true });
      await fs.writeFile(current, `# ${capability}\n\nlogin behavior\n`, 'utf8');
    }
    const found = provider([
      sourceResult(
        root,
        'docs/openspec/changes/archive/2026-09-01-login/specs/removed/spec.md',
        'classic-archive',
        'login behavior',
      ),
      sourceResult(
        root,
        'docs/openspec/specs/authentication/spec.md',
        'classic-spec',
        'login behavior',
      ),
      sourceResult(root, 'docs/openspec/specs/identity/spec.md', 'classic-spec', 'login behavior'),
    ]);

    const result = await discoverWorkflowCapabilityCandidates({
      projectRoot: root,
      scope: scope('classic'),
      task: 'change login behavior',
      provider: found.provider,
    });

    expect(result.candidates.map((candidate) => candidate.capability)).toEqual([
      'authentication',
      'identity',
    ]);
    expect(result.candidates.every((candidate) => candidate.currentSpec.hash.length === 64)).toBe(
      true,
    );
    expect(result.associationDraft).toBeNull();
  });

  it('uses direct validation for an explicit capability without querying the provider', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-capability-discovery-'));
    roots.push(root);
    const current = path.join(root, 'docs/comet/specs/authentication/spec.md');
    await fs.mkdir(path.dirname(current), { recursive: true });
    await fs.writeFile(current, 'authentication\n', 'utf8');
    const result = await discoverWorkflowCapabilityCandidates({
      projectRoot: root,
      scope: scope('native'),
      capability: 'authentication',
    });

    expect(result.associationDraft).toMatchObject({
      status: 'explicit',
      capability: 'authentication',
    });
  });

  it('validates an association draft before it is persisted as a workflow artifact', async () => {
    const draft = parseCapabilityAssociationDraft({
      schema: 'comet.capability-association.v1',
      status: 'suggested',
      workflow: 'native',
      capability: 'authentication',
      current_spec: 'docs/comet/specs/authentication/spec.md',
      current_hash: 'a'.repeat(64),
      confidence: 'high',
      reason: '当前总 Spec 与历史 change 均命中。',
      historical_sources: ['docs/comet/archive/2026-09-01-login/specs/authentication/spec.md'],
      evidence: [
        {
          source: 'docs/comet/specs/authentication/spec.md',
          kind: 'native-spec',
        },
      ],
    });

    expect(draft).toMatchObject({
      workflow: 'native',
      capability: 'authentication',
      current_hash: 'a'.repeat(64),
    });
    expect(() =>
      parseCapabilityAssociationDraft({
        ...draft,
        current_spec: '../outside/spec.md',
      }),
    ).toThrow('project-relative path');
  });
});
