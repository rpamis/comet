import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('builds identical strict runtime bundles inside and outside node_modules', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'comet-build-location-'));
  try {
    const outputs: Buffer[][] = [];
    for (const relative of ['ordinary', 'node_modules/isolated']) {
      const root = path.join(fixture, relative);
      await mkdir(path.join(root, 'config'), { recursive: true });
      await mkdir(path.join(root, 'app/commands'), { recursive: true });
      await cp(path.resolve('scripts/build'), path.join(root, 'scripts/build'), {
        recursive: true,
      });
      await cp(path.resolve('scripts/lib'), path.join(root, 'scripts/lib'), { recursive: true });
      await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
      await writeFile(path.join(root, 'package.json'), '{"type":"module","version":"0.5.1"}');
      await writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
      await writeFile(
        path.join(root, 'value.ts'),
        'export = function () { return this === undefined; };',
      );
      const entry = "import read from '../../value'; export const strict = read();";
      await writeFile(path.join(root, 'app/commands/native.ts'), entry);
      const runtime = {
        entries: { runtime: 'app/commands/native.ts' },
        outputs: { runtime: 'runtime.mjs' },
      };
      await writeFile(
        path.join(root, 'config/repository-layout.json'),
        JSON.stringify({ classicRuntime: runtime, nativeRuntime: runtime, entryRuntime: runtime }),
      );
      const row: Buffer[] = [];
      for (const name of ['classic-runtime', 'native-runtime', 'entry-runtime', 'native-facade']) {
        const result = spawnSync(process.execPath, [`scripts/build/build-${name}.mjs`], {
          cwd: root,
          encoding: 'utf8',
        });
        expect(result.stderr, name).toBe('');
        expect(result.status, name).toBe(0);
        row.push(
          await readFile(
            path.join(
              root,
              name === 'native-facade' ? 'dist/app/commands/native.bundle.js' : 'runtime.mjs',
            ),
          ),
        );
      }
      outputs.push(row);
    }
    for (let index = 0; index < outputs[0].length; index += 1) {
      expect(outputs[1][index].equals(outputs[0][index]), `builder ${index}`).toBe(true);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30000);
