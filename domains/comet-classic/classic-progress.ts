import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { independentGitEnvironment } from '../../platform/process/git-environment.js';
import { classicTaskRevision, parseClassicTasks } from './classic-tasks.js';
import type { ClassicState } from './classic-state.js';
import {
  classicProjectTargetExists,
  ensureClassicProjectDirectory,
  inspectClassicProjectTarget,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';

const MAX_BYTES = 64 * 1024;
const STAGES = ['implementing', 'task-review', 'checkoff', 'done', 'blocked'] as const;

export interface ClassicCheckpoint {
  schemaVersion: 1;
  taskIds: string[];
  revision: string;
  stage: (typeof STAGES)[number];
  sessionId: string;
  evidence: string[];
  unresolved: string[];
  reviewRounds: number;
}

export interface ClassicDeliveryInput {
  action: 'local' | 'push' | 'pr';
  targetBranch: string;
  remote?: string;
  commit?: string;
  prUrl?: string;
}

export interface ClassicDelivery extends ClassicDeliveryInput {
  schemaVersion: 1;
  changeIdentity: string;
  authorizedRemoteUrl?: string;
  authorizationId: string;
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Classic progress requires a JSON object');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_BYTES)
    throw new Error('Classic progress exceeds size limit');
  return input as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unknown Classic progress field');
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error(`Invalid Classic progress ${label}`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error(`Invalid Classic progress ${label}`);
  return value.map((item) => text(item, label));
}

function checkpoint(input: unknown): ClassicCheckpoint {
  const value = object(input);
  keys(value, [
    'schemaVersion',
    'taskIds',
    'revision',
    'stage',
    'sessionId',
    'evidence',
    'unresolved',
    'reviewRounds',
  ]);
  if (value.schemaVersion !== 1) throw new Error('Unsupported Classic checkpoint schemaVersion');
  const taskIds = strings(value.taskIds, 'taskIds');
  if (
    !taskIds.length ||
    new Set(taskIds).size !== taskIds.length ||
    taskIds.some((id) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(id))
  )
    throw new Error('Classic checkpoint taskIds must be unique stable IDs');
  if (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision))
    throw new Error('Invalid Classic checkpoint revision');
  if (!STAGES.includes(value.stage as ClassicCheckpoint['stage']))
    throw new Error('Invalid Classic checkpoint stage');
  if (!Number.isSafeInteger(value.reviewRounds) || (value.reviewRounds as number) < 0)
    throw new Error('Invalid Classic checkpoint reviewRounds');
  return {
    schemaVersion: 1,
    taskIds,
    revision: value.revision,
    stage: value.stage as ClassicCheckpoint['stage'],
    sessionId: text(value.sessionId, 'sessionId'),
    evidence: strings(value.evidence, 'evidence'),
    unresolved: strings(value.unresolved, 'unresolved'),
    reviewRounds: value.reviewRounds as number,
  };
}

async function readRecord(root: string, changeDir: string, filename: string): Promise<unknown> {
  const target = path.join(changeDir, '.comet', filename);
  if (
    !(await classicProjectTargetExists(root, target, {
      label: 'Classic progress',
      expected: 'file',
    }))
  )
    return undefined;
  return JSON.parse(
    await readClassicProjectFile(root, target, { label: 'Classic progress', maxBytes: MAX_BYTES }),
  );
}

export async function readClassicCheckpoint(root: string, changeDir: string, tasksSource: string) {
  const raw = await readRecord(root, changeDir, 'coordination.json');
  if (raw === undefined) return { checkpoint: null, stale: false };
  const record = checkpoint(raw);
  const ids = new Set(parseClassicTasks(tasksSource).map((task) => task.id));
  return {
    checkpoint: record,
    stale:
      record.revision !== classicTaskRevision(tasksSource) ||
      record.taskIds.some((id) => !ids.has(id)),
  };
}

/** Caller holds the Classic state lock. JSON is authoritative; Markdown is a projection. */
export async function writeClassicCheckpoint(
  root: string,
  changeDir: string,
  input: unknown,
  tasksSource: string,
) {
  const record = checkpoint(input);
  const tasks = parseClassicTasks(tasksSource);
  if (record.revision !== classicTaskRevision(tasksSource))
    throw new Error('Classic checkpoint revision is stale');
  if (record.taskIds.some((id) => !tasks.some((task) => task.id === id)))
    throw new Error('Unknown Classic checkpoint task ID');
  const previous = (await readClassicCheckpoint(root, changeDir, tasksSource)).checkpoint;
  if (
    previous &&
    previous.revision === record.revision &&
    previous.taskIds.length === record.taskIds.length &&
    previous.taskIds.every((id) => record.taskIds.includes(id)) &&
    record.reviewRounds < previous.reviewRounds
  )
    throw new Error('Classic checkpoint reviewRounds cannot decrease for the same work package');
  const dir = path.join(changeDir, '.comet');
  await ensureClassicProjectDirectory(root, dir, 'Classic progress directory');
  await inspectClassicProjectTarget(root, path.join(dir, 'subagent-progress.md'), {
    label: 'Classic checkpoint projection',
    expected: 'file',
  });
  await writeClassicProjectText(
    root,
    path.join(dir, 'coordination.json'),
    JSON.stringify(record, null, 2) + '\n',
    { label: 'Classic checkpoint' },
  );
  const display = (value: string) =>
    value.replace(
      /[&<>]/gu,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!,
    );
  await writeClassicProjectText(
    root,
    path.join(dir, 'subagent-progress.md'),
    [
      '# Classic Coordination Checkpoint',
      '',
      'Generated from coordination.json; tasks.md remains the completion authority.',
      '',
      `Stage: ${record.stage}`,
      `Tasks: ${record.taskIds.join(', ')}`,
      `Revision: ${record.revision}`,
      `Session: ${display(record.sessionId)}`,
      `Review rounds: ${record.reviewRounds}`,
      '',
      '## Evidence',
      ...record.evidence.map((item) => `- ${display(item)}`),
      '',
      '## Unresolved',
      ...record.unresolved.map((item) => `- ${display(item)}`),
      '',
    ].join('\n'),
    { label: 'Classic checkpoint projection' },
  );
  return { checkpoint: record, stale: false };
}

function deliveryInput(input: unknown, persisted = false): ClassicDeliveryInput {
  const value = object(input);
  keys(value, [
    'action',
    'targetBranch',
    'remote',
    'commit',
    'prUrl',
    ...(persisted
      ? ['schemaVersion', 'changeIdentity', 'authorizedRemoteUrl', 'authorizationId']
      : []),
  ]);
  if (!['local', 'push', 'pr'].includes(value.action as string))
    throw new Error('Invalid Classic delivery action');
  const targetBranch = text(value.targetBranch, 'targetBranch');
  if (
    targetBranch.startsWith('-') ||
    /[~^:?*[\\\s]/u.test(targetBranch) ||
    targetBranch.includes('..') ||
    targetBranch.includes('@{')
  )
    throw new Error('Invalid Classic delivery targetBranch');
  const record: ClassicDeliveryInput = {
    action: value.action as ClassicDeliveryInput['action'],
    targetBranch,
  };
  if (value.remote !== undefined) {
    const remote = text(value.remote, 'remote');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(remote))
      throw new Error('Classic delivery remote must be a name, not a URL');
    record.remote = remote;
  }
  if (value.commit !== undefined) {
    const commit = text(value.commit, 'commit');
    if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(commit))
      throw new Error('Classic delivery commit must be a full object ID');
    record.commit = commit.toLowerCase();
  }
  if (value.prUrl !== undefined) {
    const prUrl = text(value.prUrl, 'prUrl');
    const url = new URL(prUrl);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Invalid Classic delivery prUrl');
    record.prUrl = prUrl;
  }
  return record;
}

