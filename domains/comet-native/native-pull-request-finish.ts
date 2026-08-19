import { runExternalCommand } from '../../platform/process/external-command.js';
import type { WorkflowNativePullRequestFinishConfig } from '../workflow-contract/types.js';

const GH_TIMEOUT_MS = 60_000;

export interface NativePullRequestRecord {
  number: number;
  url: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  state: 'OPEN';
}

export interface NativePullRequestFinishOutcome {
  provider: 'github-fill' | 'repository-command';
  disposition: 'created' | 'reused';
  pullRequest: NativePullRequestRecord;
  remoteVerified: true;
}

export class NativePullRequestFinishError extends Error {
  constructor(
    message: string,
    readonly pullRequest: NativePullRequestRecord | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'NativePullRequestFinishError';
  }
}

interface ProviderPullRequestRecord {
  number: number;
  url: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
}

interface RepositoryCommandProviderOutput {
  schema: 'comet.native.pull-request-finish-result.v1';
  disposition: 'created' | 'reused';
  remoteVerified: true;
  pullRequest: ProviderPullRequestRecord;
}

function runGh(projectRoot: string, args: readonly string[]): string {
  try {
    return runExternalCommand('gh', args, { cwd: projectRoot, timeoutMs: GH_TIMEOUT_MS }).trim();
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} failed: ${(error as Error).message}`, { cause: error });
  }
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function pullRequestUrl(value: unknown, label: string): string {
  const url = nonEmptyString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`${label} must be an absolute HTTP URL`, { cause: error });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} must be an absolute HTTP URL`);
  }
  return url;
}

function gitObjectId(value: unknown, label: string): string {
  const objectId = nonEmptyString(value, label);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(objectId)) {
    throw new Error(`${label} must be a Git object ID`);
  }
  return objectId.toLowerCase();
}

function ghPullRequestRecord(value: unknown, label: string): NativePullRequestRecord {
  const record = jsonRecord(value, label);
  const state = nonEmptyString(record.state, `${label}.state`);
  if (state !== 'OPEN') throw new Error(`${label}.state must be OPEN`);
  return {
    number: positiveInteger(record.number, `${label}.number`),
    url: pullRequestUrl(record.url, `${label}.url`),
    baseBranch: nonEmptyString(record.baseRefName, `${label}.baseRefName`),
    headBranch: nonEmptyString(record.headRefName, `${label}.headRefName`),
    headSha: gitObjectId(record.headRefOid, `${label}.headRefOid`),
    state: 'OPEN',
  };
}

function providerPullRequestRecord(value: unknown): ProviderPullRequestRecord {
  const record = jsonRecord(value, 'pull request finish provider output.pullRequest');
  return {
    number: positiveInteger(
      record.number,
      'pull request finish provider output.pullRequest.number',
    ),
    url: pullRequestUrl(record.url, 'pull request finish provider output.pullRequest.url'),
    baseBranch: nonEmptyString(
      record.baseBranch,
      'pull request finish provider output.pullRequest.baseBranch',
    ),
    headBranch: nonEmptyString(
      record.headBranch,
      'pull request finish provider output.pullRequest.headBranch',
    ),
    headSha: gitObjectId(record.headSha, 'pull request finish provider output.pullRequest.headSha'),
  };
}

function parseRepositoryCommandOutput(source: string): RepositoryCommandProviderOutput {
  const output = jsonRecord(
    parseJson(source, 'pull request finish provider output'),
    'pull request finish provider output',
  );
  if (output.schema !== 'comet.native.pull-request-finish-result.v1') {
    throw new Error(
      'pull request finish provider output.schema must be comet.native.pull-request-finish-result.v1',
    );
  }
  if (output.disposition !== 'created' && output.disposition !== 'reused') {
    throw new Error('pull request finish provider output.disposition must be created or reused');
  }
  if (output.remoteVerified !== true) {
    throw new Error(
      'pull request finish provider did not confirm repository-owned remote verification',
    );
  }
  const pullRequest = providerPullRequestRecord(output.pullRequest);
  return {
    schema: 'comet.native.pull-request-finish-result.v1',
    disposition: output.disposition,
    remoteVerified: true,
    pullRequest,
  };
}

