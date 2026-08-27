import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isCommandAvailable, getNpmExecutable } from './openspec.js';
import { printCommandErrorDetails } from '../../platform/process/command-error.js';
import { parse as parseYaml } from 'yaml';

import type { InstallScope } from '../../platform/install/types.js';

type CodegraphIndexStatus =
  | 'cli_missing'
  | 'cli_ready'
  | 'project_not_initialized'
  | 'index_incomplete'
  | 'index_stale'
  | 'index_ready'
  | 'status_unavailable';

interface CodegraphIndexDiagnostic {
  status: CodegraphIndexStatus;
  repairable: boolean;
  remediation: string | null;
  detail: string;
}

type CodegraphCliStatus = 'installed' | 'missing';
type CodegraphProjectIndexStatus =
  | 'not_checked'
  | 'not_initialized'
  | 'incomplete'
  | 'stale'
  | 'current'
  | 'unavailable'
  | 'skipped';
type CodegraphMcpStatus =
  | 'registered'
  | 'partially_registered'
  | 'not_registered'
  | 'not_detected'
  | 'unavailable';
type CodegraphAgentId =
  | 'claude'
  | 'cursor'
  | 'codex'
  | 'opencode'
  | 'hermes'
  | 'gemini'
  | 'antigravity'
  | 'kiro';

interface CodegraphAgentDiagnostic {
  id: CodegraphAgentId;
  name: string;
  scope: 'global' | 'project' | 'both';
  configPath: string | null;
  registered: boolean;
  valid: boolean;
  effective: boolean;
  detail: string;
}

interface CodegraphIntegrationDiagnostic extends CodegraphIndexDiagnostic {
  cliStatus: CodegraphCliStatus;
  indexStatus: CodegraphProjectIndexStatus;
  mcpStatus: CodegraphMcpStatus;
  agents: CodegraphAgentDiagnostic[];
  effectiveForAgent: Partial<Record<CodegraphAgentId, boolean>>;
}

function getPnpmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function hasCodegraphProjectIndex(projectPath: string): boolean {
  const codegraphDir = path.join(projectPath, '.codegraph');
  try {
    if (!fs.statSync(codegraphDir).isDirectory()) return false;
    return fs.readdirSync(codegraphDir).some((entry) => entry !== '.gitignore');
  } catch {
    return false;
  }
}

function resolvePnpmGlobalCommand(command: string): string | null {
  try {
    const binDir = execFileSync(getPnpmExecutable(), ['bin', '-g'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      shell: process.platform === 'win32',
    }).trim();
    if (!binDir) return null;

    const candidates =
      process.platform === 'win32'
        ? [`${command}.cmd`, `${command}.exe`, `${command}.ps1`, command]
        : [command];

    for (const candidate of candidates) {
      const candidatePath = path.join(binDir, candidate);
      if (fs.existsSync(candidatePath)) return candidatePath;
    }
  } catch {
    // pnpm may not be installed or may not have a global bin configured.
  }

  return null;
}

function resolveCodegraphCommand(): string | null {
  if (isCommandAvailable('codegraph')) return 'codegraph';
  return resolvePnpmGlobalCommand('codegraph');
}

type CodegraphConfigFormat = 'json' | 'jsonc' | 'toml' | 'yaml';

interface CodegraphConfigCandidate {
  scope: 'global' | 'project';
  path: string;
  format: CodegraphConfigFormat;
  detectPaths: string[];
}

interface CodegraphAgentDefinition {
  id: CodegraphAgentId;
  name: string;
  candidates: CodegraphConfigCandidate[];
}

interface CodegraphMcpEntryInspection {
  present: boolean;
  valid: boolean;
  error?: string;
}

function codegraphCommandLooksValid(command: unknown): boolean {
  const text = Array.isArray(command)
    ? command.filter((part): part is string => typeof part === 'string').join(' ')
    : typeof command === 'string'
      ? command
      : '';
  return /(?:^|[\\/\s])codegraph(?:\.cmd|\.exe|\.ps1)?(?:$|[\s"'])/iu.test(text);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonLike(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '')
      .replace(/,\s*([}\]])/gu, '$1');
    return JSON.parse(withoutComments) as unknown;
  }
}