function stateObject(source: string): Record<string, unknown> {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid Classic delivery change state');
  return object(document.toJS());
}

function identity(state: Record<string, unknown>, changeDir: string): string {
  if (typeof state.run_id === 'string' && state.run_id) return `run:${state.run_id}`;
  // Legacy authorization is explicit, and survives the dated archive directory move.
  const name =
    state.archived === true
      ? path.basename(changeDir).replace(/^\d{4}-\d{2}-\d{2}-/u, '')
      : path.basename(changeDir);
  if (typeof state.created_at !== 'string' || typeof state.base_ref !== 'string')
    throw new Error('Classic delivery requires stable change identity');
  return `legacy:${createHash('sha256')
    .update(JSON.stringify([name, state.created_at, state.base_ref]))
    .digest('hex')}`;
}

async function currentState(root: string, changeDir: string) {
  return stateObject(
    await readClassicProjectFile(root, path.join(changeDir, '.comet.yaml'), {
      label: 'Classic delivery state',
      maxBytes: MAX_BYTES,
    }),
  );
}

function readCommand(
  root: string,
  command: string,
  args: string[],
  authentication = false,
): string | null {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: MAX_BYTES,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...independentGitEnvironment(),
        ...(authentication
          ? {}
          : {
              GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
              GIT_CONFIG_NOSYSTEM: '1',
            }),
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        SSH_ASKPASS_REQUIRE: 'never',
        GIT_NO_REPLACE_OBJECTS: '1',
        GH_PROMPT_DISABLED: '1',
      },
    }).trim();
  } catch {
    return null;
  }
}