export function observeNativePullRequest(options: {
  projectRoot: string;
  baseBranch: string;
  headBranch: string;
}): NativePullRequestRecord | null {
  const output = runGh(options.projectRoot, [
    'pr',
    'list',
    '--state',
    'open',
    '--base',
    options.baseBranch,
    '--head',
    options.headBranch,
    '--limit',
    '2',
    '--json',
    'number,url,baseRefName,headRefName,headRefOid,state',
  ]);
  const parsed = parseJson(output, 'gh pr list output');
  if (!Array.isArray(parsed)) throw new Error('gh pr list output must be a JSON array');
  if (parsed.length > 1) {
    throw new Error(
      `Multiple open pull requests match ${options.headBranch} -> ${options.baseBranch}`,
    );
  }
  return parsed.length === 0 ? null : ghPullRequestRecord(parsed[0], 'gh pr list output[0]');
}

function verifyNativePullRequest(options: {
  projectRoot: string;
  pullRequest: ProviderPullRequestRecord | NativePullRequestRecord;
  baseBranch: string;
  headBranch: string;
  headSha: string;
}): NativePullRequestRecord {
  const output = runGh(options.projectRoot, [
    'pr',
    'view',
    String(options.pullRequest.number),
    '--json',
    'number,url,baseRefName,headRefName,headRefOid,state',
  ]);
  const remote = ghPullRequestRecord(parseJson(output, 'gh pr view output'), 'gh pr view output');
  const expectedSha = gitObjectId(options.headSha, 'Native Archive head SHA');
  if (remote.number !== options.pullRequest.number || remote.url !== options.pullRequest.url) {
    throw new NativePullRequestFinishError(
      'Pull request provider result does not match the pull request observed from GitHub',
      remote,
    );
  }
  if (remote.baseBranch !== options.baseBranch) {
    throw new NativePullRequestFinishError(
      `Pull request base branch mismatch: expected ${options.baseBranch}, got ${remote.baseBranch}`,
      remote,
    );
  }
  if (remote.headBranch !== options.headBranch) {
    throw new NativePullRequestFinishError(
      `Pull request head branch mismatch: expected ${options.headBranch}, got ${remote.headBranch}`,
      remote,
    );
  }
  if (remote.headSha !== expectedSha) {
    throw new NativePullRequestFinishError(
      `Pull request head SHA mismatch: expected ${expectedSha}, got ${remote.headSha}`,
      remote,
    );
  }
  return remote;
}

function bestEffortObserve(options: {
  projectRoot: string;
  baseBranch: string;
  headBranch: string;
}): NativePullRequestRecord | null {
  try {
    return observeNativePullRequest(options);
  } catch {
    return null;
  }
}

function providerInput(options: {
  projectRoot: string;
  changeName: string;
  transactionId: string;
  remote: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  existingPullRequest: NativePullRequestRecord | null;
}): string {
  return JSON.stringify(
    {
      schema: 'comet.native.pull-request-finish-input.v1',
      projectRoot: options.projectRoot,
      change: {
        name: options.changeName,
        branch: options.headBranch,
        headSha: options.headSha,
      },
      target: { branch: options.baseBranch },
      remote: options.remote,
      transactionId: options.transactionId,
      existingPullRequest: options.existingPullRequest,
    },
    null,
    2,
  );
}

