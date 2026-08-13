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
    const result = loadUserEvalEnvironment(environment, home);

    expect(result).toEqual({
      path: path.join(home, '.comet', 'eval', '.env'),
      created: false,
    });
    expect(environment.BENCH_MODEL).toBe('process-model');
    expect(environment.BENCH_BASE_URL).toBe('https://user.example/v1');
  });

  it('creates the complete user template when the user file is absent', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-home-'));
    temporary.push(home);
    const environment = {} as NodeJS.ProcessEnv;
    const envPath = path.join(home, '.comet', 'eval', '.env');

    expect(loadUserEvalEnvironment(environment, home)).toEqual({
      path: envPath,
      created: true,
    });
    expect(environment).toEqual({});
    const template = await fs.readFile(envPath, 'utf8');
    expect(template).toContain('# BENCH_API_KEY=');
    expect(template).toContain('# OPENAI_BASE_URL=');
    expect(template).toContain('# OPENAI_MODEL=');
    expect(template).toContain('# BENCH_JUDGE_MODEL=');
    expect(template).toContain('# BENCH_JUDGE_AGENT=');
    expect(template).toContain('# CODEBUDDY_CODE_SUBAGENT_MODEL=');
    expect(template).toContain('# COMET_EVAL_ADAPTERS_DIR=');
    expect(template).toContain('# MY_AGENT_API_KEY=');
    expect(template).toContain('# LANGFUSE_SECRET_KEY=');
  });

  it('does not overwrite an existing user file', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-home-'));
    temporary.push(home);
    const envDirectory = path.join(home, '.comet', 'eval');
    const envPath = path.join(envDirectory, '.env');
    await fs.mkdir(envDirectory, { recursive: true });
    await fs.writeFile(envPath, '# user-owned\n', 'utf8');

    expect(loadUserEvalEnvironment({} as NodeJS.ProcessEnv, home)).toEqual({
      path: envPath,
      created: false,
    });
    await expect(fs.readFile(envPath, 'utf8')).resolves.toBe('# user-owned\n');
  });
});