function localGit(root: string, args: string[]): string | null {
  return readCommand(root, 'git', ['-C', root, ...args]);
}

function remoteUrl(root: string, remote: string, push = false): string | null {
  return readCommand(
    root,
    'git',
    ['-C', root, 'remote', 'get-url', ...(push ? ['--push'] : []), remote],
    true,
  );
}

function archiveCommitMatches(
  root: string,
  changeDir: string,
  commit: string,
  changeIdentity: string,
): boolean {
  const relative = path.relative(root, changeDir).replaceAll('\\', '/');
  const archivePaths = [
    `:(literal)${relative}`,
    ...['.comet-state.lock', '.comet-state-transaction.json'].map(
      (file) => `:(exclude,literal)${relative}/${file}`,
    ),
  ];
  const source = localGit(root, ['show', `${commit}:${relative}/.comet.yaml`]);
  if (!source) return false;
  try {
    const committed = stateObject(source);
    return (
      committed.archived === true &&
      identity(committed, changeDir) === changeIdentity &&
      localGit(root, ['merge-base', '--is-ancestor', commit, 'HEAD']) !== null &&
      localGit(root, [
        'diff',
        '--quiet',
        '--no-ext-diff',
        '--no-textconv',
        commit,
        '--',
        ...archivePaths,
      ]) !== null &&
      localGit(root, ['ls-files', '--others', '--exclude-standard', '--', ...archivePaths]) === ''
    );
  } catch {
    return false;
  }
}

interface DeliveryReceipt {
  schemaVersion: 1;
  changeIdentity: string;
  authorizationId: string;
  invalidated?: boolean;
  commit?: string;
  prUrl?: string;
}

function receiptLocations(root: string, changeIdentity: string) {
  const filename = `${createHash('sha256').update(changeIdentity).digest('hex')}.json`;
  const common = localGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return [
    { root, file: path.join(root, '.comet', 'classic-deliveries', filename) },
    ...(common
      ? [{ root: common, file: path.join(common, 'comet', 'classic-deliveries', filename) }]
      : []),
  ];
}

