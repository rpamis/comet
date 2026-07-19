import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { annotatedMarkdown } from '../../../domains/comet-classic/classic-archive.js';
import { readRunState } from '../../../domains/engine/state.js';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const scriptByCommand: Record<string, string> = {
  archive: path.join(scriptsDir, 'comet-archive.mjs'),
  state: path.join(scriptsDir, 'comet-state.mjs'),
};
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

function run(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const [command, ...rest] = args;
  return spawnSync(process.execPath, [scriptByCommand[command], ...rest], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-archive-'));
  temporary.push(dir);
  return dir;
}

async function seedArchiveChange(dir: string): Promise<string> {
  run(dir, ['state', 'init', 'demo', 'full']);
  // Direct phase writes are normally blocked; the force hatch is the documented
  // way for tooling/tests to seed a change into the archive phase.
  run(dir, ['state', 'set', 'demo', 'phase', 'archive'], { COMET_FORCE_PHASE: '1' });
  run(dir, ['state', 'set', 'demo', 'verify_result', 'pass']);
  return path.join(dir, 'openspec', 'changes', 'demo');
}

function confirmArchiveChange(dir: string): void {
  const result = run(dir, ['state', 'transition', 'demo', 'archive-confirm']);
  expect(result.status).toBe(0);
}

describe('annotatedMarkdown', () => {
  it('preserves an existing frontmatter document with one final newline', () => {
    const original = '---\ntitle: Demo\n---\nBody\n';

    expect(annotatedMarkdown(original, '2026-07-11-demo', '')).toBe(
      '---\ntitle: Demo\narchived-with: 2026-07-11-demo\n---\nBody\n',
    );
  });

  it('preserves blank and comment lines when no extra frontmatter field is replaced', () => {
    const original = '---\ntitle: Demo\n\n# keep this context\n---\nBody\n';

    expect(annotatedMarkdown(original, '2026-07-11-demo', '')).toBe(
      '---\ntitle: Demo\n\n# keep this context\narchived-with: 2026-07-11-demo\n---\nBody\n',
    );
  });

  it('collapses multiple EOF blank lines to exactly one final newline', () => {
    const original = '---\ntitle: Demo\n---\nBody\n\n\n';

    expect(annotatedMarkdown(original, '2026-07-11-demo', '')).toBe(
      '---\ntitle: Demo\narchived-with: 2026-07-11-demo\n---\nBody\n',
    );
  });

  it('adds frontmatter to a document without frontmatter or a final newline', () => {
    expect(annotatedMarkdown('Body', '2026-07-11-demo', '')).toBe(
      '---\narchived-with: 2026-07-11-demo\nstatus: final\n---\nBody\n',
    );
  });

  it('preserves internal blank lines and normalizes CRLF to LF', () => {
    const original = '---\r\ntitle: Demo\r\n---\r\nFirst\r\n\r\nSecond\r\n';

    expect(annotatedMarkdown(original, '2026-07-11-demo', '')).toBe(
      '---\ntitle: Demo\narchived-with: 2026-07-11-demo\n---\nFirst\n\nSecond\n',
    );
  });

  it('does not annotate a later thematic delimiter in the body', () => {
    const original = '---\ntitle: Demo\n---\nBefore\n---\nAfter\n';

    expect(annotatedMarkdown(original, '2026-07-11-demo', '')).toBe(
      '---\ntitle: Demo\narchived-with: 2026-07-11-demo\n---\nBefore\n---\nAfter\n',
    );
  });

  it('replaces existing archive and extra fields without duplication', () => {
    const original =
      '---\narchived-with: old-archive\ntitle: Demo\nstatus: draft\narchived-with: older-archive\nstatus: review\n---\nBody\n';

    expect(annotatedMarkdown(original, '2026-07-11-demo', 'status: final')).toBe(
      '---\ntitle: Demo\narchived-with: 2026-07-11-demo\nstatus: final\n---\nBody\n',
    );
  });

  it('is byte-identical when repeated with the same inputs', () => {
    const original = '---\r\ntitle: Demo\r\nstatus: draft\r\n---\r\nBody\r\n\r\n';
    const once = annotatedMarkdown(original, '2026-07-11-demo', 'status: final');

    expect(annotatedMarkdown(once, '2026-07-11-demo', 'status: final')).toBe(once);
  });
});

async function fakeOpenSpec(
  dir: string,
  mode: 'success' | 'fail' | 'move-fail',
): Promise<{ command: string; log: string }> {
  const script = path.join(dir, 'fake-openspec.mjs');
  const log = path.join(dir, 'fake-openspec.log');
  await fs.writeFile(
    script,
    [
      "import { promises as fs } from 'fs';",
      "import path from 'path';",
      `const mode = ${JSON.stringify(mode)};`,
      `const log = ${JSON.stringify(log)};`,
      "await fs.appendFile(log, process.argv.slice(2).join(' ') + '\\n');",
      'const change = process.argv[3];',
      "if (mode === 'fail') process.exit(9);",
      "const source = path.join('openspec', 'changes', change);",
      'const name = `${new Date().toISOString().slice(0, 10)}-${change}`;',
      "const target = path.join('openspec', 'changes', 'archive', name);",
      'await fs.mkdir(path.dirname(target), { recursive: true });',
      'await fs.rename(source, target);',
      "if (mode === 'move-fail') process.exit(9);",
    ].join('\n'),
  );
  if (process.platform === 'win32') {
    const command = path.join(dir, 'fake-openspec.cmd');
    await fs.writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return { command, log };
  }
  const command = path.join(dir, 'fake-openspec');
  await fs.writeFile(command, `#!/usr/bin/env node\nimport ${JSON.stringify(script)};\n`, {
    mode: 0o755,
  });
  return { command, log };
}

describe('Classic archive command', () => {
  it('rejects a change that is not in the archive phase', async () => {
    const dir = await makeProject();
    run(dir, ['state', 'init', 'demo', 'full']); // phase = open

    const result = run(dir, ['archive', 'demo']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("phase is 'open', expected 'archive'");
  });

  it('rejects an unverified change in the archive phase', async () => {
    const dir = await makeProject();
    run(dir, ['state', 'init', 'demo', 'full']);
    run(dir, ['state', 'set', 'demo', 'phase', 'archive'], { COMET_FORCE_PHASE: '1' });

    const result = run(dir, ['archive', 'demo']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("verify_result is 'pending', expected 'pass'");
  });

  it('dry-runs archive steps without invoking openspec', async () => {
    const dir = await makeProject();
    const changeDir = await seedArchiveChange(dir);
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    const result = run(dir, ['archive', 'demo', '--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[DRY-RUN] Would run OpenSpec archive: demo');
    expect(result.stderr).toContain('[DRY-RUN] Would set archived: true');
    expect(result.stderr).toContain('Dry run complete. 4/4 steps would succeed.');
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(before);
    await expect(fs.access(path.join(changeDir, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects mutating archive before final archive confirmation', async () => {
    const dir = await makeProject();
    const changeDir = await seedArchiveChange(dir);
    const fake = await fakeOpenSpec(dir, 'success');

    const result = run(dir, ['archive', 'demo'], { COMET_OPENSPEC: fake.command });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('archive_confirmation');
    await expect(fs.access(fake.log)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(changeDir)).resolves.toBeUndefined();
    const state = parse(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(state.archived).toBe(false);
  });

  it('archives a verified change and completes its Run transaction', async () => {
    const dir = await makeProject();
    await seedArchiveChange(dir);
    confirmArchiveChange(dir);
    const fake = await fakeOpenSpec(dir, 'success');

    const result = run(dir, ['archive', 'demo'], { COMET_OPENSPEC: fake.command });

    expect(result.status).toBe(0);
    expect(await fs.readFile(fake.log, 'utf8')).toBe('archive demo --yes\n');
    const archiveDir = path.join(
      dir,
      'openspec',
      'changes',
      'archive',
      `${new Date().toISOString().slice(0, 10)}-demo`,
    );
    const state = parse(await fs.readFile(path.join(archiveDir, '.comet.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(state).toMatchObject({
      archived: true,
      phase: 'archive',
    });
    const archiveRunState = await readRunState(archiveDir);
    expect(archiveRunState).not.toBeNull();
    expect(archiveRunState!.currentStep).toBe('completed');
    expect(archiveRunState!.status).toBe('completed');
    expect(archiveRunState!.pending).toBeNull();
    await expect(
      fs.access(path.join(archiveDir, archiveRunState!.pendingRef)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const artifacts = JSON.parse(
      await fs.readFile(path.join(archiveDir, archiveRunState!.artifactsRef), 'utf8'),
    ) as Record<string, string>;
    expect(artifacts.archive_directory).toBe(
      `openspec/changes/archive/${path.basename(archiveDir)}`,
    );
  });

  it('clears the shared selection when the archived change is current', async () => {
    const dir = await makeProject();
    await seedArchiveChange(dir);
    confirmArchiveChange(dir);
    expect(run(dir, ['state', 'select', 'demo']).status).toBe(0);
    const fake = await fakeOpenSpec(dir, 'success');

    expect(run(dir, ['archive', 'demo'], { COMET_OPENSPEC: fake.command }).status).toBe(0);

    await expect(fs.access(path.join(dir, '.comet', 'current-change.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves the shared selection when archiving another Classic change', async () => {
    const dir = await makeProject();
    await seedArchiveChange(dir);
    confirmArchiveChange(dir);
    expect(run(dir, ['state', 'init', 'other', 'full']).status).toBe(0);
    expect(run(dir, ['state', 'select', 'other']).status).toBe(0);
    const fake = await fakeOpenSpec(dir, 'success');

    expect(run(dir, ['archive', 'demo'], { COMET_OPENSPEC: fake.command }).status).toBe(0);

    expect(
      JSON.parse(await fs.readFile(path.join(dir, '.comet', 'current-change.json'), 'utf8')),
    ).toMatchObject({
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: 'other',
    });
  });

  it('treats a completed archive retry as an idempotent no-op', async () => {
    const dir = await makeProject();
    await seedArchiveChange(dir);
    confirmArchiveChange(dir);
    const fake = await fakeOpenSpec(dir, 'success');
    expect(run(dir, ['archive', 'demo'], { COMET_OPENSPEC: fake.command }).status).toBe(0);
    const archiveDir = path.join(
      dir,
      'openspec',
      'changes',
      'archive',
      `${new Date().toISOString().slice(0, 10)}-demo`,
    );
    const stateFile = path.join(archiveDir, '.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');
    const logBefore = await fs.readFile(fake.log, 'utf8');

    const result = run(dir, ['archive', 'demo'], { COMET_OPENSPEC: fake.command });

    expect(result.status).toBe(0);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
    expect(await fs.readFile(fake.log, 'utf8')).toBe(logBefore);
  });

  it('keeps a recoverable pending marker when OpenSpec fails before moving files', async () => {
    const dir = await makeProject();
    const changeDir = await seedArchiveChange(dir);
    confirmArchiveChange(dir);
    const fake = await fakeOpenSpec(dir, 'fail');

    const result = run(dir, ['archive', 'demo'], { COMET_OPENSPEC: fake.command });

    expect(result.status).toBe(9);
    const state = parse(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(state.archived).toBe(false);
    const failRunState = await readRunState(changeDir);
    expect(failRunState).not.toBeNull();
    expect(failRunState!.pending).toMatch(/^classic-archive:/u);
    await expect(
      fs.access(path.join(changeDir, failRunState!.pendingRef)),
    ).resolves.toBeUndefined();
  });

  it('reconciles an archive that moved before the external process was interrupted', async () => {
    const dir = await makeProject();
    await seedArchiveChange(dir);
    confirmArchiveChange(dir);
    const interrupted = await fakeOpenSpec(dir, 'move-fail');
    expect(run(dir, ['archive', 'demo'], { COMET_OPENSPEC: interrupted.command }).status).toBe(9);
    const logBeforeRetry = await fs.readFile(interrupted.log, 'utf8');
    const retry = await fakeOpenSpec(dir, 'success');

    const result = run(dir, ['archive', 'demo'], { COMET_OPENSPEC: retry.command });

    expect(result.status).toBe(0);
    expect(await fs.readFile(retry.log, 'utf8')).toBe(logBeforeRetry);
    const archiveDir = path.join(
      dir,
      'openspec',
      'changes',
      'archive',
      `${new Date().toISOString().slice(0, 10)}-demo`,
    );
    const reconcileRunState = await readRunState(archiveDir);
    expect(reconcileRunState).not.toBeNull();
    const trajectory = (
      await fs.readFile(path.join(archiveDir, reconcileRunState!.trajectoryRef), 'utf8')
    )
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { type: string; data?: { kind?: string } });
    expect(
      trajectory.filter(
        (event) => event.type === 'recovery_reconciled' && event.data?.kind === 'classic-archive',
      ),
    ).toHaveLength(1);
  });
});
