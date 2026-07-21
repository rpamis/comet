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
  it('keeps process execution inside the bounded Native snapshot provider', async () => {
    const root = path.resolve('domains', 'comet-native');
    const files = await typescriptFiles(root);
    const sources = new Map(
      await Promise.all(
        files.map(
          async (file) =>
            [
              path.relative(root, file).replaceAll('\\', '/'),
              await fs.readFile(file, 'utf8'),
            ] as const,
        ),
      ),
    );
    const processFiles = [...sources]
      .filter(([, source]) => /(?:node:)?child_process/u.test(source))
      .map(([file]) => file);
    const snapshot = sources.get('native-snapshot.ts');

    expect(processFiles).toEqual(['native-snapshot.ts']);
    expect(snapshot).toBeDefined();
    expect(snapshot).toContain("import { spawn, type ChildProcess } from 'node:child_process';");
    expect(snapshot).not.toMatch(/\b(?:execFile|execSync|execFileSync|fork|spawnSync)\s*\(/u);

    const sourcesOutsideSnapshot = [...sources]
      .filter(([file]) => file !== 'native-snapshot.ts')
      .map(([, source]) => source)
      .join('\n');
    expect(sourcesOutsideSnapshot).not.toMatch(
      /\b(?:spawn|execFile|execSync|execFileSync|fork|spawnSync)\s*\(/u,
    );
    expect(sourcesOutsideSnapshot).not.toContain('gitProcess');

    const combined = [...sources.values()].join('\n');
    expect(combined).not.toMatch(/(?:^|[,{]\s*)shell\s*:/mu);
    expect(combined).not.toMatch(/runSafeCommand|inspectGitRepository|GitRepositoryInspection/iu);
    expect(combined).not.toMatch(
      /platform\/process|(?:^|[/'"])(?:comet-classic|openspec)(?:[/'"]|$)|superpowers|assets\/skills|\.agents\/skills|\.comet\/skills/imu,
    );
  });

  it('pins Native snapshot processes to read-only Git arguments and bounded termination', async () => {
    const source = await fs.readFile(
      path.resolve('domains', 'comet-native', 'native-snapshot.ts'),
      'utf8',
    );
    const normalized = source.replace(/\s+/gu, ' ');
    const normalizedArrays = normalized
      .replace(/\[\s+/gu, '[')
      .replace(/\s+\]/gu, ']')
      .replace(/,\]/gu, ']');
    const occurrences = (pattern: RegExp): number => source.match(pattern)?.length ?? 0;
    const literalOccurrences = (value: string): number => normalizedArrays.split(value).length - 1;

    // One Git launcher and one trusted Windows process-tree terminator. Adding another spawn
    // site must make this repository boundary test fail and receive an explicit security review.
    expect(occurrences(/\bspawn\s*\(/gu)).toBe(2);
    expect(normalized).toContain("gitProcess: options.gitProcess ?? { command: 'git' }");
    expect(normalized).toContain(
      "spawn( adapter.command, [...(adapter.argsPrefix ?? []), '-C', projectRoot, ...args], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32', }, )",
    );
    expect(normalized).toContain(
      "spawn(taskkill, ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, })",
    );
    expect(normalized).toContain("path.win32.join(systemRoot, 'System32', 'taskkill.exe')");

    // These counts include each helper declaration. Every actual Git invocation below is
    // therefore accounted for by one of the fixed, read-only argument vectors.
    expect(occurrences(/\brunGitNullRecords\s*\(/gu)).toBe(5);
    expect(occurrences(/\brunGitBoundedOutput\s*\(/gu)).toBe(3);
    expect(occurrences(/\brunGitHasOutput\s*\(/gu)).toBe(2);
    expect(literalOccurrences("['ls-files', '--stage', '-z']")).toBe(2);
    expect(
      literalOccurrences("['ls-files', '--cached', '--others', '--exclude-standard', '-z']"),
    ).toBe(1);
    expect(literalOccurrences("['check-ignore', '--no-index', '-z', '--stdin']")).toBe(1);
    expect(literalOccurrences("['rev-parse', '--is-inside-work-tree']")).toBe(1);
    expect(literalOccurrences("['rev-parse', '--verify', 'HEAD']")).toBe(1);
    expect(
      literalOccurrences("['status', '--porcelain=v1', '-z', '--untracked-files=normal']"),
    ).toBe(1);

    expect(normalized).toContain('const DEFAULT_NATIVE_SNAPSHOT_EXECUTION_BUDGET_MS = 60_000');
    expect(normalized).toContain('const GIT_LIST_STDERR_LIMIT = 64 * 1024');
    expect(normalized).toContain('const GIT_TEXT_STDOUT_LIMIT = 64 * 1024');
    expect(normalized).toContain("child.once('close', resolve)");
    expect(normalized).toContain('termination = terminateNativeProcessTree(child, adapter)');
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