function createWithGithubFill(options: {
  projectRoot: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  existingPullRequest: NativePullRequestRecord | null;
}): NativePullRequestFinishOutcome {
  let pullRequest = options.existingPullRequest;
  let disposition: 'created' | 'reused' = pullRequest ? 'reused' : 'created';
  if (!pullRequest) {
    try {
      const output = runGh(options.projectRoot, [
        'pr',
        'create',
        '--base',
        options.baseBranch,
        '--head',
        options.headBranch,
        '--fill',
      ]);
      const url = output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => /^https?:\/\//u.test(line));
      if (!url) throw new Error('GitHub CLI did not return a pull request URL');
      pullRequest = observeNativePullRequest(options);
      if (!pullRequest) {
        throw new Error('GitHub CLI created a pull request that could not be observed uniquely');
      }
      if (pullRequest.url !== url) {
        throw new NativePullRequestFinishError(
          'GitHub CLI returned a pull request URL that does not match the remotely observed pull request',
          pullRequest,
        );
      }
    } catch (error) {
      if (error instanceof NativePullRequestFinishError) throw error;
      const recovered = bestEffortObserve(options);
      if (!recovered) {
        throw new NativePullRequestFinishError((error as Error).message, null, { cause: error });
      }
      pullRequest = recovered;
      disposition = 'reused';
    }
  }
  let verified: NativePullRequestRecord;
  try {
    verified = verifyNativePullRequest({ ...options, pullRequest });
  } catch (error) {
    if (error instanceof NativePullRequestFinishError) throw error;
    throw new NativePullRequestFinishError(
      `Final GitHub pull request verification failed: ${(error as Error).message}`,
      pullRequest,
      { cause: error },
    );
  }
  return {
    provider: 'github-fill',
    disposition,
    pullRequest: verified,
    remoteVerified: true,
  };
}

function createWithRepositoryCommand(options: {
  projectRoot: string;
  changeName: string;
  transactionId: string;
  remote: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  existingPullRequest: NativePullRequestRecord | null;
  config: WorkflowNativePullRequestFinishConfig;
}): NativePullRequestFinishOutcome {
  const [command, ...args] = options.config.command;
  let output: RepositoryCommandProviderOutput;
  try {
    const stdout = runExternalCommand(command, args, {
      cwd: options.projectRoot,
      timeoutMs: options.config.timeout_ms,
      input: `${providerInput(options)}\n`,
    }).trim();
    output = parseRepositoryCommandOutput(stdout);
  } catch (error) {
    if (error instanceof NativePullRequestFinishError) throw error;
    const recovered = bestEffortObserve(options) ?? options.existingPullRequest;
    throw new NativePullRequestFinishError(
      `Repository pull request finish provider failed: ${(error as Error).message}`,
      recovered,
      { cause: error },
    );
  }
  const providerRecord = { ...output.pullRequest, state: 'OPEN' as const };
  if (
    providerRecord.baseBranch !== options.baseBranch ||
    providerRecord.headBranch !== options.headBranch ||
    providerRecord.headSha !== gitObjectId(options.headSha, 'Native Archive head SHA')
  ) {
    const recovered = bestEffortObserve(options) ?? options.existingPullRequest;
    throw new NativePullRequestFinishError(
      'Repository pull request finish provider returned a pull request outside the authorized base, head, or head SHA',
      recovered,
    );
  }
  let verified: NativePullRequestRecord;
  try {
    verified = verifyNativePullRequest({ ...options, pullRequest: providerRecord });
  } catch (error) {
    if (error instanceof NativePullRequestFinishError) throw error;
    const recovered = bestEffortObserve(options) ?? options.existingPullRequest ?? providerRecord;
    throw new NativePullRequestFinishError(
      `Final repository pull request verification failed: ${(error as Error).message}`,
      recovered,
      { cause: error },
    );
  }
  return {
    provider: 'repository-command',
    disposition: output.disposition,
    pullRequest: verified,
    remoteVerified: true,
  };
}

export function finishNativePullRequest(options: {
  projectRoot: string;
  changeName: string;
  transactionId: string;
  remote: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  config: WorkflowNativePullRequestFinishConfig | null;
}): NativePullRequestFinishOutcome {
  const existingPullRequest = observeNativePullRequest(options);
  if (!options.config) {
    return createWithGithubFill({ ...options, existingPullRequest });
  }
  return createWithRepositoryCommand({ ...options, existingPullRequest, config: options.config });
}