function inspectJsonMcpEntry(source: string): CodegraphMcpEntryInspection {
  const config = recordValue(parseJsonLike(source));
  const servers = recordValue(config?.mcpServers) ?? recordValue(config?.mcp);
  const entry = servers?.codegraph;
  if (entry === undefined) return { present: false, valid: false };
  const entryRecord = recordValue(entry);
  return {
    present: true,
    valid: codegraphCommandLooksValid(entryRecord?.command),
  };
}

function inspectTomlMcpEntry(source: string): CodegraphMcpEntryInspection {
  const match = source.match(
    /(?:^|\r?\n)\s*\[mcp_servers\.codegraph\]\s*\r?\n?([\s\S]*?)(?=\r?\n\s*\[[^\]]+\]\s*|$)/u,
  );
  if (!match) return { present: false, valid: false };
  const command = match[1].match(/^\s*command\s*=\s*["']([^"']+)["']\s*$/mu)?.[1];
  return { present: true, valid: codegraphCommandLooksValid(command) };
}

function inspectYamlMcpEntry(source: string): CodegraphMcpEntryInspection {
  const config = recordValue(parseYaml(source));
  const servers = recordValue(config?.mcp_servers);
  const entry = servers?.codegraph;
  if (entry === undefined) return { present: false, valid: false };
  const entryRecord = recordValue(entry);
  return {
    present: true,
    valid: codegraphCommandLooksValid(entryRecord?.command),
  };
}

function inspectCodegraphConfigCandidate(
  candidate: CodegraphConfigCandidate,
): CodegraphMcpEntryInspection | null {
  if (!fs.existsSync(candidate.path)) return null;
  try {
    const source = fs.readFileSync(candidate.path, 'utf8');
    if (candidate.format === 'toml') return inspectTomlMcpEntry(source);
    if (candidate.format === 'yaml') return inspectYamlMcpEntry(source);
    return inspectJsonMcpEntry(source);
  } catch (error) {
    return {
      present: false,
      valid: false,
      error: `unable to read ${candidate.path}: ${(error as Error).message}`,
    };
  }
}

function globalOpencodeConfigDir(homeDir: string, useEnvironment: boolean): string {
  if (process.platform === 'win32') {
    const appData = useEnvironment ? process.env.APPDATA : undefined;
    return appData && appData.trim().length > 0
      ? path.join(appData, 'opencode')
      : path.join(homeDir, 'AppData', 'Roaming', 'opencode');
  }
  const xdg = useEnvironment ? process.env.XDG_CONFIG_HOME : undefined;
  return path.join(xdg && xdg.trim().length > 0 ? xdg : path.join(homeDir, '.config'), 'opencode');
}

function globalHermesHome(homeDir: string, useEnvironment: boolean): string {
  const configured = useEnvironment ? process.env.HERMES_HOME : undefined;
  return configured && configured.trim().length > 0
    ? path.resolve(configured)
    : path.join(homeDir, '.hermes');
}

function jsonCandidate(
  scope: 'global' | 'project',
  file: string,
  format: CodegraphConfigFormat = 'json',
  detectPaths = [file],
): CodegraphConfigCandidate {
  return { scope, path: file, format, detectPaths };
}

