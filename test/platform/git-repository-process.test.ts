import { execFile } from 'node:child_process';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectGitRepository } from '../../platform/process/git-repository.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

type ExecCallback = (
  error: (Error & { code?: number | string; killed?: boolean }) | null,
  stdout: string,
  stderr: string,
) => void;

const mockedExecFile = vi.mocked(execFile);

function installSuccessfulGitMock(repositoryRoot: string): void {
  mockedExecFile.mockImplementation((...rawArguments: unknown[]) => {
    const argv = rawArguments[1] as string[];
    const callback = rawArguments[3] as ExecCallback;
    if (argv.includes('rev-parse')) {
      callback(null, `true\n${repositoryRoot}\n${path.join(repositoryRoot, '.git')}\n\n`, '');
    } else {
      callback(null, '# branch.oid abc123\0# branch.head main\0? nested/new.txt\0', '');
    }
    return {} as ReturnType<typeof execFile>;
  });
}

describe('inspectGitRepository process boundary', () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it('uses structured argv, shell false, timeout, output limit, and read-only Git settings', async () => {
    const projectRoot = path.resolve('workspace with spaces');
    const repositoryRoot = path.resolve('repository root');
    installSuccessfulGitMock(repositoryRoot);

    const inspection = await inspectGitRepository(projectRoot, {
      timeoutMs: 17,
      maxOutputBytes: 23,
    });

    expect(inspection.available).toBe(true);
    expect(mockedExecFile).toHaveBeenCalledTimes(2);
    for (const call of mockedExecFile.mock.calls) {
      expect(call[0]).toBe('git');
      expect(call[1]).toEqual(expect.arrayContaining(['-C', projectRoot]));
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[2]).toEqual(
        expect.objectContaining({
          shell: false,
          timeout: 17,
          maxBuffer: 23,
          windowsHide: true,
          env: expect.objectContaining({
            GIT_OPTIONAL_LOCKS: '0',
            GIT_TERMINAL_PROMPT: '0',
          }),
        }),
      );
    }
  });

  it.each([
    [{ code: 'ETIMEDOUT', killed: true }, 'timeout'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'output-limit'],
    [{ code: 'ENOENT' }, 'git-unavailable'],
  ] as const)('classifies process failure %j as %s', async (properties, expectedKind) => {
    mockedExecFile.mockImplementation((...rawArguments: unknown[]) => {
      const callback = rawArguments[3] as ExecCallback;
      callback(Object.assign(new Error(expectedKind), properties), '', '');
      return {} as ReturnType<typeof execFile>;
    });

    const inspection = await inspectGitRepository(path.resolve('project'));

    expect(inspection).toEqual({
      available: false,
      head: null,
      branch: null,
      worktreeRoot: null,
      commonDir: null,
      changedPaths: null,
      failure: {
        kind: expectedKind,
        operation: 'discovery',
      },
    });
  });

  it('does not expose partial facts when status fails', async () => {
    const repositoryRoot = path.resolve('repository root');
    mockedExecFile.mockImplementation((...rawArguments: unknown[]) => {
      const argv = rawArguments[1] as string[];
      const callback = rawArguments[3] as ExecCallback;
      if (argv.includes('rev-parse')) {
        callback(null, `true\n${repositoryRoot}\n${path.join(repositoryRoot, '.git')}\n\n`, '');
      } else {
        callback(Object.assign(new Error('status failed'), { code: 2 }), '', 'fatal');
      }
      return {} as ReturnType<typeof execFile>;
    });

    const inspection = await inspectGitRepository(path.resolve('project'));

    expect(inspection).toEqual({
      available: false,
      head: null,
      branch: null,
      worktreeRoot: null,
      commonDir: null,
      changedPaths: null,
      failure: {
        kind: 'command-failed',
        operation: 'status',
      },
    });
  });
});
