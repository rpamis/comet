import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function typescriptFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return typescriptFiles(target);
      return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
    }),
  );
  return nested.flat().sort();
}

describe('Native self-contained runtime boundary', () => {
  it('does not execute external processes or depend on a Git probe', async () => {
    const root = path.resolve('domains', 'comet-native');
    const files = await typescriptFiles(root);
    const sources = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const combined = sources.join('\n');

    expect(combined).not.toMatch(
      /(?:node:)?child_process|runSafeCommand|inspectGitRepository|GitRepositoryInspection/iu,
    );
    await expect(
      fs.access(path.resolve('platform', 'process', 'git-repository.ts')),
    ).rejects.toThrow();
  });

  it('routes every Native Run file through the protected Native adapter', async () => {
    const root = path.resolve('domains', 'comet-native');
    const files = (await typescriptFiles(root)).filter(
      (file) => path.basename(file) !== 'native-run-store.ts',
    );
    const sources = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const combined = sources.join('\n');

    expect(combined).not.toMatch(/from ['"]\.\.\/engine\/(?:run-store|storage-run)\.js['"]/u);
    const adapter = await fs.readFile(path.join(root, 'native-run-store.ts'), 'utf8');
    expect(adapter).toContain('containedRoot: options.changeDir');
    expect(adapter).not.toMatch(/\b(?:readRunStateAt|writeRunStateAt|removeRunStateAt)\b/u);
    for (const ref of [
      'stateRef',
      'trajectoryRef',
      'checkpointRef',
      'pendingRef',
      'contextRef',
      'artifactsRef',
    ]) {
      expect(adapter).toContain(`runFile(changeDir, '${ref}'`);
    }
  });
});