function codegraphAgentDefinitions(
  projectPath: string,
  homeDir: string | undefined,
): CodegraphAgentDefinition[] {
  const useEnvironment = homeDir === undefined;
  const home = path.resolve(homeDir ?? os.homedir());
  const project = path.resolve(projectPath);
  const opencodeDir = globalOpencodeConfigDir(home, useEnvironment);
  const hermesHome = globalHermesHome(home, useEnvironment);
  const claudeGlobalDir = path.join(home, '.claude');
  const cursorGlobalDir = path.join(home, '.cursor');
  const codexGlobalDir = path.join(home, '.codex');
  const geminiGlobalDir = path.join(home, '.gemini');
  const kiroGlobalDir = path.join(home, '.kiro');
  const antigravityConfigDir = path.join(geminiGlobalDir, 'config');
  const antigravityLegacyDir = path.join(geminiGlobalDir, 'antigravity');

  return [
    {
      id: 'claude',
      name: 'Claude Code',
      candidates: [
        jsonCandidate('global', path.join(home, '.claude.json'), 'json', [
          path.join(home, '.claude.json'),
          claudeGlobalDir,
        ]),
        jsonCandidate('project', path.join(project, '.mcp.json'), 'json', [
          path.join(project, '.mcp.json'),
          path.join(project, '.claude'),
        ]),
      ],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      candidates: [
        jsonCandidate('global', path.join(cursorGlobalDir, 'mcp.json'), 'json', [cursorGlobalDir]),
        jsonCandidate('project', path.join(project, '.cursor', 'mcp.json'), 'json', [
          path.join(project, '.cursor'),
        ]),
      ],
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      candidates: [
        jsonCandidate('global', path.join(codexGlobalDir, 'config.toml'), 'toml', [codexGlobalDir]),
      ],
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      candidates: [
        jsonCandidate('global', path.join(opencodeDir, 'opencode.jsonc'), 'jsonc', [opencodeDir]),
        jsonCandidate('global', path.join(opencodeDir, 'opencode.json'), 'json', [opencodeDir]),
        jsonCandidate('project', path.join(project, 'opencode.jsonc'), 'jsonc', [
          path.join(project, '.opencode'),
          path.join(project, 'opencode.jsonc'),
          path.join(project, 'opencode.json'),
        ]),
        jsonCandidate('project', path.join(project, 'opencode.json'), 'json', [
          path.join(project, '.opencode'),
          path.join(project, 'opencode.jsonc'),
          path.join(project, 'opencode.json'),
        ]),
      ],
    },
    {
      id: 'hermes',
      name: 'Hermes Agent',
      candidates: [
        jsonCandidate('global', path.join(hermesHome, 'config.yaml'), 'yaml', [hermesHome]),
      ],
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      candidates: [
        jsonCandidate('global', path.join(geminiGlobalDir, 'settings.json'), 'json', [
          geminiGlobalDir,
        ]),
        jsonCandidate('project', path.join(project, '.gemini', 'settings.json'), 'json', [
          path.join(project, '.gemini'),
        ]),
      ],
    },
    {
      id: 'antigravity',
      name: 'Antigravity IDE',
      candidates: [
        jsonCandidate('global', path.join(antigravityConfigDir, 'mcp_config.json'), 'json', [
          antigravityConfigDir,
        ]),
        jsonCandidate('global', path.join(antigravityLegacyDir, 'mcp_config.json'), 'json', [
          antigravityLegacyDir,
        ]),
      ],
    },
    {
      id: 'kiro',
      name: 'Kiro',
      candidates: [
        jsonCandidate('global', path.join(kiroGlobalDir, 'settings', 'mcp.json'), 'json', [
          kiroGlobalDir,
        ]),
        jsonCandidate('project', path.join(project, '.kiro', 'settings', 'mcp.json'), 'json', [
          path.join(project, '.kiro'),
        ]),
      ],
    },
  ];
}

