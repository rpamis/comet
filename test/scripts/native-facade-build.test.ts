import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNativeFacade, relocateModuleUrls } from '../../scripts/build/build-native-facade.mjs';

describe('Native facade bundle', () => {
  it('relocates module URL expressions without changing strings or comments', () => {
    const root = path.resolve('/temporary/package');
    const source = `// import.meta.url\nconst example = 'import.meta.url';\nexport const worker = new URL('./worker.js', import.meta.url);`;
    const transformed = relocateModuleUrls(
      source,
      path.join(root, 'domains/feature/entry.ts'),
      path.join(root, 'dist/app/commands/native.bundle.js'),
      root,
    );
    expect(transformed).toContain("// import.meta.url\nconst example = 'import.meta.url';");
    expect(transformed).toContain(
      'new URL("../../domains/feature/entry.js", import.meta.url).href',
    );
    expect(transformed).not.toContain(root);
  });

  it('runs the full facade once through a relocated launcher without installed dependencies', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'comet-native-bundle-'));
    try {
      const result = await buildNativeFacade();
      const output = path.join(fixture, 'dist/app/commands/native.bundle.js');
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, result.outputFiles[0].contents);
      await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
      const launcher = path.join(fixture, 'launch.mjs');
      await writeFile(
        launcher,
        `const { runNativeFacade } = await import(${JSON.stringify(pathToFileURL(output).href)}); process.exitCode = await runNativeFacade(['status', '--project-root', ${JSON.stringify(fixture)}, '--json']);`,
      );
      const execution = spawnSync(process.execPath, [launcher], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: fixture,
          USERPROFILE: fixture,
          COMET_TASK: '',
          COMET_DAEMON: 'off',
        },
      });
      expect(execution.stderr).toBe('');
      expect(execution.status).not.toBeNull();
      expect(JSON.parse(execution.stdout)).toBeTruthy();
      const bundle = Buffer.from(result.outputFiles[0].contents).toString();
      expect(bundle).toContain('comet-task-context-worker.js');
      expect(bundle).not.toContain(path.resolve('.'));
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }, 30000);
});
