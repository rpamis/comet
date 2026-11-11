import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, it, expect } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  nativeProjectPaths,
  ensureNativeDirectories,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
  readNativePortableChange,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { force: true, recursive: true });
});
it.each(['missing', 'incomplete'] as const)(
  'keeps public CLI structured Builder readiness for %s review',
  async (kind) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-aggregate-cli-readiness-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.git'));
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, {
      ...config,
      native: { ...config.native, document_writes: 'revert' },
    });
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    const name = 'builder-readiness';
    await createNativePortableChange({ paths, name, language: 'en' });
    const dir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(dir, 'brief.md'),
      '# Acceptance examples\n- Preserve the original incomplete review diagnostic.\n',
    );
    await fs.mkdir(path.join(dir, 'specs/demo'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'specs/demo/spec.md'),
      '# Demo\nThe workflow remains safe.\n',
    );
    const before = await confirmNativePortableShape({ paths, name });
    const ids = before.acceptance.map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
    const input = {
      kind: 'builder-handoff',
      summary: 'SIMULATED Agent incomplete submission for diagnostic regression',
      addressed_acceptance_ids: ids,
      checks: [],
      known_limits: [],
      ...(kind === 'incomplete'
        ? {
            acceptance_review: ids.map((id) => ({
              id,
              status: 'implemented-no-evidence',
              evidence: [],
              note: 'SIMULATED Agent explicitly reports that evidence is incomplete.',
            })),
          }
        : {}),
    };
    const inputFile = path.join(root, 'input.json');
    await fs.writeFile(inputFile, JSON.stringify(input));
    const result = await runNativeCli([
      'next',
      name,
      '--runner-input',
      inputFile,
      '--project-root',
      root,
      '--json',
    ]);
    const json = JSON.parse(result.stdout);
    expect(result.exitCode, result.stdout || result.stderr).toBe(65);
    expect(json.error.code).toBe('invalid-data');
    expect(json.data.builderReadiness).toEqual({
      ready: false,
      missingIds: kind === 'missing' ? ids : [],
      incompleteIds: kind === 'incomplete' ? ids : [],
    });
    expect(await readNativePortableChange(paths, name)).toEqual(before);
  },
);