function inspectCodegraphMcp(
  projectPath: string,
  scope: InstallScope,
  homeDir: string | undefined,
  cliStatus: CodegraphCliStatus,
  indexStatus: CodegraphProjectIndexStatus,
): Pick<CodegraphIntegrationDiagnostic, 'mcpStatus' | 'agents' | 'effectiveForAgent'> {
  const allowedScopes = scope === 'global' ? new Set(['global']) : new Set(['global', 'project']);
  const agents: CodegraphAgentDiagnostic[] = [];
  const effectiveForAgent: Partial<Record<CodegraphAgentId, boolean>> = {};

  for (const definition of codegraphAgentDefinitions(projectPath, homeDir)) {
    const candidates = definition.candidates.filter((candidate) =>
      allowedScopes.has(candidate.scope),
    );
    const existing = candidates.filter((candidate) =>
      candidate.detectPaths.some((detectPath) => fs.existsSync(detectPath)),
    );
    if (existing.length === 0) continue;

    const inspections = candidates
      .map((candidate) => ({ candidate, inspection: inspectCodegraphConfigCandidate(candidate) }))
      .filter(
        (
          result,
        ): result is {
          candidate: CodegraphConfigCandidate;
          inspection: CodegraphMcpEntryInspection;
        } => result.inspection !== null,
      );
    const registered = inspections.some(({ inspection }) => inspection.present);
    const valid = inspections.some(({ inspection }) => inspection.valid);
    const registeredScopes = new Set(
      inspections
        .filter(({ inspection }) => inspection.present)
        .map(({ candidate }) => candidate.scope),
    );
    const agentScope =
      registeredScopes.size > 0
        ? registeredScopes.size > 1
          ? 'both'
          : [...registeredScopes][0]
        : existing.some((candidate) => candidate.scope === 'project') &&
            existing.some((candidate) => candidate.scope === 'global')
          ? 'both'
          : existing[0].scope;
    const registeredCandidate = inspections.find(({ inspection }) => inspection.present);
    const configPath = (registeredCandidate ?? inspections[0])?.candidate.path ?? existing[0].path;
    const effective = cliStatus === 'installed' && indexStatus === 'current' && valid;
    const errors = inspections
      .map(({ inspection }) => inspection.error)
      .filter((error): error is string => Boolean(error));

    agents.push({
      id: definition.id,
      name: definition.name,
      scope: agentScope,
      configPath,
      registered,
      valid,
      effective,
      detail: registered
        ? valid
          ? `CodeGraph MCP is registered at ${configPath}`
          : `CodeGraph MCP entry at ${configPath} does not point to the CodeGraph server`
        : (errors[0] ?? `CodeGraph MCP is not registered at ${configPath}`),
    });
    effectiveForAgent[definition.id] = effective;
  }

  const registeredCount = agents.filter((agent) => agent.registered).length;
  const mcpStatus: CodegraphMcpStatus =
    agents.length === 0
      ? 'not_detected'
      : registeredCount === 0
        ? 'not_registered'
        : registeredCount === agents.length
          ? 'registered'
          : 'partially_registered';

  return { mcpStatus, agents, effectiveForAgent };
}

function projectIndexStatus(
  diagnostic: CodegraphIndexDiagnostic,
  scope: InstallScope,
): CodegraphProjectIndexStatus {
  if (scope === 'global') return 'not_checked';
  switch (diagnostic.status) {
    case 'project_not_initialized':
      return 'not_initialized';
    case 'index_incomplete':
      return 'incomplete';
    case 'index_stale':
      return 'stale';
    case 'index_ready':
      return 'current';
    case 'cli_missing':
    case 'status_unavailable':
      return 'unavailable';
    case 'cli_ready':
      return 'not_checked';
  }
}

function globalCodegraphDiagnostic(): CodegraphIndexDiagnostic {
  return resolveCodegraphCommand()
    ? {
        status: 'cli_ready',
        repairable: false,
        remediation: null,
        detail: 'CodeGraph CLI is installed; project indexes are not part of global scope',
      }
    : {
        status: 'cli_missing',
        repairable: false,
        remediation: 'npm install -g @colbymchenry/codegraph',
        detail: 'CodeGraph CLI is not installed',
      };
}

function inspectCodegraphIntegration(
  projectPath: string,
  scope: InstallScope = 'project',
  homeDir?: string,
): CodegraphIntegrationDiagnostic {
  const index =
    scope === 'global' ? globalCodegraphDiagnostic() : inspectCodegraphIndex(projectPath);
  const cliStatus: CodegraphCliStatus = index.status === 'cli_missing' ? 'missing' : 'installed';
  const indexStatus = projectIndexStatus(index, scope);
  return {
    ...index,
    cliStatus,
    indexStatus,
    ...inspectCodegraphMcp(projectPath, scope, homeDir, cliStatus, indexStatus),
  };
}

