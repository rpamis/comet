import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { inspectNativeHookGuard } from '../../../domains/comet-native/native-hook-guard.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { readNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';

describe('Native confirmed brief upgrade compatibility', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-brief-upgrade-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([1, 2])(
    'continues a real v%s Build without adding new Shape requirements',
    async (version) => {
      const fixture = JSON.parse(
        await fs.readFile(
          fileURLToPath(
            new URL(`../../fixtures/native-brief-upgrade/v${version}.json`, import.meta.url),
          ),
          'utf8',
        ),
      ) as { brief: string; spec: string; state: string };
      await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
      const paths = await nativeProjectPaths(root, 'docs');
      await ensureNativeDirectories(paths);
      const changeDir = path.join(paths.changesDir, 'legacy-change');
      await fs.mkdir(path.join(changeDir, 'specs/sample'), { recursive: true });
      await fs.writeFile(path.join(changeDir, 'brief.md'), fixture.brief);
      await fs.writeFile(path.join(changeDir, 'specs/sample/spec.md'), fixture.spec);
      await fs.writeFile(path.join(changeDir, 'comet-state.yaml'), fixture.state);
      const before = await readNativePortableChange(paths, 'legacy-change');
      expect(before).toMatchObject({ phase: 'build', document_constraints_version: version });
      expect(before.acceptance).toHaveLength(1);
      expect(fixture.brief).not.toContain('Directory structure');

      for (const command of ['status', 'show', 'next']) {
        const output = await runNativeCli([
          command,
          'legacy-change',
          '--json',
          '--project-root',
          root,
          ...(command === 'next' ? ['--summary', 'Continue the confirmed implementation.'] : []),
        ]);
        expect(output, `${command}: ${output.stdout ?? output.stderr}`).toMatchObject({
          exitCode: 0,
        });
        expect(await readNativePortableChange(paths, 'legacy-change')).toEqual(before);
      }
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      expect(
        await inspectNativeHookGuard(
          root,
          { intent: 'write', targets: ['src/module.txt'] },
          'legacy-change',
        ),
      ).toMatchObject({ allowed: true });
      await fs.writeFile(path.join(root, 'src/module.txt'), 'Existing behavior implementation.\n');
      expect(
        await runNativeCli([
          'next',
          'legacy-change',
          '--json',
          '--project-root',
          root,
          '--summary',
          'Continue the confirmed implementation.',
        ]),
      ).toMatchObject({ exitCode: 0 });
      expect(await readNativePortableChange(paths, 'legacy-change')).toEqual(before);
    },
  );
});
