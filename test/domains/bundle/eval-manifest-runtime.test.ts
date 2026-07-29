import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'yaml';
import { prepareEvalManifest } from '../../../domains/bundle/eval-manifest-runtime.js';
import { hashBundle } from '../../../domains/bundle/hash.js';
import { loadBundle } from '../../../domains/bundle/load.js';

const temporary: string[] = [];

async function createBundleFixture(options: { projectRoot?: string } = {}): Promise<{
  root: string;
  manifestPath: string;
}> {
  const projectRoot =
    options.projectRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-runtime-test-')));
  if (!options.projectRoot) temporary.push(projectRoot);
  const root = options.projectRoot
    ? path.join(projectRoot, '.comet', 'bundle-drafts', 'demo')
    : projectRoot;
  const manifestPath = path.join(root, 'skills', 'demo', 'comet', 'eval.yaml');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: eval-runtime
  version: 1.0.0
  description: Eval runtime fixture
  defaultLocale: zh
  locales: [zh]
skills:
  - id: demo
    path: skills/demo
    visibility: entry
platforms:
  requires: [skills]
  optional: []
engine:
  enabled: false
`,
  );
  await fs.writeFile(path.join(root, 'skills', 'demo', 'SKILL.md'), '# Demo\n');
  await fs.writeFile(
    manifestPath,
    `apiVersion: comet/v1alpha1
kind: SkillEvalManifest
metadata:
  name: demo
  draftHash: <current-bundle-hash>
skill:
  source: ..
`,
  );
  return { root, manifestPath };
}

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('prepareEvalManifest', () => {
  it('resolves the current Bundle hash without modifying the Factory manifest', async () => {
    const { root, manifestPath } = await createBundleFixture();

    const prepared = await prepareEvalManifest(manifestPath);
    temporary.push(path.dirname(prepared.path));
    const resolved = parse(await fs.readFile(prepared.path, 'utf8')) as {
      metadata: { draftHash: string };
      skill: { source: string };
    };

    expect(resolved.metadata.draftHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(resolved.skill.source).toBe(path.join(root, 'skills', 'demo'));
    expect(await fs.readFile(manifestPath, 'utf8')).toContain('draftHash: <current-bundle-hash>');
    expect(prepared.context).toBeUndefined();

    await prepared.cleanup();
  });

  it('returns Creator recording context only for the matching current authoring draft', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-project-test-'));
    temporary.push(projectRoot);
    const { root, manifestPath } = await createBundleFixture({ projectRoot });
    const manifestSource = await fs.readFile(manifestPath, 'utf8');
    const draftHash = await hashBundle(await loadBundle(root));
    const stateDir = path.join(projectRoot, '.comet', 'bundle-authoring');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, 'demo.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'demo',
        mode: 'create',
        status: 'draft',
        draftPath: root,
        currentHash: draftHash,
        candidates: [],
        defaultLocale: 'zh',
        locales: ['zh'],
        engineEnabled: false,
        factory: {
          generatedSkillPackage: {
            entrySkill: 'demo',
            internalSkills: [],
            packageRoot: path.join(root, 'skills', 'demo'),
            enginePath: null,
            evalManifestPath: manifestPath,
            controlPlane: {
              checksPath: null,
              evalManifestPath: manifestPath,
              compositionReportPath: path.join(root, 'composition-report.json'),
              scripts: [],
            },
          },
        },
      }),
    );

    const prepared = await prepareEvalManifest(manifestPath);
    temporary.push(path.dirname(prepared.path));

    expect(prepared.context).toEqual({
      projectRoot,
      name: 'demo',
      draftHash,
      evalManifestHash: createHash('sha256').update(manifestSource).digest('hex'),
      sourceManifestPath: manifestPath,
    });
    await prepared.cleanup();
  });

  it('does not attach Creator context when the authoring state points at a stale draft hash', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-project-test-'));
    temporary.push(projectRoot);
    const { root, manifestPath } = await createBundleFixture({ projectRoot });
    const stateDir = path.join(projectRoot, '.comet', 'bundle-authoring');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, 'demo.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'demo',
        mode: 'create',
        status: 'draft',
        draftPath: root,
        currentHash: 'f'.repeat(64),
        candidates: [],
        defaultLocale: 'zh',
        locales: ['zh'],
        engineEnabled: false,
        factory: {
          generatedSkillPackage: {
            entrySkill: 'demo',
            internalSkills: [],
            packageRoot: path.join(root, 'skills', 'demo'),
            enginePath: null,
            evalManifestPath: manifestPath,
          },
        },
      }),
    );

    const prepared = await prepareEvalManifest(manifestPath);
    temporary.push(path.dirname(prepared.path));

    expect(prepared.context).toBeUndefined();
    await prepared.cleanup();
  });

  it('returns the original absolute path for an already resolved hash', async () => {
    const { manifestPath } = await createBundleFixture();
    await fs.writeFile(
      manifestPath,
      (await fs.readFile(manifestPath, 'utf8')).replace('<current-bundle-hash>', 'a'.repeat(64)),
    );

    const prepared = await prepareEvalManifest(path.relative(process.cwd(), manifestPath));

    expect(prepared.path).toBe(manifestPath);
    await expect(prepared.cleanup()).resolves.toBeUndefined();
  });

  it('rejects the placeholder outside a Bundle', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-runtime-outside-'));
    temporary.push(root);
    const manifestPath = path.join(root, 'eval.yaml');
    await fs.writeFile(
      manifestPath,
      `kind: SkillEvalManifest
metadata:
  draftHash: <current-bundle-hash>
skill: {}
`,
    );

    await expect(prepareEvalManifest(manifestPath)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          `Cannot resolve <current-bundle-hash> for ${manifestPath}`,
        ),
      }),
    );
    await expect(prepareEvalManifest(manifestPath)).rejects.toThrow(
      'The placeholder only applies to a generated manifest still inside its Bundle draft',
    );
  });

  it('wraps Bundle loading failures with manifest context and the original cause', async () => {
    const { root, manifestPath } = await createBundleFixture();
    await fs.writeFile(path.join(root, 'bundle.yaml'), 'kind: NotABundle\n');

    const failure = await prepareEvalManifest(manifestPath).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      message: expect.stringContaining(`Cannot resolve <current-bundle-hash> for ${manifestPath}`),
      cause: expect.any(Error),
    });
    expect((failure as Error).message).toContain(
      'Fix the enclosing Bundle draft or replace the placeholder with a concrete draft hash',
    );
  });

  it('cleans up its temporary manifest idempotently', async () => {
    const { manifestPath } = await createBundleFixture();
    const prepared = await prepareEvalManifest(manifestPath);
    const temporaryRoot = path.dirname(prepared.path);

    await expect(prepared.cleanup()).resolves.toBeUndefined();
    await expect(prepared.cleanup()).resolves.toBeUndefined();
    await expect(fs.access(prepared.path)).rejects.toThrow();
    await expect(fs.access(temporaryRoot)).rejects.toThrow();
  });
});