async function readReceipt(root: string, changeIdentity: string): Promise<DeliveryReceipt | null> {
  let receipt: DeliveryReceipt | null = null;
  for (const location of receiptLocations(root, changeIdentity)) {
    if (
      !(await classicProjectTargetExists(location.root, location.file, {
        label: 'Classic delivery receipt',
        expected: 'file',
      }))
    )
      continue;
    const value = object(
      JSON.parse(
        await readClassicProjectFile(location.root, location.file, {
          label: 'Classic delivery receipt',
          maxBytes: MAX_BYTES,
        }),
      ),
    );
    keys(value, [
      'schemaVersion',
      'changeIdentity',
      'authorizationId',
      'invalidated',
      'commit',
      'prUrl',
    ]);
    if (value.schemaVersion !== 1 || value.changeIdentity !== changeIdentity)
      throw new Error('Invalid Classic delivery receipt schema or identity');
    if (value.invalidated !== undefined && typeof value.invalidated !== 'boolean')
      throw new Error('Invalid Classic delivery receipt invalidation');
    const evidence = deliveryInput({
      action: 'local',
      targetBranch: 'main',
      ...(value.commit !== undefined ? { commit: value.commit } : {}),
      ...(value.prUrl !== undefined ? { prUrl: value.prUrl } : {}),
    });
    const next: DeliveryReceipt = {
      schemaVersion: 1,
      changeIdentity,
      authorizationId: text(value.authorizationId, 'authorizationId'),
      ...(value.invalidated === true ? { invalidated: true } : {}),
      ...(evidence.commit ? { commit: evidence.commit } : {}),
      ...(evidence.prUrl ? { prUrl: evidence.prUrl } : {}),
    };
    if (receipt && JSON.stringify(receipt) !== JSON.stringify(next))
      throw new Error('Conflicting Classic delivery receipts');
    receipt = next;
  }
  return receipt;
}

function authorizationId(value: Record<string, unknown>): string {
  // Legacy explicit authorizations get a deterministic generation, not an inferred grant.
  return value.authorizationId === undefined
    ? `legacy:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
    : text(value.authorizationId, 'authorizationId');
}

/** Caller holds the state lock; invalidate before transitioning archive-reopen. */
export async function invalidateClassicDelivery(root: string, changeDir: string): Promise<void> {
  const raw = await readRecord(root, changeDir, 'delivery.json');
  if (raw === undefined) return;
  const value = object(raw);
  if (value.schemaVersion !== 1) throw new Error('Unsupported Classic delivery schemaVersion');
  deliveryInput(value, true);
  const changeIdentity = identity(await currentState(root, changeDir), changeDir);
  if (value.changeIdentity !== changeIdentity)
    throw new Error('Classic delivery change identity mismatch');
  const previous = await readReceipt(root, changeIdentity);
  const id = authorizationId(value);
  if (previous?.authorizationId === id && previous.invalidated) return;
  await writeReceipt(root, {
    schemaVersion: 1,
    changeIdentity,
    authorizationId: id,
    invalidated: true,
  });
}

async function writeReceipt(root: string, receipt: DeliveryReceipt): Promise<void> {
  const locations = receiptLocations(root, receipt.changeIdentity);
  const candidate = locations[0];
  const relative = path.relative(root, candidate.file).replaceAll('\\', '/');
  const ignored =
    localGit(root, ['check-ignore', '--quiet', '--', relative]) !== null &&
    localGit(root, ['ls-files', '--', `:(literal)${relative}`]) === '';
  const location = ignored ? candidate : locations[1];
  if (!location)
    throw new Error('Classic delivery receipt requires ignored runtime storage or Git metadata');
  if (
    !ignored &&
    (await classicProjectTargetExists(root, candidate.file, {
      label: 'Classic delivery receipt',
      expected: 'file',
    }))
  )
    throw new Error(
      'Classic delivery receipt became trackable; restore its runtime ignore rule before updating',
    );
  await ensureClassicProjectDirectory(
    location.root,
    path.dirname(location.file),
    'Classic delivery receipt directory',
  );
  await writeClassicProjectText(
    location.root,
    location.file,
    JSON.stringify(receipt, null, 2) + '\n',
    { label: 'Classic delivery receipt' },
  );
}

function containsCommit(root: string, commit: string, head: string): boolean {
  return commit === head || localGit(root, ['merge-base', '--is-ancestor', commit, head]) !== null;
}

function repositoryFromRemote(remote: string): string | null {
  const scp = /^git@([^:/]+):([^/]+\/[^/]+)$/u.exec(remote);
  try {
    const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : remote);
    if (
      !['https:', 'ssh:'].includes(url.protocol) ||
      url.password ||
      url.search ||
      url.hash ||
      url.port
    )
      return null;
    if (url.protocol === 'https:' && url.username) return null;
    const segments = url.pathname
      .replace(/\.git\/?$/u, '')
      .replace(/\/$/u, '')
      .split('/')
      .filter(Boolean);
    if (segments.length !== 2 || segments.some((segment) => !/^[a-zA-Z0-9_.-]+$/u.test(segment)))
      return null;
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
    )
      return null;
    const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/u.exec(url.pathname);
    return match && `${url.hostname}/${match[1]}/${match[2]}`.toLowerCase() === repository
      ? `https://${url.hostname}/${match[1]}/${match[2]}/pull/${match[3]}`
      : null;
  } catch {
    return null;
  }
}

