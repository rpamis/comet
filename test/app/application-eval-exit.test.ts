import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadUserEvalEnvironment } from '../../domains/eval/index.js';
import { evalCommand } from '../../app/commands/eval.js';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  run: vi.fn(),
  register: vi.fn(),
  finish: vi.fn(),
}));
vi.mock('../../domains/eval/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domains/eval/index.js')>()),
  loadUserEvalEnvironment: vi.fn(),
  previewWorkflowApplicationEval: mocks.preview,
  runWorkflowApplicationEval: mocks.run,
  registerCliEvalRun: mocks.register,
  finishCliEvalTracking: mocks.finish,
}));

describe('application Eval command exit contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COMET_EVAL_MANAGED', undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.preview.mockResolvedValue({
      application: { id: 'fixture', contentHash: 'content' },
      confirmationHash: 'confirmation',
      settings: { agent: 'fixture-agent' },
      blockedReasons: ['External Skill requires a fixed test replacement'],
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ['passed', 0],
    ['failed', 1],
    ['incomplete', 1],
  ] as const)('returns %s as exit %i while preserving JSON and tracking', async (status, code) => {
    const result = { status, passed: status === 'passed' ? 2 : 0, total: 2 };
    mocks.run.mockResolvedValue(result);
    expect(await evalCommand('application.json')).toBe(code);
    expect(console.log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result, null, 2));
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.stringMatching(/^comet-eval-/u),
      undefined,
    );
  });

  it('returns zero for a successful collect even when the preview is blocked', async () => {
    expect(await evalCommand('application.json', { collect: true })).toBe(0);
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0]).blockedReasons).toHaveLength(1);
    expect(loadUserEvalEnvironment).toHaveBeenCalledWith(process.env, undefined, { create: false });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it('does not turn an observational score into a CLI failure', async () => {
    mocks.run.mockResolvedValue({ status: 'passed', score: 0.1, passed: 2, total: 2 });
    expect(await evalCommand('application.json')).toBe(0);
  });

  it('preserves managed-run ownership for incomplete results', async () => {
    vi.stubEnv('COMET_EVAL_MANAGED', '1');
    mocks.run.mockResolvedValue({ status: 'incomplete', passed: 0, total: 0 });
    expect(await evalCommand('application.json')).toBe(1);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it('still throws execution exceptions and passes them to tracking cleanup', async () => {
    const error = new Error('fixture execution failure');
    mocks.run.mockRejectedValue(error);
    await expect(evalCommand('application.json')).rejects.toBe(error);
    expect(mocks.finish).toHaveBeenCalledWith(expect.any(String), expect.any(String), error);
  });
});
