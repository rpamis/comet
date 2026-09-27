import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function remoteUrl(projectRoot: string, remote: string, push: boolean): string {
  const value = execFileSync('git', ['remote', 'get-url', ...(push ? ['--push'] : []), remote], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!value) throw new Error('Classic delivery remote URL is empty');
  let parsed: URL | null = null;
  try {
    parsed = new URL(value);
  } catch {
    // SCP-style SSH and local paths are valid Git remote forms.
  }
  if (
    parsed &&
    (parsed.password ||
      parsed.search ||
      parsed.hash ||
      (['http:', 'https:'].includes(parsed.protocol) && parsed.username))
  ) {
    throw new Error('Classic delivery remote must not contain credentials');
  }
  return value;
}

/** Bind a Git remote without persisting a possibly private URL in the SDK Run. */
export function classicSdkRemoteIdentity(projectRoot: string, remote: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(remote)) {
    throw new Error('Classic delivery remote must be a configured remote name');
  }
  const fetch = remoteUrl(projectRoot, remote, false);
  const push = remoteUrl(projectRoot, remote, true);
  if (fetch !== push) throw new Error('Classic delivery remote has different fetch and push URLs');
  return createHash('sha256').update(fetch).digest('hex');
}

/** A read-only remote check; a missing or unavailable ref never authorizes another push. */
export function classicSdkRemoteBranchHead(
  projectRoot: string,
  remote: string,
  targetBranch: string,
): string | null {
  const ref = `refs/heads/${targetBranch}`;
  const output = execFileSync(
    'git',
    [
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.https.allow=always',
      '-c',
      'protocol.ssh.allow=always',
      '-c',
      'protocol.file.allow=always',
      'ls-remote',
      '--refs',
      remote,
      ref,
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  ).trim();
  const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/u.exec(output);
  return match?.[2] === ref ? match[1] : null;
}

function repositoryFromRemote(value: string): string | null {
  const scp = /^git@([^:/]+):([^/]+\/[^/]+)$/u.exec(value);
  try {
    const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : value);
    if (
      !['https:', 'ssh:'].includes(url.protocol) ||
      url.password ||
      url.search ||
      url.hash ||
      url.port ||
      (url.protocol === 'https:' && url.username)
    ) {
      return null;
    }
    const segments = url.pathname
      .replace(/\.git\/?$/u, '')
      .replace(/\/$/u, '')
      .split('/')
      .filter(Boolean);
    if (segments.length !== 2 || segments.some((part) => !/^[a-zA-Z0-9_.-]+$/u.test(part))) {
      return null;
    }
    return `${url.hostname}/${segments.join('/')}`.toLowerCase();
  } catch {
    return null;
  }
}

function verifiedPrUrl(value: string, repository: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/u.exec(url.pathname);
    return match && `${url.hostname}/${match[1]}/${match[2]}`.toLowerCase() === repository
      ? `https://${url.hostname}/${match[1]}/${match[2]}/pull/${match[3]}`
      : null;
  } catch {
    return null;
  }
}

/** Query the hosting provider; a caller-provided PR URL alone is never delivery evidence. */
export function classicSdkPullRequestMatches(input: {
  projectRoot: string;
  remote: string;
  prUrl: string;
  targetBranch: string;
  commit: string;
  baseBranch: string;
}): boolean {
  const repository = repositoryFromRemote(remoteUrl(input.projectRoot, input.remote, false));
  const canonicalUrl = repository && verifiedPrUrl(input.prUrl, repository);
  if (!repository || !canonicalUrl) return false;
  const result = execFileSync(
    'gh',
    [
      'pr',
      'view',
      canonicalUrl,
      '--repo',
      repository,
      '--json',
      'url,headRefName,headRefOid,baseRefName,state',
    ],
    {
      cwd: input.projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
    },
  );
  const pr = JSON.parse(result) as Record<string, unknown>;
  return (
    typeof pr.url === 'string' &&
    verifiedPrUrl(pr.url, repository) === canonicalUrl &&
    pr.headRefName === input.targetBranch &&
    pr.headRefOid === input.commit &&
    pr.baseRefName === input.baseBranch &&
    (pr.state === 'OPEN' || pr.state === 'MERGED')
  );
}
