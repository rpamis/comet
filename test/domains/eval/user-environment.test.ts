import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadUserEvalEnvironment } from '../../../domains/eval/user-environment.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('user eval environment', () => {
  it('loads user eval values without replacing process values', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-home-'));
    temporary.push(home);
    await fs.mkdir(path.join(home, '.comet', 'eval'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.comet', 'eval', '.env'),
      'BENCH_MODEL="user-model"\nBENCH_BASE_URL=https://user.example/v1\n',
      'utf8',
    );

    const environment = { BENCH_MODEL: 'process-model' } as NodeJS.ProcessEnv;
    loadUserEvalEnvironment(environment, home);

    expect(environment.BENCH_MODEL).toBe('process-model');
    expect(environment.BENCH_BASE_URL).toBe('https://user.example/v1');
  });

  it('does nothing when the user file is absent', () => {
    const environment = {} as NodeJS.ProcessEnv;

    expect(
      loadUserEvalEnvironment(environment, path.join(os.tmpdir(), 'missing-comet-home')),
    ).toBeNull();
    expect(environment).toEqual({});
  });
});
