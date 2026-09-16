import { promises as fs } from 'fs';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { getPlatformSkillsDir, PLATFORMS } from '../../platform/install/platforms.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  collectDashboardWorkspaceSources,
  dashboardWorkspaceIdentity,
  encodeDashboardChangeLocator,
  type DashboardWorkspaceIdentity,
} from './workspace.js';

const MAX_STATE_BYTES = 1024 * 1024;
type JsonObject = Record<string, unknown>;
export type AnyDashboardKind = 'run' | 'authoring';

export interface AnyDashboardItem {
  locator: string;
  name: string;
  kind: AnyDashboardKind;
  status: string;
  completed: boolean;
  currentNode: string | null;
  completedNodes: number;
  totalNodes: number | null;
  relativePath: string;
  updatedAt?: string;
  workspace: DashboardWorkspaceIdentity;
  diagnostics: string[];
}

export interface AnyDashboardDetail extends AnyDashboardItem {
  goal: string;
  blocker: string | null;
  nodes: Array<{
    id: string;
    label: string;
    skill: string;
    status: 'done' | 'current' | 'pending';
  }>;
  evidence: JsonObject;
  history: unknown[];
  references: Array<{ label: string; path: string }>;
  artifacts: Array<{
    path: string;
    node: string;
    required: boolean;
    status: 'present' | 'missing' | 'unavailable';
    content?: string;
    diagnostic?: string;
  }>;
}

export interface AnyDashboardPage {
  items: AnyDashboardItem[];
  total: number;
  nextCursor: string | null;
  diagnostics: string[];
  summary: {
    active: number;
    completed: number;
    paused: number;
    attention: number;
    invalid: number;
  };
}

export class AnyDashboardQueryError extends Error {}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

