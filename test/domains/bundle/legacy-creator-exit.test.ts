import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readBundleAuthoringState,
  reconcileBundleAuthoringState,
  writeBundleAuthoringState,
} from '../../../domains/bundle/state.js';
import { reviewBundle, publishBundle } from '../../../domains/bundle/publish.js';
import { distributeBundle } from '../../../domains/bundle/distribute.js';
import type { BundleAuthoringState } from '../../../domains/bundle/types.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('legacy Creator exit', () => {
  it('refuses old state at every Bundle delivery entry without rewriting user files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-legacy-creator-'));
    temporary.push(root);
    const stateFile = path.join(root, '.comet', 'bundle-authoring', 'legacy.json');
    const draftPath = path.join(root, '.comet', 'bundle-drafts', 'legacy');
    const state = {
      schemaVersion: 1,
      name: 'legacy',
      mode: 'create',
      status: 'ready',
      draftPath,
      currentHash: 'a'.repeat(64),
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: true,
      factory: {
        goal: 'Preserve the original package',
        generatedSkillPackage: { packageRoot: draftPath },
      },
    };
    const original = JSON.stringify(state, null, 2) + '\n';
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.mkdir(draftPath, { recursive: true });
    await fs.writeFile(stateFile, original);
    await fs.writeFile(path.join(draftPath, 'SKILL.md'), '# User authored content\n');

    const operations = [
      () => readBundleAuthoringState(root, 'legacy'),
      () => reconcileBundleAuthoringState(root, 'legacy'),
      () => writeBundleAuthoringState(root, state as BundleAuthoringState),
      () =>
        reviewBundle({
          projectRoot: root,
          name: 'legacy',
          decision: 'approved',
          reviewer: 'human',
        }),
      () => publishBundle({ projectRoot: root, name: 'legacy', referencePlatform: 'codex' }),
      () =>
        distributeBundle({
          projectRoot: root,
          name: 'legacy',
          platforms: ['codex'],
          scope: 'project',
          preview: true,
        }),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toThrow('旧创作格式不再推进');
      expect(await fs.readFile(stateFile, 'utf8')).toBe(original);
      expect(await fs.readFile(path.join(draftPath, 'SKILL.md'), 'utf8')).toBe(
        '# User authored content\n',
      );
    }
    await expect(fs.access(path.join(root, '.codex'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not ship the retired generator and authoring modules', async () => {
    for (const file of [
      'domains/factory/package.ts',
      'domains/factory/artifacts.ts',
      'domains/factory/types.ts',
      'domains/bundle/factory.ts',
      'domains/bundle/factory-compose.ts',
      'domains/bundle/factory-plan.ts',
      'domains/bundle/factory-guide.ts',
      'domains/bundle/factory-proposal.ts',
      'domains/bundle/factory-resolve.ts',
      'domains/bundle/authoring.ts',
    ]) {
      await expect(fs.access(path.resolve(file))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
