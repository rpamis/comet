import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readUserEvalSettings,
  saveUserEvalSettings,
} from '../../../domains/eval/eval-user-settings.js';
import { loadUserEvalEnvironment } from '../../../domains/eval/user-environment.js';

describe('User Eval settings', () => {
  let home: string;
  let file: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-settings-'));
    file = path.join(home, '.comet/eval/.env');
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(home, { recursive: true, force: true });
  });
  it('saves tracking destinations and separately manages masked service credentials', async () => {
    const old = await readUserEvalSettings({});
    const saved = await saveUserEvalSettings(
      {
        expectedRevision: old.revision,
        defaults: {
          ...old.defaults,
          suite: 'langfuse',
          langsmithEndpoint: 'https://smith.example',
          langsmithProject: 'comet-skill-eval',
          langsmithTracing: false,
          langfuseBaseUrl: 'https://fuse.example',
          langfuseEnvironment: 'development',
        },
        credentials: {
          langsmith: { kind: 'api-key', value: 'smith-test-secret' },
          langfusePublic: { kind: 'api-key', value: 'fuse-test-public' },
          langfuseSecret: { kind: 'api-key', value: 'fuse-test-secret' },
        },
      },
      {},
    );
    expect(saved.defaults).toMatchObject({
      suite: 'langfuse',
      langsmithProject: 'comet-skill-eval',
      langsmithTracing: false,
      langfuseBaseUrl: 'https://fuse.example',
      langfuseEnvironment: 'development',
    });
    for (const slot of ['langsmith', 'langfusePublic', 'langfuseSecret'] as const)
      expect(saved.credentials[slot]).toMatchObject({
        configured: true,
        saved: true,
        source: 'file',
      });
    for (const value of ['smith-test-secret', 'fuse-test-public', 'fuse-test-secret'])
      expect(JSON.stringify(saved)).not.toContain(value);
    const environment = {};
    loadUserEvalEnvironment(environment, home, { create: false });
    expect(environment).toMatchObject({
      COMET_EVAL_SUITE: 'langfuse',
      LANGSMITH_API_KEY: 'smith-test-secret',
      LANGSMITH_TRACING: 'false',
      LANGSMITH_PROJECT: 'comet-skill-eval',
      LANGFUSE_PUBLIC_KEY: 'fuse-test-public',
      LANGFUSE_SECRET_KEY: 'fuse-test-secret',
      LANGFUSE_BASE_URL: 'https://fuse.example',
    });
    const cleared = await saveUserEvalSettings(
      {
        expectedRevision: saved.revision,
        defaults: saved.defaults,
        credentials: { langfuseSecret: null },
      },
      {},
    );
    expect(cleared.credentials.langfuseSecret.configured).toBe(false);
    expect(cleared.credentials.langfusePublic.configured).toBe(true);
    expect(cleared.credentials.langsmith.configured).toBe(true);
    const inherited = await readUserEvalSettings({
      COMET_EVAL_SUITE: 'langsmith',
      LANGFUSE_SECRET_KEY: 'inherited-fuse-secret',
    });
    expect(inherited.defaults.suite).toBe('langsmith');
    expect(inherited.credentials.langfuseSecret).toMatchObject({
      configured: true,
      saved: false,
      source: 'environment',
    });
    expect(inherited.overrides).toEqual(
      expect.arrayContaining(['默认报告去向', 'Langfuse Secret key']),
    );
    expect(JSON.stringify(inherited)).not.toContain('inherited-fuse-secret');
  });
  it('preserves tracking settings when an older client omits the new defaults', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'LANGSMITH_PROJECT=retained\nCOMET_EVAL_SUITE=langsmith\n');
    const old = await readUserEvalSettings({});
    const defaults = { ...old.defaults };
    for (const key of [
      'suite',
      'langsmithProject',
      'langsmithEndpoint',
      'langsmithTracing',
      'langfuseBaseUrl',
      'langfuseEnvironment',
    ])
      delete (defaults as Record<string, unknown>)[key];
    const saved = await saveUserEvalSettings({ expectedRevision: old.revision, defaults }, {});
    expect(saved.defaults).toMatchObject({ suite: 'langsmith', langsmithProject: 'retained' });
  });
  it.each([
    { suite: 'unknown' },
    { langsmithEndpoint: 'https://smith.example?key=bad' },
    { langfuseBaseUrl: 'file:///tmp' },
    { langfuseEnvironment: 'ci\nINJECT=1' },
    { langsmithTracing: 'true' },
  ])('rejects invalid tracking defaults %j', async (patch) => {
    const old = await readUserEvalSettings({});
    await expect(
      saveUserEvalSettings(
        { expectedRevision: old.revision, defaults: { ...old.defaults, ...patch } },
        {},
      ),
    ).rejects.toThrow();
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects credentials copied into tracking metadata', async () => {
    const old = await readUserEvalSettings({});
    await expect(
      saveUserEvalSettings(
        {
          expectedRevision: old.revision,
          defaults: { ...old.defaults, langsmithProject: 'tracking-hidden-secret' },
          credentials: { langsmith: { kind: 'api-key', value: 'tracking-hidden-secret' } },
        },
        {},
      ),
    ).rejects.toThrow(/凭据/);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reads defaults without creating files or exposing inherited credentials', async () => {
    const settings = await readUserEvalSettings({
      BENCH_API_KEY: 'environment-secret',
      BENCH_MODEL: 'env-model',
    });
    expect(settings.defaults.model).toBe('env-model');
    expect(settings.credentials.main.source).toBe('environment');
    expect(JSON.stringify(settings)).not.toContain('environment-secret');
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('saves reusable settings and credentials while preserving unrelated dotenv content', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# personal comment\nMY_CUSTOM_KEY=custom-secret\n');
    const old = await readUserEvalSettings({});
    const saved = await saveUserEvalSettings(
      {
        expectedRevision: old.revision,
        defaults: {
          ...old.defaults,
          agent: 'codex',
          model: 'model-a',
          baseUrl: 'https://provider.example/v1',
          judgeEnabled: true,
          judgeAgent: 'claude-code',
          judgeModel: 'judge-a',
          skillMaxTurns: 48,
        },
        credentials: {
          main: { value: 'main-secret', kind: 'api-key' },
          judge: { value: 'judge-secret', kind: 'api-key' },
        },
      },
      {},
    );
    expect(saved.defaults).toMatchObject({
      agent: 'codex',
      model: 'model-a',
      judgeAgent: 'claude-code',
      judgeModel: 'judge-a',
      skillMaxTurns: 48,
    });
    expect(saved.credentials.main.configured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('main-secret');
    expect(JSON.stringify(saved)).not.toContain('judge-secret');
    const content = await fs.readFile(file, 'utf8');
    expect(content).toContain('# personal comment');
    expect(content).toContain('MY_CUSTOM_KEY=custom-secret');
    const environment = {};
    loadUserEvalEnvironment(environment, home, { create: false });
    expect(environment).toMatchObject({
      BENCH_API_KEY: 'main-secret',
      BENCH_EVAL_AGENT: 'codex',
      BENCH_JUDGE_API_KEY: 'judge-secret',
    });
  });
  it('keeps credentials on normal saves, clears them explicitly and rejects stale updates', async () => {
    const first = await readUserEvalSettings({});
    const saved = await saveUserEvalSettings(
      {
        expectedRevision: first.revision,
        defaults: first.defaults,
        credentials: { main: { value: 'kept-secret', kind: 'api-key' } },
      },
      {},
    );
    await expect(
      saveUserEvalSettings({ expectedRevision: first.revision, defaults: first.defaults }, {}),
    ).rejects.toThrow(/已变化/);
    const kept = await saveUserEvalSettings(
      { expectedRevision: saved.revision, defaults: { ...saved.defaults, model: 'changed' } },
      {},
    );
    expect(kept.credentials.main.configured).toBe(true);
    const cleared = await saveUserEvalSettings(
      { expectedRevision: kept.revision, defaults: kept.defaults, credentials: { main: null } },
      {},
    );
    expect(cleared.credentials.main.configured).toBe(false);
    expect(await fs.readFile(file, 'utf8')).not.toContain('kept-secret');
  });
  it('reports inherited environment precedence without exposing its values', async () => {
    const old = await readUserEvalSettings({});
    await saveUserEvalSettings(
      {
        expectedRevision: old.revision,
        defaults: { ...old.defaults, model: 'file-model' },
        credentials: { main: { value: 'file-secret', kind: 'api-key' } },
      },
      {},
    );
    const effective = await readUserEvalSettings({
      BENCH_CC_MODEL: 'environment-model',
      BENCH_API_KEY: 'environment-secret',
    });
    expect(effective.defaults.model).toBe('environment-model');
    expect(effective.credentials.main.source).toBe('environment');
    expect(effective.overrides).toContain('执行模型');
    expect(JSON.stringify(effective)).not.toContain('environment-secret');
  });
  it('rejects secret injection, unknown fields and unsupported execution budgets without changing the file', async () => {
    const old = await readUserEvalSettings({});
    await expect(
      saveUserEvalSettings(
        {
          expectedRevision: old.revision,
          defaults: old.defaults,
          credentials: { main: { value: 'secret\nNODE_OPTIONS=bad', kind: 'api-key' } },
        },
        {},
      ),
    ).rejects.toThrow(/凭据/);
    await expect(
      saveUserEvalSettings(
        { expectedRevision: old.revision, defaults: { ...old.defaults, applicationMaxTurns: 200 } },
        {},
      ),
    ).rejects.toThrow(/轮数/);
    await expect(
      saveUserEvalSettings(
        { expectedRevision: old.revision, defaults: old.defaults, apiKey: 'leak' },
        {},
      ),
    ).rejects.toThrow(/字段/);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not persist a credential accidentally pasted into a model field', async () => {
    const old = await readUserEvalSettings({});
    await expect(
      saveUserEvalSettings(
        {
          expectedRevision: old.revision,
          defaults: { ...old.defaults, model: 'new-secret-value' },
          credentials: { main: { value: 'new-secret-value', kind: 'api-key' } },
        },
        {},
      ),
    ).rejects.toThrow(/不能包含凭据/);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports the effective credential and model source when fallback aliases are present', async () => {
    const old = await readUserEvalSettings({});
    await saveUserEvalSettings(
      {
        expectedRevision: old.revision,
        defaults: { ...old.defaults, model: 'file-model' },
        credentials: { main: { value: 'file-secret', kind: 'api-key' } },
      },
      {},
    );
    const settings = await readUserEvalSettings({
      ANTHROPIC_MODEL: 'fallback-model',
      ANTHROPIC_API_KEY: 'fallback-secret',
    });
    expect(settings.defaults.model).toBe('file-model');
    expect(settings.credentials.main.source).toBe('file');
    expect(settings.overrides).not.toContain('执行模型');
    expect(settings.overrides).not.toContain('执行凭据');
  });
  it('does not echo credentials embedded in a legacy endpoint', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "BENCH_BASE_URL='https://user:legacy-password@example.test/v1'\n");
    const settings = await readUserEvalSettings({});
    expect(settings.defaults.baseUrl).toBe('');
    expect(settings.warnings).toHaveLength(1);
    expect(JSON.stringify(settings)).not.toContain('legacy-password');
  });
  it('reports inherited Judge credentials independently of its saved enable switch', async () => {
    const old = await readUserEvalSettings({});
    await saveUserEvalSettings({ expectedRevision: old.revision, defaults: old.defaults }, {});
    const settings = await readUserEvalSettings({
      BENCH_JUDGE_AUTH_TOKEN: 'inherited-judge-secret',
      COMET_EVAL_SKILL_MAX_TURNS: '52',
    });
    expect(settings.defaults.judgeEnabled).toBe(false);
    expect(settings.credentials.judge.source).toBe('environment');
    expect(settings.overrides).toContain('Judge 凭据');
    expect(settings.overrides).toContain('Skill 默认轮数');
    expect(settings.defaults.skillMaxTurns).toBe(52);
  });
  it('rejects a redirected user configuration directory before writing credentials', async () => {
    const old = await readUserEvalSettings({});
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-redirect-'));
    const link = path.join(home, '.comet/eval');
    await fs.mkdir(path.dirname(link), { recursive: true });
    try {
      await fs.symlink(other, link, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(
        saveUserEvalSettings(
          {
            expectedRevision: old.revision,
            defaults: old.defaults,
            credentials: { main: { kind: 'api-key', value: 'redirect-secret' } },
          },
          {},
        ),
      ).rejects.toThrow(/用户目录以外/);
      await expect(fs.stat(path.join(other, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.unlink(link).catch(() => {});
      await fs.rm(other, { recursive: true, force: true });
    }
  });
});
