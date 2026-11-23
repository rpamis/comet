import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { ProjectKnowledgeLocalStore } from '../../domains/project-knowledge/local-store.js';
import { openProjectKnowledgeDatabase } from '../../domains/project-knowledge/sqlite.js';
import { defaultProjectKnowledgeStorageRoot } from '../../platform/paths/project-knowledge-storage.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

beforeAll(() => ensureCliBuilt(path.resolve('.')), 180_000);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const source = 'docs/comet/specs/recovery/spec.md';
const original =
  '# Recovery\n\n## Retry\nClear the cache before retry.\n\n## Display\nOld wording.\n';
const lesson = 'Clear the cache before retry to avoid stale state.';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-reference-'));
  roots.push(root);
  const project = path.join(root, 'project');
  const cacheRoot = defaultProjectKnowledgeStorageRoot(root);
  await fs.mkdir(path.dirname(path.join(project, source)), { recursive: true });
  await fs.mkdir(path.join(project, '.comet'));
  await fs.writeFile(path.join(project, source), original);
  await fs.writeFile(
    path.join(project, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: native\nworkflows: [native]\nnative:\n  artifact_root: docs\n',
  );
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [path.resolve('bin/comet.js'), ...args, '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        COMET_DATA_DIR: path.join(root, 'data'),
        COMET_DAEMON: 'off',
        HOME: root,
        USERPROFILE: root,
        LOCALAPPDATA: cacheRoot,
        XDG_CACHE_HOME: cacheRoot,
      },
      windowsHide: true,
      timeout: 15_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };
  const remember = (evidence = source) =>
    run(
      'knowledge',
      'remember',
      project,
      '--title',
      'Cache recovery',
      '--slug',
      'cache-recovery',
      '--text',
      lesson,
      '--evidence',
      evidence,
    );
  const expand = (target: string, id: string) =>
    run('task', target, '--task', 'Recover from stale cache', '--expand-context', id).expansion;
  return { root, project, cacheRoot, run, remember, expand };
}

it('expands legacy project memory after an unrelated source edit', async () => {
  const { project, remember, expand, run } = await fixture();
  const entry = remember();
  const raw = await fs.readFile(entry.file, 'utf8');
  const versions = JSON.stringify([
    {
      source,
      size: Buffer.byteLength(original),
      modifiedAt: 1,
      digest: createHash('sha256').update(original).digest('hex'),
    },
  ]);
  await fs.writeFile(
    entry.file,
    raw.replace(/^.*(?:evidence|sourceVersions):.*\n/m, () => `sourceVersions: ${versions}\n`),
  );
  await fs.writeFile(path.join(project, source), original.replace('Old wording.', 'New wording.'));
  expect(
    JSON.stringify(run('task', project, '--task', 'Recover from stale cache').context),
  ).toContain('cache-recovery');
  expect(expand(project, 'project-memory-index').content).toContain('cache-recovery');
  const content = expand(project, 'project-memory:cache-recovery').content;
  expect(content).toContain(lesson);
  expect(content).toContain(source);
  expect(remember().slug).toBe(entry.slug);
  expect(await fs.readFile(entry.file, 'utf8')).not.toContain('sourceVersions');
});

it('expands historical project memory with a missing source diagnostic', async () => {
  const { project, remember, expand } = await fixture();
  const entry = remember();
  expect(entry.entry).toHaveProperty('evidence', [source]);
  expect(entry.entry).not.toHaveProperty('sourceVersions');
  await fs.rename(path.join(project, source), path.join(project, 'moved.md'));
  const content = expand(project, 'project-memory:cache-recovery').content;
  expect(content).toContain(lesson);
  expect(content).toContain(source);
  expect(content).toMatch(/找不到来源|source not found/i);
  await fs.mkdir(path.join(project, source));
  expect(expand(project, 'project-memory:cache-recovery').content).toMatch(
    /来源无法访问|source unavailable/i,
  );
  expect(remember('moved.md')).toMatchObject({
    slug: entry.slug,
    action: 'updated',
    entry: { evidence: ['moved.md'] },
  });
  expect(expand(project, 'project-memory:cache-recovery').content).toContain('moved.md');
});

it('checks anchored memory evidence against its file and keeps the anchor in diagnostics', async () => {
  const { project, remember, expand } = await fixture();
  const evidence = `${source}#retry`;
  remember(evidence);
  const content = expand(project, 'project-memory:cache-recovery').content;
  expect(content).toContain(evidence);
  expect(content).not.toMatch(/找不到来源|source not found|来源无法访问|source unavailable/i);
  await fs.rename(path.join(project, source), path.join(project, 'moved.md'));
  const missing = expand(project, 'project-memory:cache-recovery').content;
  expect(missing).toMatch(/找不到来源|source not found/i);
  expect(missing).toContain(evidence);
});

it('expands shared knowledge after a worktree source edit without retiring it', async () => {
  const { root, project, cacheRoot, run, expand } = await fixture();
  const worktree = path.join(root, 'linked');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
  git('init', '--initial-branch=main');
  git('add', '.');
  git(
    '-c',
    'user.name=Comet Test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '-m',
    'Add recovery spec',
  );
  git('worktree', 'add', '--detach', worktree);
  const store = new ProjectKnowledgeLocalStore({ projectRoot: project, cacheRoot });
  const id = 'record-stale-cache-recovery';
  const record = {
    id,
    projectId: store.repositoryId,
    type: 'failure-resolution',
    state: 'proven',
    authority: 'automatic',
    title: 'Cache recovery',
    summary: lesson,
    applicablePaths: [],
    operations: [],
    conclusions: [{ text: lesson, sources: [{ source, anchor: 'retry' }] }],
    relations: [],
    verification: [],
    sourceVersions: [
      {
        source,
        size: Buffer.byteLength(original),
        modifiedAt: 1,
        digest: createHash('sha256').update(original).digest('hex'),
      },
    ],
    applicationCount: 3,
    successCount: 3,
    failureCount: 0,
    updatedAt: '2026-11-20T00:00:00Z',
  };
  store.close();
  const database = openProjectKnowledgeDatabase(store.databasePath);
  try {
    database
      .prepare(
        'INSERT INTO pk_records(id, project_id, type, state, authority, payload_json, source_versions_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        record.projectId,
        record.type,
        record.state,
        record.authority,
        JSON.stringify(record),
        JSON.stringify(record.sourceVersions),
        record.updatedAt,
      );
  } finally {
    database.close();
  }
  const contextId = `comet.project-knowledge::${id}`;
  expect(expand(project, contextId).content).toContain(lesson);
  const linkedSource = path.join(worktree, source);
  const linkedText = await fs.readFile(linkedSource, 'utf8');
  await fs.writeFile(linkedSource, linkedText.replace('Old wording.', 'New wording.'));
  expect(expand(worktree, contextId).content).toContain(lesson);
  expect(expand(project, contextId).content).toContain(lesson);
  expect(run('knowledge', 'get', project, '--id', id).result.record).toMatchObject({
    state: 'proven',
    successCount: 3,
    updatedAt: record.updatedAt,
  });
}, 30_000);