function numericField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inspectCodegraphIndex(projectPath: string): CodegraphIndexDiagnostic {
  const codegraphCommand = resolveCodegraphCommand();
  if (!codegraphCommand) {
    return {
      status: 'cli_missing',
      repairable: false,
      remediation: 'npm install -g @colbymchenry/codegraph',
      detail: 'CodeGraph CLI is not installed',
    };
  }

  if (!hasCodegraphProjectIndex(projectPath)) {
    return {
      status: 'project_not_initialized',
      repairable: true,
      remediation: 'codegraph init -i',
      detail: 'CodeGraph CLI is installed but this project has no usable index',
    };
  }

  try {
    const output = execFileSync(codegraphCommand, ['status', '--json', projectPath], {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      shell: process.platform === 'win32',
    });
    const line = String(output).trim().split(/\r?\n/u).filter(Boolean).at(-1);
    if (!line) throw new Error('status returned no JSON');
    const payload = JSON.parse(line) as Record<string, unknown>;
    if (payload.initialized !== true) {
      return {
        status: 'project_not_initialized',
        repairable: true,
        remediation: 'codegraph init -i',
        detail: 'CodeGraph reports that this project is not initialized',
      };
    }

    const index =
      payload.index && typeof payload.index === 'object'
        ? (payload.index as Record<string, unknown>)
        : {};
    const indexState = typeof index.state === 'string' ? index.state : null;
    const pendingRefs = numericField(index.pendingRefs);
    const incompleteState =
      indexState === 'indexing' || indexState === 'partial' || indexState === 'failed';
    if (incompleteState || pendingRefs > 0) {
      return {
        status: 'index_incomplete',
        repairable: true,
        remediation: incompleteState ? 'codegraph index' : 'codegraph sync',
        detail:
          pendingRefs > 0
            ? `CodeGraph index has ${pendingRefs} unresolved reference(s)`
            : `CodeGraph index state is ${indexState}`,
      };
    }

    const pending =
      payload.pendingChanges && typeof payload.pendingChanges === 'object'
        ? (payload.pendingChanges as Record<string, unknown>)
        : {};
    const pendingChanges =
      numericField(pending.added) + numericField(pending.modified) + numericField(pending.removed);
    if (
      index.reindexRecommended === true ||
      pendingChanges > 0 ||
      (payload.worktreeMismatch !== null && payload.worktreeMismatch !== undefined)
    ) {
      const worktreeMismatch =
        payload.worktreeMismatch !== null && payload.worktreeMismatch !== undefined;
      return {
        status: 'index_stale',
        repairable: true,
        remediation: worktreeMismatch
          ? 'codegraph init -i'
          : index.reindexRecommended === true
            ? 'codegraph index'
            : 'codegraph sync',
        detail: worktreeMismatch
          ? 'CodeGraph is borrowing an index from another Git worktree'
          : index.reindexRecommended === true
            ? 'CodeGraph recommends rebuilding an index created by an older extraction version'
            : `CodeGraph index has ${pendingChanges} pending change(s)`,
      };
    }

    return {
      status: 'index_ready',
      repairable: false,
      remediation: null,
      detail: 'CodeGraph index is initialized and current',
    };
  } catch (error) {
    return {
      status: 'status_unavailable',
      repairable: false,
      remediation: 'codegraph status --json .',
      detail: `Unable to inspect CodeGraph index: ${(error as Error).message}`,
    };
  }
}

function repairCodegraphIndex(
  projectPath: string,
  status: Extract<
    CodegraphIndexStatus,
    'project_not_initialized' | 'index_incomplete' | 'index_stale'
  >,
  quiet = false,
): void {
  const codegraphCommand = resolveCodegraphCommand();
  if (!codegraphCommand) {
    throw new Error('CodeGraph CLI is not installed');
  }
  const args =
    status === 'project_not_initialized'
      ? ['init', '-i']
      : status === 'index_incomplete'
        ? ['index']
        : ['sync'];
  execFileSync(codegraphCommand, args, {
    cwd: projectPath,
    stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
    timeout: status === 'index_stale' ? 300_000 : 600_000,
    shell: process.platform === 'win32',
  });
}

