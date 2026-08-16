import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => ({ runExternalCommand: vi.fn() }));
vi.mock('../../../platform/process/external-command.js', () => external);

import {
  finishNativePullRequest,
  NativePullRequestFinishError,
} from '../../../domains/comet-native/native-pull-request-finish.js';

const projectRoot = path.join(os.tmpdir(), 'native-pull-request-finish-test');
const headSha = 'a'.repeat(40);
const pullRequest = {
  number: 17,
  url: 'https://github.com/example/repo/pull/17',
  baseRefName: 'main',
  headRefName: 'comet/change',
  headRefOid: headSha,
  state: 'OPEN',
};

function ghJson(value: unknown): string {
  return JSON.stringify(value);
}

function options() {
  return {
    projectRoot,
    changeName: 'example',
    transactionId: 'tx-17',
    remote: 'origin',
    baseBranch: 'main',
    headBranch: 'comet/change',
    headSha,
    config: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Native pull request finish', () => {
  it('keeps github-fill as the default and verifies the created pull request remotely', () => {
    let listCalls = 0;
    external.runExternalCommand.mockImplementation((command: string, args: readonly string[]) => {
      expect(command).toBe('gh');
      if (args[1] === 'list') {
        listCalls += 1;
        return listCalls === 1 ? '[]' : ghJson([pullRequest]);
      }
      if (args[1] === 'create') return `${pullRequest.url}\n`;
      if (args[1] === 'view') return ghJson(pullRequest);
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    });

    expect(finishNativePullRequest(options())).toMatchObject({
      provider: 'github-fill',
      disposition: 'created',
      remoteVerified: true,
      pullRequest: {
        number: 17,
        url: pullRequest.url,
        baseBranch: 'main',
        headBranch: 'comet/change',
        headSha,
      },
    });
  });

  it('reuses an existing pull request without issuing a second create call', () => {
    external.runExternalCommand.mockImplementation((_command: string, args: readonly string[]) => {
      if (args[1] === 'list') return ghJson([pullRequest]);
      if (args[1] === 'view') return ghJson(pullRequest);
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    });

    expect(finishNativePullRequest(options())).toMatchObject({
      provider: 'github-fill',
      disposition: 'reused',
      pullRequest: { number: 17 },
    });
    expect(external.runExternalCommand).not.toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['create']),
      expect.anything(),
    );
  });

  it('preserves an observed pull request when final GitHub verification is temporarily unavailable', () => {
    external.runExternalCommand.mockImplementation((_command: string, args: readonly string[]) => {
      if (args[1] === 'list') return ghJson([pullRequest]);
      if (args[1] === 'view') throw new Error('temporary GitHub failure');
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    });

    let caught: unknown;
    try {
      finishNativePullRequest(options());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NativePullRequestFinishError);
    expect(caught).toMatchObject({
      message: expect.stringContaining('Final GitHub pull request verification failed'),
      pullRequest: { number: 17, url: pullRequest.url },
      cause: expect.any(Error),
    });
  });

  it('passes versioned JSON to a repository command and verifies its result independently', () => {
    external.runExternalCommand.mockImplementation(
      (command: string, args: readonly string[], run) => {
        if (command === 'gh' && args[1] === 'list') return ghJson([pullRequest]);
        if (command === 'gh' && args[1] === 'view') return ghJson(pullRequest);
        if (command === 'pwsh') {
          const input = JSON.parse(run.input) as Record<string, unknown>;
          expect(input).toMatchObject({
            schema: 'comet.native.pull-request-finish-input.v1',
            projectRoot,
            change: { name: 'example', branch: 'comet/change', headSha },
            target: { branch: 'main' },
            remote: 'origin',
            transactionId: 'tx-17',
            existingPullRequest: { number: 17, url: pullRequest.url },
          });
          return ghJson({
            schema: 'comet.native.pull-request-finish-result.v1',
            disposition: 'reused',
            remoteVerified: true,
            pullRequest: {
              number: 17,
              url: pullRequest.url,
              baseBranch: 'main',
              headBranch: 'comet/change',
              headSha,
            },
          });
        }
        throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
      },
    );

    expect(
      finishNativePullRequest({
        ...options(),
        config: {
          provider: 'repository-command',
          command: ['pwsh', '-NoProfile', '-File', 'scripts/comet-create-pr.ps1'],
          timeout_ms: 120_000,
        },
      }),
    ).toMatchObject({
      provider: 'repository-command',
      disposition: 'reused',
      remoteVerified: true,
      pullRequest: { number: 17 },
    });
    expect(external.runExternalCommand).toHaveBeenCalledWith(
      'pwsh',
      ['-NoProfile', '-File', 'scripts/comet-create-pr.ps1'],
      expect.objectContaining({ cwd: projectRoot, timeoutMs: 120_000, input: expect.any(String) }),
    );
  });

  it('preserves an authorized provider pull request when final verification is temporarily unavailable', () => {
    let listCalls = 0;
    external.runExternalCommand.mockImplementation((command: string, args: readonly string[]) => {
      if (command === 'gh' && args[1] === 'list') {
        listCalls += 1;
        if (listCalls === 1) return '[]';
        throw new Error('temporary GitHub list failure');
      }
      if (command === 'gh' && args[1] === 'view') {
        throw new Error('temporary GitHub view failure');
      }
      if (command === 'pwsh') {
        return ghJson({
          schema: 'comet.native.pull-request-finish-result.v1',
          disposition: 'created',
          remoteVerified: true,
          pullRequest: {
            number: 17,
            url: pullRequest.url,
            baseBranch: 'main',
            headBranch: 'comet/change',
            headSha,
          },
        });
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });

    let caught: unknown;
    try {
      finishNativePullRequest({
        ...options(),
        config: {
          provider: 'repository-command',
          command: ['pwsh', '-File', 'scripts/comet-create-pr.ps1'],
          timeout_ms: 120_000,
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NativePullRequestFinishError);
    expect(caught).toMatchObject({
      message: expect.stringContaining('Final repository pull request verification failed'),
      pullRequest: { number: 17, url: pullRequest.url },
      cause: expect.any(Error),
    });
  });

  it('preserves an observed pull request when repository verification fails', () => {
    external.runExternalCommand.mockImplementation((command: string, args: readonly string[]) => {
      if (command === 'gh' && args[1] === 'list') return ghJson([pullRequest]);
      if (command === 'pwsh') {
        return ghJson({
          schema: 'comet.native.pull-request-finish-result.v1',
          disposition: 'reused',
          remoteVerified: false,
          pullRequest: {
            number: 17,
            url: pullRequest.url,
            baseBranch: 'main',
            headBranch: 'comet/change',
            headSha,
          },
        });
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });

    let caught: unknown;
    try {
      finishNativePullRequest({
        ...options(),
        config: {
          provider: 'repository-command',
          command: ['pwsh', '-File', 'scripts/comet-create-pr.ps1'],
          timeout_ms: 120_000,
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NativePullRequestFinishError);
    expect(caught).toMatchObject({ pullRequest: { number: 17, url: pullRequest.url } });
  });

  it('does not expose an unverified provider pull request record', () => {
    external.runExternalCommand.mockImplementation((command: string, args: readonly string[]) => {
      if (command === 'gh' && args[1] === 'list') return '[]';
      if (command === 'pwsh') {
        return ghJson({
          schema: 'comet.native.pull-request-finish-result.v1',
          disposition: 'created',
          remoteVerified: false,
          pullRequest: {
            number: 99,
            url: 'https://attacker.example/pull/99',
            baseBranch: 'main',
            headBranch: 'comet/change',
            headSha,
          },
        });
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });

    let caught: unknown;
    try {
      finishNativePullRequest({
        ...options(),
        config: {
          provider: 'repository-command',
          command: ['pwsh', '-File', 'scripts/comet-create-pr.ps1'],
          timeout_ms: 120_000,
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NativePullRequestFinishError);
    expect(caught).toMatchObject({ pullRequest: null });
  });

  it('fails closed when github create output disagrees with the observed pull request URL', () => {
    const observed = {
      ...pullRequest,
      number: 18,
      url: 'https://github.com/example/repo/pull/18',
    };
    let listCalls = 0;
    external.runExternalCommand.mockImplementation((_command: string, args: readonly string[]) => {
      if (args[1] === 'list') {
        listCalls += 1;
        return listCalls === 1 ? '[]' : ghJson([observed]);
      }
      if (args[1] === 'create') return `${pullRequest.url}\n`;
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    });

    let caught: unknown;
    try {
      finishNativePullRequest(options());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NativePullRequestFinishError);
    expect(caught).toMatchObject({ pullRequest: { number: 18, url: observed.url } });
    expect(caught).toHaveProperty(
      'message',
      'GitHub CLI returned a pull request URL that does not match the remotely observed pull request',
    );
  });

  it('rejects Git object IDs whose length is neither SHA-1 nor SHA-256', () => {
    external.runExternalCommand.mockImplementation((command: string, args: readonly string[]) => {
      if (command === 'gh' && args[1] === 'list') return '[]';
      if (command === 'pwsh') {
        return ghJson({
          schema: 'comet.native.pull-request-finish-result.v1',
          disposition: 'created',
          remoteVerified: true,
          pullRequest: {
            number: 17,
            url: pullRequest.url,
            baseBranch: 'main',
            headBranch: 'comet/change',
            headSha: 'a'.repeat(41),
          },
        });
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });

    expect(() =>
      finishNativePullRequest({
        ...options(),
        config: {
          provider: 'repository-command',
          command: ['pwsh', '-File', 'scripts/comet-create-pr.ps1'],
          timeout_ms: 120_000,
        },
      }),
    ).toThrow(/Git object ID/u);
  });

  it('fails closed when the remote pull request points at another head SHA', () => {
    external.runExternalCommand.mockImplementation((_command: string, args: readonly string[]) => {
      if (args[1] === 'list') return ghJson([pullRequest]);
      if (args[1] === 'view') return ghJson({ ...pullRequest, headRefOid: 'b'.repeat(40) });
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    });

    expect(() => finishNativePullRequest(options())).toThrow(/head SHA mismatch/u);
  });
});