export async function readClassicDelivery(
  root: string,
  changeDir: string,
  options: { verifyRemote?: boolean } = {},
) {
  const raw = await readRecord(root, changeDir, 'delivery.json');
  if (raw === undefined)
    return { delivery: null, verification: { status: 'needsAuthorization' as const } };
  const value = object(raw);
  if (value.schemaVersion !== 1) throw new Error('Unsupported Classic delivery schemaVersion');
  const input = deliveryInput(value, true);
  const state = await currentState(root, changeDir);
  const changeIdentity = identity(state, changeDir);
  if (value.changeIdentity !== changeIdentity)
    throw new Error('Classic delivery change identity mismatch');
  const id = authorizationId(value);
  const storedReceipt = await readReceipt(root, changeIdentity);
  const receipt = storedReceipt?.authorizationId === id ? storedReceipt : null;
  if (receipt?.invalidated)
    return {
      delivery: null,
      verification: { status: 'needsAuthorization' as const, invalidated: true },
    };
  for (const field of ['commit', 'prUrl'] as const) {
    if (field === 'commit' && receipt?.[field] && input[field] && receipt[field] !== input[field])
      throw new Error('Classic delivery receipt conflicts with authorization evidence');
    if (receipt?.[field]) input[field] = receipt[field];
  }
  const authorizedRemoteUrl =
    value.authorizedRemoteUrl === undefined
      ? undefined
      : text(value.authorizedRemoteUrl, 'authorizedRemoteUrl');
  const delivery: ClassicDelivery = {
    ...input,
    schemaVersion: 1,
    changeIdentity,
    authorizationId: id,
    ...(authorizedRemoteUrl ? { authorizedRemoteUrl } : {}),
  };
  const currentBranch = localGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const relative = path.relative(root, changeDir).replaceAll('\\', '/');
  let observedCommit: string | null = null;
  if (!input.commit && state.archived === true) {
    const history = localGit(root, [
      'log',
      '-20',
      '--format=%H',
      'HEAD',
      '--',
      `:(literal)${relative}/.comet.yaml`,
    ]);
    observedCommit =
      history
        ?.split(/\r?\n/u)
        .find(
          (candidate) =>
            /^[a-f0-9]{40,64}$/u.test(candidate) &&
            archiveCommitMatches(root, changeDir, candidate, changeIdentity),
        ) ?? null;
  }
  const commit = input.commit ?? observedCommit;
  const commitExists = !!commit && localGit(root, ['cat-file', '-t', commit]) === 'commit';
  const archiveCommitted =
    state.archived === true &&
    commitExists &&
    archiveCommitMatches(root, changeDir, commit!, changeIdentity);
  const localVerified =
    currentBranch === input.targetBranch &&
    (!state.bound_branch || state.bound_branch === currentBranch) &&
    archiveCommitted;
  let remoteVerified = false;
  let prVerified = false;
  let observedPrUrl: string | null = null;
  let remoteStatus: 'notChecked' | 'verified' | 'missing' | 'unavailable' =
    options.verifyRemote && input.action !== 'local' ? 'unavailable' : 'notChecked';
  let prStatus: 'notChecked' | 'verified' | 'missing' | 'unavailable' = 'notChecked';
  if (
    options.verifyRemote &&
    localVerified &&
    input.action !== 'local' &&
    input.remote &&
    authorizedRemoteUrl &&
    remoteUrl(root, input.remote) === authorizedRemoteUrl &&
    remoteUrl(root, input.remote, true) === authorizedRemoteUrl
  ) {
    const ref = `refs/heads/${input.targetBranch}`;
    const remoteOutput = readCommand(
      root,
      'git',
      [
        '-C',
        root,
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
        input.remote,
        ref,
      ],
      true,
    );
    const lines = remoteOutput?.split(/\r?\n/u) ?? [];
    const match = lines.length === 1 ? /^([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/u.exec(lines[0]) : null;
    const remoteHead = match?.[2] === ref ? match[1] : null;
    remoteVerified = !!remoteHead && containsCommit(root, commit!, remoteHead);
    remoteStatus = remoteVerified
      ? 'verified'
      : remoteOutput === ''
        ? 'missing'
        : remoteOutput === null ||
            !remoteHead ||
            localGit(root, ['cat-file', '-t', remoteHead]) !== 'commit'
          ? 'unavailable'
          : 'missing';
    const repository = repositoryFromRemote(authorizedRemoteUrl);
    const prUrl = repository && input.prUrl ? verifiedPrUrl(input.prUrl, repository) : null;
    const canCheckPr = remoteVerified || remoteOutput === '';
    const matchesPrHead = (pr: Record<string, unknown>) =>
      pr.headRefName === input.targetBranch &&
      typeof pr.headRefOid === 'string' &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(pr.headRefOid) &&
      (remoteVerified
        ? pr.headRefOid === remoteHead && ['OPEN', 'MERGED'].includes(pr.state as string)
        : remoteOutput === '' &&
          pr.state === 'MERGED' &&
          containsCommit(root, commit!, pr.headRefOid));
    if (canCheckPr && input.action === 'pr') prStatus = 'unavailable';
    if (canCheckPr && input.action === 'pr' && prUrl && repository) {
      const result = readCommand(
        root,
        'gh',
        ['pr', 'view', prUrl, '--repo', repository, '--json', 'url,headRefName,headRefOid,state'],
        true,
      );
      try {
        const pr = result ? object(JSON.parse(result)) : null;
        prVerified =
          !!pr &&
          typeof pr.url === 'string' &&
          verifiedPrUrl(pr.url, repository) === prUrl &&
          matchesPrHead(pr);
        prStatus = prVerified ? 'verified' : pr ? 'missing' : 'unavailable';
      } catch {
        prVerified = false;
        prStatus = 'unavailable';
      }
    } else if (canCheckPr && input.action === 'pr' && !input.prUrl && repository) {
      const result = readCommand(
        root,
        'gh',
        [
          'pr',
          'list',
          '--repo',
          repository,
          '--head',
          input.targetBranch,
          '--state',
          'all',
          '--json',
          'url,headRefName,headRefOid,state',
          '--limit',
          '100',
        ],
        true,
      );
      try {
        const entries: unknown = result === null ? null : JSON.parse(result);
        if (!Array.isArray(entries) || entries.length >= 100)
          throw new Error('Incomplete PR discovery');
        const matches = entries
          .map(object)
          .filter(
            (pr) =>
              typeof pr.url === 'string' && verifiedPrUrl(pr.url, repository) && matchesPrHead(pr),
          );
        if (matches.length === 1) {
          observedPrUrl = verifiedPrUrl(matches[0].url as string, repository);
          prVerified = true;
          prStatus = 'verified';
        } else prStatus = matches.length === 0 ? 'missing' : 'unavailable';
      } catch {
        prStatus = 'unavailable';
      }
    }
  }
  return {
    delivery,
    verification: {
      status:
        localVerified &&
        (input.action === 'local' || (input.action === 'push' ? remoteVerified : prVerified))
          ? ('complete' as const)
          : ('needsVerification' as const),
      currentBranch,
      commitExists,
      archiveCommitted,
      observedCommit,
      observedPrUrl,
      remoteVerified,
      prVerified,
      remoteStatus,
      prStatus,
    },
  };
}

/** Caller holds the state lock. This records authorization, never performs delivery. */
export async function writeClassicDelivery(
  root: string,
  changeDir: string,
  input: unknown,
  state: Pick<ClassicState, 'phase' | 'verifyResult' | 'archived'>,
) {
  const next = deliveryInput(input);
  if (localGit(root, ['check-ref-format', `refs/heads/${next.targetBranch}`]) === null)
    throw new Error('Invalid Classic delivery targetBranch');
  const previous = (await readClassicDelivery(root, changeDir)).delivery;
  const actual = await currentState(root, changeDir);
  if (
    !previous &&
    (state.phase !== 'archive' ||
      state.verifyResult !== 'pass' ||
      state.archived ||
      actual.phase !== 'archive' ||
      actual.verify_result !== 'pass' ||
      actual.archived !== false)
  )
    throw new Error(
      'Classic delivery authorization requires archive phase, verify pass, and not archived',
    );
  if (
    !previous &&
    (localGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== next.targetBranch ||
      (actual.bound_branch && actual.bound_branch !== next.targetBranch))
  )
    throw new Error(
      'Classic delivery authorization requires the current and bound branch to match targetBranch',
    );
  if (
    previous &&
    (next.action !== previous.action ||
      next.targetBranch !== previous.targetBranch ||
      (next.remote !== undefined && next.remote !== previous.remote))
  )
    throw new Error('Classic delivery authorization cannot be overwritten');
  for (const field of ['commit'] as const) {
    if (previous?.[field] && next[field] && previous[field] !== next[field])
      throw new Error(`Classic delivery ${field} cannot be overwritten`);
  }
  if (
    next.commit &&
    (actual.archived !== true ||
      !archiveCommitMatches(root, changeDir, next.commit, identity(actual, changeDir)))
  )
    throw new Error('Classic delivery commit must be a verified archive commit');
  let authorizedRemoteUrl = previous?.authorizedRemoteUrl;
  if (!previous && next.action !== 'local') {
    next.remote ??= 'origin';
    authorizedRemoteUrl = remoteUrl(root, next.remote) ?? undefined;
    if (!authorizedRemoteUrl || remoteUrl(root, next.remote, true) !== authorizedRemoteUrl)
      throw new Error('Classic delivery requires one configured fetch/push remote repository');
    let parsedRemote: URL | null = null;
    try {
      parsedRemote = new URL(authorizedRemoteUrl);
    } catch {
      /* SCP-style SSH and local paths are not URLs. */
    }
    if (
      parsedRemote &&
      (parsedRemote.password ||
        parsedRemote.search ||
        parsedRemote.hash ||
        (['http:', 'https:'].includes(parsedRemote.protocol) && parsedRemote.username))
    )
      throw new Error('Classic delivery remote must not contain credentials');
  }
  if (next.prUrl) {
    const repository = authorizedRemoteUrl ? repositoryFromRemote(authorizedRemoteUrl) : null;
    if (next.action !== 'pr' || !repository || !verifiedPrUrl(next.prUrl, repository))
      throw new Error('Classic delivery prUrl must belong to the authorized remote repository');
  }
  const record: ClassicDelivery = {
    ...previous,
    ...next,
    schemaVersion: 1,
    changeIdentity: identity(actual, changeDir),
    authorizationId: previous?.authorizationId ?? randomUUID(),
    ...(authorizedRemoteUrl ? { authorizedRemoteUrl } : {}),
  };
  if (!previous) {
    const authorization = { ...record };
    delete authorization.commit;
    delete authorization.prUrl;
    const dir = path.join(changeDir, '.comet');
    await ensureClassicProjectDirectory(root, dir, 'Classic delivery directory');
    await writeClassicProjectText(
      root,
      path.join(dir, 'delivery.json'),
      JSON.stringify(authorization, null, 2) + '\n',
      { label: 'Classic delivery' },
    );
  }
  if (record.commit || record.prUrl)
    await writeReceipt(root, {
      schemaVersion: 1,
      changeIdentity: record.changeIdentity,
      authorizationId: record.authorizationId,
      ...(record.commit ? { commit: record.commit } : {}),
      ...(record.prUrl ? { prUrl: record.prUrl } : {}),
    });
  return readClassicDelivery(root, changeDir);
}
