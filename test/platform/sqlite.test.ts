import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

it.each(['esm', 'cjs'] as const)(
  'opens SQLite from a %s bundle loaded by a CommonJS eval caller',
  async (format) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sqlite-module-'));
    directories.push(directory);
    const file = path.join(directory, format === 'esm' ? 'sqlite.mjs' : 'sqlite.cjs');
    await build({
      entryPoints: ['platform/fs/sqlite.ts'],
      outfile: file,
      bundle: true,
      platform: 'node',
      format,
      logLevel: 'silent',
    });
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=commonjs',
        '--eval',
        `import(${JSON.stringify(pathToFileURL(file).href)}).then(({openSqliteDatabase}) => {
          const db = openSqliteDatabase(':memory:');
          try { console.log(db.prepare('SELECT 42 AS answer').get().answer); }
          finally { db.close(); }
        }).catch(error => { console.error(error); process.exitCode = 1; });`,
      ],
      { cwd: directory, encoding: 'utf8', timeout: 10_000 },
    );
    expect(output.trim()).toBe('42');
  },
);