async function ensureCodegraphCli(
  projectPath: string,
  shouldInstall = true,
  quiet = false,
): Promise<string | null> {
  const existingCommand = resolveCodegraphCommand();
  if (existingCommand) return existingCommand;
  if (!shouldInstall) return null;

  if (!quiet) console.log('    Installing CodeGraph CLI...');
  try {
    execFileSync(getNpmExecutable(), ['install', '-g', '@colbymchenry/codegraph'], {
      cwd: projectPath,
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      timeout: 180_000,
      shell: process.platform === 'win32',
    });
    return resolveCodegraphCommand();
  } catch (error) {
    console.error(`    Failed to install CodeGraph CLI: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return null;
  }
}

async function installCodegraph(
  projectPath: string,
  scope: InstallScope,
  shouldInstallCli = true,
  quiet = false,
): Promise<'installed' | 'failed' | 'skipped'> {
  if (hasCodegraphProjectIndex(projectPath)) {
    if (!quiet) console.log('    CodeGraph: existing .codegraph index detected');
    return 'skipped';
  }

  const codegraphCommand = await ensureCodegraphCli(projectPath, shouldInstallCli, quiet);
  if (!codegraphCommand) {
    if (!shouldInstallCli) {
      if (!quiet) console.log('    CodeGraph CLI not installed, skipping setup');
      return 'skipped';
    }
    console.error(
      '    CodeGraph CLI not available. Install manually: npm install -g @colbymchenry/codegraph',
    );
    return 'failed';
  }

  try {
    if (!quiet) console.log('    Running: codegraph install --yes');
    execFileSync(codegraphCommand, ['install', '--yes'], {
      cwd: projectPath,
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      timeout: 120_000,
      shell: process.platform === 'win32',
    });
  } catch (error) {
    console.error(`    CodeGraph install failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  }

  if (scope === 'project') {
    try {
      if (!quiet) console.log('    Running: codegraph init -i');
      execFileSync(codegraphCommand, ['init', '-i'], {
        cwd: projectPath,
        stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
        timeout: 300_000,
        shell: process.platform === 'win32',
      });
    } catch (error) {
      console.error(`    CodeGraph init failed: ${(error as Error).message}`);
      printCommandErrorDetails(error);
      return 'failed';
    }
  }

  return 'installed';
}

async function initializeCodegraphProject(
  projectPath: string,
  shouldInstallCli = true,
  quiet = false,
): Promise<'installed' | 'failed' | 'skipped'> {
  if (hasCodegraphProjectIndex(projectPath)) {
    if (!quiet) console.log('    CodeGraph: existing .codegraph index detected');
    return 'skipped';
  }
  const codegraphCommand = await ensureCodegraphCli(projectPath, shouldInstallCli, quiet);
  if (!codegraphCommand) {
    if (!quiet) {
      console.error(
        '    CodeGraph CLI not available. Install manually: npm install -g @colbymchenry/codegraph',
      );
    }
    return shouldInstallCli ? 'failed' : 'skipped';
  }
  try {
    if (!quiet) console.log('    Running: codegraph init -i');
    execFileSync(codegraphCommand, ['init', '-i'], {
      cwd: projectPath,
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
      timeout: 600_000,
      shell: process.platform === 'win32',
    });
    return 'installed';
  } catch (error) {
    console.error(`    CodeGraph init failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  }
}

export {
  installCodegraph,
  initializeCodegraphProject,
  hasCodegraphProjectIndex,
  inspectCodegraphIntegration,
  inspectCodegraphIndex,
  repairCodegraphIndex,
  resolveCodegraphCommand,
};
export type {
  CodegraphAgentDiagnostic,
  CodegraphAgentId,
  CodegraphCliStatus,
  CodegraphIndexDiagnostic,
  CodegraphIndexStatus,
  CodegraphIntegrationDiagnostic,
  CodegraphMcpStatus,
  CodegraphProjectIndexStatus,
};
