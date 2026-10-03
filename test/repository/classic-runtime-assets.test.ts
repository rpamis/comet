import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

type AssetsManifest = {
  skills: string[];
};

type PackageJson = {
  files?: string[];
};

const scriptsDirectory = path.resolve('assets', 'skills', 'comet', 'scripts');
const classicReferenceDirectory = path.resolve('assets', 'skills', 'comet-classic', 'reference');

function manifestScriptPath(fileName: string): string {
  return `comet/scripts/${fileName}`;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
}

describe('Classic runtime release assets', () => {
  it.each(['state', 'check', 'guard', 'handoff', 'archive'])(
    'imports the %s command without side effects and keeps standalone help working through a linked directory',
    async (command) => {
      const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-bundle-entry-'));
      try {
        const bundle = path.join(scriptsDirectory, `comet-${command}.mjs`);
        const imported = execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
        const {runClassicCli} = await import(${JSON.stringify(pathToFileURL(bundle).href)});
        const result = await runClassicCli([${JSON.stringify(command)}, '--help', '--json']);
        process.stdout.write(result.stdout);
        process.exitCode = result.exitCode;
      `,
          ],
          { cwd: fixture, encoding: 'utf8' },
        );
        const parsed = JSON.parse(imported);
        expect(parsed.command).toBe(command);
        expect(parsed.exitCode).toBe(0);
        expect(parsed.stdout).toContain('Usage:');
        const linked = path.join(fixture, 'scripts');
        await fs.symlink(
          scriptsDirectory,
          linked,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        const standalone = execFileSync(
          process.execPath,
          [path.join(linked, `comet-${command}.mjs`), '--help', '--json'],
          { cwd: fixture, encoding: 'utf8' },
        );
        expect(JSON.parse(standalone)).toEqual(parsed);
        const preservedLink = execFileSync(
          process.execPath,
          [
            '--preserve-symlinks-main',
            path.join(linked, `comet-${command}.mjs`),
            '--help',
            '--json',
          ],
          { cwd: fixture, encoding: 'utf8' },
        );
        expect(JSON.parse(preservedLink)).toEqual(parsed);
      } finally {
        await fs.rm(fixture, { recursive: true, force: true });
      }
    },
  );
  it('ships bilingual Classic references under the Classic entry', async () => {
    const manifest = await readJson<AssetsManifest>(path.resolve('assets', 'manifest.json'));
    const englishFiles = (await fs.readdir(classicReferenceDirectory))
      .filter((fileName) => fileName.endsWith('.md'))
      .sort();
    const chineseFiles = (
      await fs.readdir(path.resolve('assets', 'skills-zh', 'comet-classic', 'reference'))
    )
      .filter((fileName) => fileName.endsWith('.md'))
      .sort();
    const manifestReferences = manifest.skills
      .filter((skillPath) => skillPath.startsWith('comet-classic/reference/'))
      .sort();

    expect(chineseFiles).toEqual(englishFiles);
    expect(manifestReferences).toEqual(
      englishFiles.map((fileName) => `comet-classic/reference/${fileName}`),
    );
    expect(existsSync(path.resolve('assets', 'skills', 'comet', 'reference'))).toBe(false);
    expect(existsSync(path.resolve('assets', 'skills-zh', 'comet', 'reference'))).toBe(false);
  });

  it('lists every shipped Classic script in the assets manifest', async () => {
    const manifest = await readJson<AssetsManifest>(path.resolve('assets', 'manifest.json'));
    const scriptFiles = (await fs.readdir(scriptsDirectory))
      .filter((fileName) => fileName.endsWith('.mjs'))
      .sort();
    const manifestScripts = manifest.skills
      .filter((skillPath) => skillPath.startsWith('comet/scripts/'))
      .sort();

    expect(manifestScripts).toEqual(scriptFiles.map(manifestScriptPath).sort());
    expect(manifestScripts).toContain('comet/scripts/comet-runtime.mjs');
  });

  it('keeps relative launcher imports resolvable inside shipped scripts', async () => {
    const manifest = await readJson<AssetsManifest>(path.resolve('assets', 'manifest.json'));
    const scriptFiles = new Set(
      (await fs.readdir(scriptsDirectory)).filter((fileName) => fileName.endsWith('.mjs')),
    );
    const importPattern = /from\s+['"]\.\/([^'"]+)['"]/g;

    for (const fileName of scriptFiles) {
      const source = await fs.readFile(path.join(scriptsDirectory, fileName), 'utf-8');
      const imports = [...source.matchAll(importPattern)].map((match) => match[1]);

      for (const importName of imports) {
        expect(scriptFiles.has(importName), `${fileName} imports missing ${importName}`).toBe(true);
        expect(manifest.skills).toContain(manifestScriptPath(importName));
      }
    }
  });

  it('keeps npm package allowlist broad enough to ship Comet assets and installer', async () => {
    const packageJson = await readJson<PackageJson>(path.resolve('package.json'));

    expect(packageJson.files).toContain('assets');
    expect(packageJson.files).toContain('bin');
    expect(packageJson.files).toContain('dist');
    expect(packageJson.files).toContain('eval/.env.example');
    expect(packageJson.files).toContain('scripts/install/postinstall.js');
  });
});