async function readJson(root: string, relative: string) {
  const result = await readProtectedProjectFile(root, relative, MAX_STATE_BYTES, {
    label: 'Comet Any state',
  });
  const parsed: unknown = JSON.parse(result.bytes.toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return { value: object(parsed), updatedAt: new Date(Number(result.stat.mtimeMs)).toISOString() };
}

async function entries(root: string, relative: string): Promise<string[]> {
  const inspected = await inspectProtectedProjectPath(root, relative, {
    label: 'Comet Any discovery directory',
    expected: 'directory',
  });
  if (!inspected.exists) return [];
  const names = await fs.readdir(inspected.target);
  // Verify again before using names; all file reads also recheck the full chain.
  await inspectProtectedProjectPath(root, relative, {
    label: 'Comet Any discovery directory',
    expected: 'directory',
  });
  return names.sort();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unreadable Comet Any state';
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

interface Candidate {
  item: AnyDashboardItem;
  root: string;
  state: JsonObject;
}

async function discover(projectRoot: string, includeAuthoring = false, locator?: string) {
  const candidates: Candidate[] = [];
  const diagnostics: string[] = [];
  for (const source of collectDashboardWorkspaceSources(projectRoot)) {
    for (const kind of (includeAuthoring ? ['run', 'authoring'] : ['run']) as AnyDashboardKind[]) {
      const directory = kind === 'run' ? '.comet/runs' : '.comet/bundle-authoring';
      let names: string[];
      try {
        names = await entries(source.projectRoot, directory);
      } catch (error) {
        diagnostics.push(`${source.label}: ${directory}: ${message(error)}`);
        continue;
      }
      for (const name of names) {
        if (kind === 'authoring' && !name.endsWith('.json')) continue;
        const relativePath = `${directory}/${name}${kind === 'run' ? '/state.json' : ''}`;
        const item: AnyDashboardItem = {
          locator: encodeDashboardChangeLocator(source.id, `any:${relativePath}`),
          name: kind === 'run' ? name : name.slice(0, -5),
          kind,
          status: 'invalid',
          completed: false,
          currentNode: null,
          completedNodes: 0,
          totalNodes: null,
          relativePath,
          workspace: dashboardWorkspaceIdentity(source),
          diagnostics: [],
        };
        if (kind === 'run' && locator && item.locator !== locator) continue;
        let state: JsonObject = {};
        try {
          const read = await readJson(source.projectRoot, relativePath);
          state = read.value;
          item.updatedAt = read.updatedAt;
          if (state.schemaVersion !== 1) throw new Error('Unsupported state schemaVersion');
          if (kind === 'run') {
            if (
              !text(state.workflow) ||
              !['running', 'completed', 'blocked', 'paused', 'failed'].includes(
                text(state.status),
              ) ||
              !Array.isArray(state.completedNodes) ||
              state.completedNodes.some((node) => typeof node !== 'string') ||
              (state.currentNode !== null && typeof state.currentNode !== 'string')
            ) {
              throw new Error('Invalid workflow run state');
            }
            item.name = text(state.workflow);
            item.currentNode = text(state.currentNode) || null;
            item.completedNodes = new Set(strings(state.completedNodes)).size;
            item.completed = state.status === 'completed';
          } else {
            if (
              state.name !== item.name ||
              !['draft', 'eval-passed', 'review-approved', 'ready', 'drift-conflict'].includes(
                text(state.status),
              )
            ) {
              throw new Error('Invalid Bundle authoring state');
            }
            // Manual Bundle authoring is not a comet-any factory workflow.
            if (!state.factory) continue;
            item.completed = state.status === 'ready';
          }
          item.status = text(state.status);
        } catch (error) {
          // A run directory without state has not been initialized yet.
          if (kind === 'run' && isMissing(error)) continue;
          item.diagnostics.push(message(error));
        }
        candidates.push({ item, root: source.projectRoot, state: includeAuthoring ? state : {} });
      }
    }
  }
  candidates.sort(
    (a, b) =>
      (b.item.updatedAt ?? '').localeCompare(a.item.updatedAt ?? '') ||
      a.item.locator.localeCompare(b.item.locator),
  );
  return { candidates, diagnostics };
}

/** Read-only metadata discovery. Evidence and protocol files are loaded only for a selected row. */
export async function collectAnyDashboardPage(
  projectRoot: string,
  options: {
    status?: string;
    query?: string;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<AnyDashboardPage> {
  const status = options.status ?? 'active';
  const limit = options.limit ?? 10;
  const offset = options.cursor === undefined ? 0 : Number(options.cursor);
  if (
    !['active', 'completed', 'all'].includes(status) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (options.cursor !== undefined && !/^\d+$/u.test(options.cursor))
  ) {
    throw new AnyDashboardQueryError('Invalid Comet Any page query');
  }
  const { candidates, diagnostics } = await discover(projectRoot);
  const runs = candidates.map(({ item }) => item).filter((item) => item.kind === 'run');
  const query = (options.query ?? '').trim().toLowerCase();
  const items = candidates
    .map(({ item }) => item)
    .filter(
      (item) =>
        item.kind === 'run' &&
        (status === 'all' || item.completed === (status === 'completed')) &&
        `${item.name} ${item.workspace.label} ${item.status} ${item.currentNode ?? ''}`
          .toLowerCase()
          .includes(query),
    );
  return {
    items: items.slice(offset, offset + limit),
    summary: {
      active: runs.filter((item) => !item.completed && item.status !== 'invalid').length,
      completed: runs.filter((item) => item.completed).length,
      paused: runs.filter((item) => item.status === 'paused').length,
      attention: runs.filter((item) => ['blocked', 'failed'].includes(item.status)).length,
      invalid: runs.filter((item) => item.status === 'invalid').length,
    },
    total: items.length,
    nextCursor: offset + limit < items.length ? String(offset + limit) : null,
    diagnostics,
  };
}

function validProtocol(value: unknown, name: string): JsonObject | null {
  const protocol = object(value);
  const state = object(protocol.state);
  if (
    protocol.schemaVersion !== 1 ||
    protocol.name !== name ||
    state.kind !== 'workflow-run' ||
    !Array.isArray(protocol.nodes) ||
    protocol.nodes.length === 0 ||
    protocol.nodes.some((node) => !text(object(node).id)) ||
    new Set(protocol.nodes.map((node) => text(object(node).id))).size !== protocol.nodes.length
  )
    return null;
  return protocol;
}

async function findProtocol(candidate: Candidate, candidates: Candidate[], diagnostics: string[]) {
  const matches: Array<{ protocol: JsonObject; path: string }> = [];
  const accept = (value: unknown, relativePath: string) => {
    const protocol = validProtocol(value, candidate.item.name);
    if (protocol && object(protocol.state).statePath === candidate.item.relativePath) {
      matches.push({ protocol, path: relativePath });
    }
  };
  // Project-local installations describe the code actually available to run.
  const roots = new Set(
    PLATFORMS.map((platform) => `${getPlatformSkillsDir(platform, 'project')}/skills`),
  );
  roots.add('.comet/skills');
  for (const root of roots) {
    let names: string[];
    try {
      names = await entries(candidate.root, root);
    } catch (error) {
      diagnostics.push(`${root}: ${message(error)}`);
      continue;
    }
    for (const name of names) {
      const relative = `${root}/${name}/reference/workflow-protocol.json`;
      try {
        accept((await readJson(candidate.root, relative)).value, relative);
      } catch (error) {
        if (!isMissing(error)) diagnostics.push(`${relative}: ${message(error)}`);
      }
    }
  }
  if (matches.length === 0) {
    for (const other of candidates) {
      if (
        other.root !== candidate.root ||
        other.item.kind !== 'authoring' ||
        other.item.status === 'invalid'
      )
        continue;
      accept(object(other.state.factory).workflowProtocol, other.item.relativePath);
    }
  }
  if (
    matches.length > 0 &&
    matches.some(({ protocol }) => JSON.stringify(protocol) !== JSON.stringify(matches[0].protocol))
  ) {
    diagnostics.push('Conflicting workflow definitions; node totals are unknown.');
    return null;
  }
  if (!matches.length)
    diagnostics.push(
      'Workflow definition unavailable; only recorded nodes are shown and the total is unknown.',
    );
  if (matches[0]?.path.startsWith('.comet/bundle-authoring/'))
    diagnostics.push(
      'Workflow definition comes from the authoring snapshot, not an installed package; it may differ from the version that produced this run.',
    );
  return matches[0] ?? null;
}

async function artifactPaths(root: string, pattern: string): Promise<string[]> {
  const normalized = normalizeWorkflowRelativePath(pattern, 'Comet Any artifact pattern', true);
  if (!normalized.includes('*')) return [normalized];
  const parts = normalized.split('/');
  let current = [''];
  let visited = 0;
  for (const part of parts) {
    const next: string[] = [];
    for (const prefix of current) {
      if (++visited > 1000) throw new Error('Artifact pattern exceeds the discovery limit');
      if (!part.includes('*')) {
        next.push(prefix ? `${prefix}/${part}` : part);
        continue;
      }
      // Match one path segment, as the generated workflow guard does (not a recursive glob).
      const matcher = new RegExp(
        `^${part
          .split('*')
          .map((piece) => piece.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&'))
          .join('.*')}$`,
        'u',
      );
      const names = prefix ? await entries(root, prefix) : await fs.readdir(root);
      if (names.length > 1000) throw new Error('Artifact directory exceeds the discovery limit');
      for (const name of names)
        if (matcher.test(name)) next.push(prefix ? `${prefix}/${name}` : name);
      if (next.length > 100) throw new Error('Artifact pattern exceeds 100 matches');
    }
    current = next;
  }
  return current;
}

/** Locators are matched against discovered files, never interpreted as client-supplied paths. */
export async function collectAnyDashboardDetail(
  projectRoot: string,
  locator: string,
): Promise<AnyDashboardDetail | null> {
  const { candidates } = await discover(projectRoot, true, locator);
  const candidate = candidates.find(({ item }) => item.kind === 'run' && item.locator === locator);
  if (!candidate) return null;
  const { item, state } = candidate;
  const detail: AnyDashboardDetail = {
    ...item,
    goal: '',
    blocker: text(state.blockedReason) || text(state.reason) || null,
    nodes: [],
    evidence: {},
    history: [],
    references: [],
    artifacts: [],
    diagnostics: [...item.diagnostics],
  };
  if (item.status === 'invalid') return detail;
  const definition = await findProtocol(candidate, candidates, detail.diagnostics);
  const completed = new Set(strings(state.completedNodes));
  const route = definition
    ? (definition.protocol.nodes as unknown[]).map(object).filter((node) => !node.disabled)
    : [...new Set([...completed, ...(item.currentNode ? [item.currentNode] : [])])].map(
        (id) => ({ id }) as JsonObject,
      );
  if (definition) {
    detail.goal = text(definition.protocol.goal);
    detail.totalNodes = route.length;
    detail.references.push({ label: 'Workflow definition', path: definition.path });
    const ids = new Set(route.map((node) => text(node.id)));
    if (
      [...completed].some((id) => !ids.has(id)) ||
      (item.currentNode && !ids.has(item.currentNode)) ||
      (item.completed &&
        (route.some((node) => !completed.has(text(node.id))) || item.currentNode !== null))
    ) {
      detail.diagnostics.push('Recorded nodes do not match the workflow definition.');
    }
  }
  detail.nodes = route.map((node) => ({
    id: text(node.id),
    label: text(node.label) || text(node.id),
    skill: text(object(node.implementation).skill),
    status: completed.has(text(node.id))
      ? 'done'
      : node.id === item.currentNode
        ? 'current'
        : 'pending',
  }));
  detail.evidence = object(state.evidence);
  if (definition) {
    const schemas = Array.isArray(definition.protocol.outputSchemas)
      ? definition.protocol.outputSchemas.map(object)
      : [];
    let previewBudget = 256 * 1024;
    for (const node of route) {
      for (const schema of schemas.filter((schema) =>
        strings(node.outputSchemas).includes(text(schema.id)),
      )) {
        const artifacts = Array.isArray(schema.artifacts) ? schema.artifacts.map(object) : [];
        for (const artifact of artifacts)
          for (const relative of strings(artifact.paths)) {
            if (detail.artifacts.length >= 100) {
              if (!detail.diagnostics.includes('Showing the first 100 artifact references.'))
                detail.diagnostics.push('Showing the first 100 artifact references.');
              continue;
            }
            const entry: AnyDashboardDetail['artifacts'][number] = {
              path: relative,
              node: text(node.id),
              required: artifact.required === true,
              status: 'unavailable',
            };
            try {
              if (artifact.pathBase && artifact.pathBase !== 'project')
                throw new Error(
                  `Artifact path base ${text(artifact.pathBase)} is not available in this standalone run view.`,
                );
              const paths = await artifactPaths(candidate.root, relative);
              const inspections = await Promise.all(
                paths.map((artifactPath) =>
                  inspectProtectedProjectPath(candidate.root, artifactPath, {
                    label: 'Comet Any artifact',
                    expected: artifact.kind === 'directory' ? 'directory' : 'file',
                  }),
                ),
              );
              const inspected = inspections.find((inspection) => inspection.exists);
              entry.status = inspected ? 'present' : 'missing';
              if (inspections.filter((inspection) => inspection.exists).length > 1)
                entry.diagnostic =
                  'Multiple artifacts match this pattern; preview shows the first match.';
              if (
                inspected &&
                inspected.kind === 'file' &&
                /\.(?:md|txt|json|ya?ml|log)$/iu.test(inspected.relative) &&
                previewBudget > 0
              ) {
                try {
                  const read = await readProtectedProjectFile(
                    candidate.root,
                    inspected.relative,
                    Math.min(previewBudget, 64 * 1024),
                    { label: 'Comet Any artifact preview' },
                  );
                  entry.content = read.bytes.toString('utf8');
                  previewBudget -= read.bytes.length;
                } catch (error) {
                  entry.diagnostic = message(error);
                }
              }
            } catch (error) {
              entry.diagnostic = message(error);
            }
            detail.artifacts.push(entry);
          }
      }
    }
  }
  // Guard failures currently go to stderr, not state.json. Never infer them from an idle run.
  detail.diagnostics.push(
    'Only persisted state is observable; unrecorded guard failures and live process activity are not available. Missing artifacts do not by themselves mean the run is blocked.',
  );
  detail.history = Array.isArray(state.history) ? state.history.slice(-100) : [];
  if (Array.isArray(state.history) && state.history.length > 100)
    detail.diagnostics.push('Showing the most recent 100 history entries.');
  return detail;
}
