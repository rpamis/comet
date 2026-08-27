import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import type { BigIntStats, Dirent } from 'fs';
import { copyFile, fileExists, readDir } from '../../platform/fs/file-system.js';
import { sameFileObject, type FileObjectIdentity } from '../../platform/fs/file-identity.js';
import {
  getOpenSpecVersion,
  isCommandAvailable,
  isOpenSpecVersionCompatible,
  MINIMUM_OPENSPEC_VERSION,
} from '../../domains/integrations/openspec.js';
import {
  inspectCodegraphIntegration,
  inspectCodegraphIndex,
  repairCodegraphIndex,
  type CodegraphIntegrationDiagnostic,
} from '../../domains/integrations/codegraph.js';
import {
  copyCometRulesForPlatform,
  readManifest,
  getAssetsDir,
  getManagedSkillPaths,
  getManagedSkillPathsForSelection,
} from '../../domains/skill/platform-install.js';
import {
  reconcileCometHooksForPlatform,
  reconcileProjectCometHooksForPlatform,
} from '../../domains/skill/hook-lifecycle.js';
import {
  getPlatformRuleDestinations,
  getLegacyPlatformRuleDestinations,
  inspectCometHooksForPlatform,
} from '../../domains/skill/platform-inspect.js';
import {
  PLATFORMS,
  getPlatformSkillsDir,
  getPlatformSkillsDirs,
  type Platform,
} from '../../platform/install/platforms.js';
import { hasSkills } from '../../platform/install/detect.js';
import { resolveCanonicalSkillRootOwners } from '../../platform/install/skill-root-owner.js';
import type { InstallScope } from '../../platform/install/types.js';
import { inspectClassicChangeReadOnly } from '../../domains/comet-classic/classic-diagnostics.js';
import {
  inspectClassicLayout,
  resolveClassicLayout,
} from '../../domains/comet-classic/classic-layout.js';
import { assertClassicOpenSpecRootHealthy } from '../../domains/comet-classic/classic-openspec-root.js';
import {
  inspectClassicRootMove,
  repairClassicRootMove,
} from '../../domains/comet-classic/classic-root-move.js';
import {
  inspectClassicLayoutInitialization,
  repairClassicLayoutInitialization,
} from '../../domains/comet-classic/classic-layout-initialization.js';
import { getCurrentVersion } from '../../platform/version/version.js';
import { repairCometCurrentSelection } from '../../domains/comet-entry/current-selection-repair.js';
import { readWorkflowProjectConfig } from '../../domains/workflow-contract/project-config-reader.js';
import { inspectProtectedProjectPath } from '../../domains/workflow-contract/protected-project-path.js';
import {
  inspectWorkflowProjectConfigTransaction,
  repairWorkflowProjectConfigTransaction,
} from '../../domains/workflow-contract/project-config-transaction.js';
import type { WorkflowProjectConfig } from '../../domains/workflow-contract/types.js';
import { resolveHookWorkflowOwner } from '../../domains/comet-entry/hook-router.js';
import type { InitWorkflowSelection } from '../../domains/comet-entry/types.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { projectCometHooksFromInstalledScope } from '../../domains/skill/project-hook-projection.js';
import { hasDshInstruction } from '../../domains/skill/dsh-adapter.js';

interface CheckResult {
  check: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

type DoctorScope = InstallScope | 'auto';
interface DoctorContext {
  homeDir: string;
}

type ManagedInstallAvailability = 'ready' | 'partial' | 'missing';

interface DoctorRuntimeDiagnostic {
  isSecondaryWorktree: boolean;
  currentWorktreeRoot: string | null;
  primaryWorktreeRoot: string | null;
  currentProjectInstall: ManagedInstallAvailability;
  primaryProjectInstall: ManagedInstallAvailability;
  globalFallbackReady: boolean;
  effectiveScope: 'project' | 'global' | 'none';
  remediation: string | null;
}

interface DoctorReport {
  results: CheckResult[];
  runtime: DoctorRuntimeDiagnostic;
  codegraph: CodegraphIntegrationDiagnostic | null;
}

const SUPERPOWERS_SENTINELS = [
  'using-superpowers/SKILL.md',
  'test-driven-development/SKILL.md',
  'writing-plans/SKILL.md',
] as const;
const HOOK_ROUTER_RUNTIME = 'comet/scripts/comet-hook-router.mjs';
const CLASSIC_PLATFORM_TOOL_SCAN_MAX_ENTRIES = 4096;
const CLASSIC_PLATFORM_TOOL_SCAN_MAX_DEPTH = 8;
const CLASSIC_PLATFORM_TOOL_SCAN_MAX_FINDINGS = 128;
const CLASSIC_PLATFORM_TOOL_ROOTS = [
  ...new Set([
    ...PLATFORMS.flatMap((platform) => getPlatformSkillsDirs(platform, 'project')),
    // OpenSpec commands for these platforms live outside their Skill roots.
    '.agent',
    '.clinerules',
  ]),
].sort();
const OPEN_SPEC_COMMAND_CONTAINER_NAMES = new Set(['command', 'commands', 'prompts', 'workflows']);

function configuredWorkflows(config: WorkflowProjectConfig | null): Array<'native' | 'classic'> {
  return config?.workflows ?? (config ? [config.default_workflow] : ['classic']);
}

function configuredSkillLanguage(
  config: WorkflowProjectConfig | null,
  workflows: Array<'native' | 'classic'>,
): 'zh' | 'en' {
  if (!config) return 'en';
  const ordered = [
    config.default_workflow,
    ...workflows.filter((workflow) => workflow !== config.default_workflow),
  ];
  for (const workflow of ordered) {
    if (!workflows.includes(workflow)) continue;
    const language = workflow === 'native' ? config.native?.language : config.classic?.language;
    if (language) return language === 'zh-CN' ? 'zh' : 'en';
  }
  return 'en';
}

function hookRouterRuntimePaths(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): { source: string; destination: string } {
  return {
    source: path.join(getAssetsDir(), 'skills', ...HOOK_ROUTER_RUNTIME.split('/')),
    destination: path.join(
      baseDir,
      getPlatformSkillsDir(platform, scope),
      'skills',
      ...HOOK_ROUTER_RUNTIME.split('/'),
    ),
  };
}

function checkCometCli(): CheckResult {
  return {
    check: 'Comet CLI',
    status: 'pass',
    message: `installed (${getCurrentVersion()})`,
  };
}

async function checkOpenSpecCli(): Promise<CheckResult> {
  if (!isCommandAvailable('openspec')) {
    return {
      check: 'openspec CLI',
      status: 'warn',
      message: 'not installed — install with: npm install -g @fission-ai/openspec@latest',
    };
  }
  const version = getOpenSpecVersion();
  if (!version || !isOpenSpecVersionCompatible(version)) {
    return {
      check: 'openspec CLI',
      status: 'warn',
      message: `installed (${version || 'version unknown'}), but Comet requires >= ${MINIMUM_OPENSPEC_VERSION} — run: npm install -g @fission-ai/openspec@latest`,
    };
  }
  return { check: 'openspec CLI', status: 'pass', message: `installed (${version})` };
}

function checkEnvironment(projectPath: string, context: DoctorContext): CheckResult {
  return {
    check: 'Environment',
    status: 'pass',
    message: `node ${process.version}; platform ${process.platform}/${process.arch}; project ${projectPath}; global ${context.homeDir}`,
  };
}

function checkScopeMode(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
): CheckResult | null {
  if (scope !== 'auto') return null;
  const includesGlobal = path.resolve(projectPath) !== path.resolve(context.homeDir);
  return {
    check: 'Scope',
    status: 'pass',
    message: includesGlobal
      ? 'auto checks project scope first, then global scope when it is different'
      : 'auto checks project scope only because project path is the global home directory',
  };
}

async function checkWorkingDirs(projectPath: string): Promise<CheckResult> {
  let layout;
  try {
    layout = await resolveClassicLayout(projectPath);
  } catch (error) {
    return {
      check: 'working directories',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const expected = [
    layout.changesDir,
    layout.archiveDir,
    layout.specsDir,
    layout.superpowersSpecsDir,
    layout.superpowersPlansDir,
    layout.superpowersReportsDir,
  ];
  let presence: boolean[];
  try {
    const inspections = await Promise.all(
      expected.map((directory) =>
        inspectProtectedProjectPath(
          projectPath,
          path.relative(projectPath, directory).replaceAll('\\', '/'),
          {
            label: `Classic working directory ${path
              .relative(projectPath, directory)
              .replaceAll('\\', '/')}`,
            expected: 'directory',
          },
        ),
      ),
    );
    presence = inspections.map((inspection) => inspection.exists);
  } catch (error) {
    return {
      check: 'working directories',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const missing = expected
    .filter((_, index) => !presence[index])
    .map((directory) => path.relative(projectPath, directory).replaceAll('\\', '/'));

  if (missing.length === 0) {
    return {
      check: 'working directories',
      status: 'pass',
      message: `present (${layout.artifactLayout})`,
    };
  }
  if (missing.length === expected.length) {
    return {
      check: 'working directories',
      status: 'warn',
      message:
        'project not initialized for Comet — run: comet init --scope project if this project should use Comet workflows',
    };
  }
  return {
    check: 'working directories',
    status: 'warn',
    message: `partial (missing: ${missing.join(', ')})`,
  };
}

async function checkClassicLayout(projectPath: string): Promise<CheckResult> {
  let transaction;
  try {
    transaction = await inspectClassicRootMove(projectPath);
  } catch (error) {
    return {
      check: 'Classic artifact layout',
      status: 'fail',
      message: `invalid root move journal; allowed strategies: none (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
  if (transaction) {
    const allowed =
      transaction.allowedStrategies.length > 0 ? transaction.allowedStrategies.join(', ') : 'none';
    return {
      check: 'Classic artifact layout',
      status: 'fail',
      message: `root move ${transaction.id} is incomplete at ${transaction.stage}; source ${transaction.source}; target ${transaction.target}; staging ${transaction.staging}; plan ${transaction.planId}; allowed strategies: ${allowed}${
        transaction.reason ? ` (${transaction.reason})` : ''
      }; run comet doctor --repair --strategy <strategy>`,
    };
  }
  let inspection;
  try {
    inspection = await inspectClassicLayout(projectPath);
  } catch (error) {
    return {
      check: 'Classic artifact layout',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (inspection.dualRoots) {
    const configuredRoot = path
      .relative(projectPath, inspection.paths.openSpecRoot)
      .replaceAll('\\', '/');
    const alternateRoot = path
      .relative(projectPath, inspection.alternateRoot)
      .replaceAll('\\', '/');
    return {
      check: 'Classic artifact layout',
      status: 'pass',
      message: `${inspection.paths.artifactLayout}: configured ${configuredRoot}/ present; standalone OpenSpec root ${alternateRoot}/ also present and ignored by Comet`,
    };
  }
  const configuredRoot = path
    .relative(projectPath, inspection.paths.openSpecRoot)
    .replaceAll('\\', '/');
  const alternateRoot = path.relative(projectPath, inspection.alternateRoot).replaceAll('\\', '/');
  if (!inspection.configuredRootExists) {
    return {
      check: 'Classic artifact layout',
      status: 'fail',
      message: `${inspection.paths.artifactLayout}: configured ${configuredRoot}/ missing; alternate ${alternateRoot}/ ${
        inspection.alternateRootExists ? 'present' : 'missing'
      } — run: comet classic root show, then restore the configured root or use comet classic root move`,
    };
  }
  return {
    check: 'Classic artifact layout',
    status: 'pass',
    message: `${inspection.paths.artifactLayout}: configured ${configuredRoot}/ present; alternate ${alternateRoot}/ ${
      inspection.alternateRootExists ? 'present' : 'missing'
    }`,
  };
}

async function checkClassicInitialization(projectPath: string): Promise<CheckResult | null> {
  try {
    const initialization = await inspectClassicLayoutInitialization(projectPath);
    if (!initialization) return null;
    const location = initialization.quarantine ? `; preserved at ${initialization.quarantine}` : '';
    return {
      check: 'Classic initialization',
      status: 'warn',
      message: `${initialization.id} at ${initialization.stage}${location}; allowed strategies: ${initialization.allowedStrategies.join(', ')}`,
    };
  } catch (error) {
    return {
      check: 'Classic initialization',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkProjectConfigWriteTransaction(
  projectPath: string,
): Promise<CheckResult | null> {
  try {
    const transaction = await inspectWorkflowProjectConfigTransaction(projectPath);
    if (!transaction) return null;
    return {
      check: 'project config write transaction',
      status: 'warn',
      message: `${transaction.id} at ${transaction.stage}; repair with: comet doctor --repair`,
    };
  } catch (error) {
    return {
      check: 'project config write transaction',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkClassicOpenSpecRoot(projectPath: string): Promise<CheckResult> {
  try {
    const health = await assertClassicOpenSpecRootHealthy(projectPath);
    return {
      check: 'Classic OpenSpec root',
      status: 'pass',
      message: `${health.configPath} is valid (${health.schema})`,
    };
  } catch (error) {
    return {
      check: 'Classic OpenSpec root',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

interface DoctorDirectoryIdentity {
  object: FileObjectIdentity;
  ctimeNs: bigint;
  mtimeNs: bigint;
  size: bigint;
}

function doctorDirectoryIdentity(stat: BigIntStats): DoctorDirectoryIdentity {
  return {
    object: {
      dev: stat.dev,
      ino: stat.ino,
      birthtime: stat.birthtimeNs,
    },
    ctimeNs: stat.ctimeNs,
    mtimeNs: stat.mtimeNs,
    size: stat.size,
  };
}

function sameDoctorDirectory(
  left: DoctorDirectoryIdentity,
  right: DoctorDirectoryIdentity,
): boolean {
  return (
    sameFileObject(left.object, right.object) &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs &&
    left.size === right.size
  );
}

async function readDoctorPlatformDirectory(
  projectPath: string,
  relativeDirectory: string,
  maxEntries: number,
): Promise<Dirent[] | null> {
  const label = `Classic platform tool directory ${relativeDirectory}`;
  const inspection = await inspectProtectedProjectPath(projectPath, relativeDirectory, {
    label,
    expected: 'directory',
  });
  if (!inspection.exists) return null;

  const beforeStat = await fs.lstat(inspection.target, { bigint: true });
  if (!beforeStat.isDirectory() || beforeStat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  const before = doctorDirectoryIdentity(beforeStat);
  const entries: Dirent[] = [];
  let readError: unknown;
  const directory = await fs.opendir(inspection.target);
  try {
    for await (const entry of directory) {
      entries.push(entry);
      if (entries.length > maxEntries) {
        throw new Error(
          `Classic platform tool scan exceeds ${CLASSIC_PLATFORM_TOOL_SCAN_MAX_ENTRIES} entries`,
        );
      }
    }
  } catch (error) {
    readError = error;
  } finally {
    await directory.close().catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED' && !readError) {
        readError = error;
      }
    });
  }

  const afterInspection = await inspectProtectedProjectPath(projectPath, relativeDirectory, {
    label,
    expected: 'directory',
  });
  if (!afterInspection.exists) {
    throw new Error(`${label} changed while being inspected`);
  }
  const afterStat = await fs.lstat(afterInspection.target, { bigint: true });
  if (
    !afterStat.isDirectory() ||
    afterStat.isSymbolicLink() ||
    !sameDoctorDirectory(before, doctorDirectoryIdentity(afterStat))
  ) {
    throw new Error(`${label} changed while being inspected`);
  }
  if (readError) throw readError;
  return entries;
}

function isOpenSpecPlatformToolSentinel(relativePath: string, kind: 'file' | 'directory'): boolean {
  const segments = relativePath.split('/');
  const name = segments.at(-1) ?? '';
  const parent = segments.at(-2) ?? '';
  if (kind === 'directory' && parent === 'skills' && /^openspec-[a-z0-9-]+$/iu.test(name)) {
    return true;
  }
  if (kind !== 'file') return false;

  const insideCommandContainer = segments.some((segment) =>
    OPEN_SPEC_COMMAND_CONTAINER_NAMES.has(segment),
  );
  if (!insideCommandContainer) return false;
  return /^(?:opsx|openspec)-[a-z0-9-]+\.[a-z0-9.]+$/iu.test(name) || segments.includes('opsx');
}

async function findClassicArtifactPlatformTools(
  projectPath: string,
  artifactBaseRelative: string,
): Promise<string[]> {
  const findings = new Set<string>();
  const queue = CLASSIC_PLATFORM_TOOL_ROOTS.map((platformRoot) => ({
    relative: path.posix.join(artifactBaseRelative, platformRoot.replaceAll('\\', '/')),
    depth: 0,
  }));
  let inspectedEntries = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readDoctorPlatformDirectory(
      projectPath,
      current.relative,
      CLASSIC_PLATFORM_TOOL_SCAN_MAX_ENTRIES - inspectedEntries,
    );
    if (!entries) continue;

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      inspectedEntries += 1;
      if (inspectedEntries > CLASSIC_PLATFORM_TOOL_SCAN_MAX_ENTRIES) {
        throw new Error(
          `Classic platform tool scan exceeds ${CLASSIC_PLATFORM_TOOL_SCAN_MAX_ENTRIES} entries`,
        );
      }
      const relative = path.posix.join(current.relative, entry.name);
      const inspection = await inspectProtectedProjectPath(projectPath, relative, {
        label: `Classic platform tool candidate ${relative}`,
        expected: 'any',
      });
      if (!inspection.exists) {
        throw new Error(
          `Classic platform tool candidate ${relative} changed while being inspected`,
        );
      }
      const kind = inspection.kind === 'directory' ? 'directory' : 'file';
      if (isOpenSpecPlatformToolSentinel(relative, kind)) {
        findings.add(relative);
        if (findings.size > CLASSIC_PLATFORM_TOOL_SCAN_MAX_FINDINGS) {
          throw new Error(
            `Classic platform tool scan exceeds ${CLASSIC_PLATFORM_TOOL_SCAN_MAX_FINDINGS} findings`,
          );
        }
        continue;
      }
      if (kind === 'directory') {
        if (current.depth >= CLASSIC_PLATFORM_TOOL_SCAN_MAX_DEPTH) {
          throw new Error(
            `Classic platform tool scan exceeds depth ${CLASSIC_PLATFORM_TOOL_SCAN_MAX_DEPTH} at ${relative}`,
          );
        }
        queue.push({ relative, depth: current.depth + 1 });
      }
    }
  }

  return [...findings].sort();
}

async function checkClassicPlatformToolAssets(projectPath: string): Promise<CheckResult | null> {
  let layout;
  try {
    layout = await resolveClassicLayout(projectPath);
  } catch {
    // The dedicated layout check already reports why the configured layout
    // cannot be trusted. Do not guess whether the docs-only check applies.
    return null;
  }
  if (layout.artifactLayout !== 'docs') return null;

  const artifactBaseRelative = path
    .relative(projectPath, layout.openSpecBase)
    .replaceAll('\\', '/');
  try {
    const findings = await findClassicArtifactPlatformTools(projectPath, artifactBaseRelative);
    if (findings.length === 0) {
      return {
        check: 'Classic platform tool assets',
        status: 'pass',
        message: 'no OpenSpec platform tool assets under docs/',
      };
    }
    return {
      check: 'Classic platform tool assets',
      status: 'fail',
      message: `found OpenSpec platform tool assets under the docs artifact root: ${findings.join(
        ', ',
      )}; these assets belong in platform directories at the project root — run comet update to repair the platform installation. Doctor did not move any files.`,
    };
  } catch (error) {
    return {
      check: 'Classic platform tool assets',
      status: 'fail',
      message: `could not safely inspect platform tool assets under docs/: ${
        error instanceof Error ? error.message : String(error)
      }; platform tool assets belong in platform directories at the project root — run comet update to repair the platform installation. Doctor did not move any files.`,
    };
  }
}

async function checkSuperpowers(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
): Promise<CheckResult> {
  const detected: string[] = [];
  for (const base of getScopeBases(projectPath, scope, context)) {
    for (const platform of PLATFORMS) {
      if (
        await hasSkills(base.baseDir, platform, 'superpowers', [platform], base.scope, {
          includeGlobalFallback: false,
          includePluginFallback: base.scope === 'global',
        })
      ) {
        detected.push(`${platform.name} ${base.scope}`);
        continue;
      }
      for (const skillsDir of getPlatformSkillsDirs(platform, base.scope)) {
        for (const sentinel of SUPERPOWERS_SENTINELS) {
          if (await fileExists(path.join(base.baseDir, skillsDir, 'skills', sentinel))) {
            detected.push(`${platform.name} ${base.scope}`);
            break;
          }
        }
      }
    }
  }

  const uniqueDetected = [...new Set(detected)];
  if (uniqueDetected.length > 0) {
    return {
      check: 'Superpowers',
      status: 'pass',
      message: `detected (${uniqueDetected.join(', ')}; version not recorded by skills installer)`,
    };
  }

  return {
    check: 'Superpowers',
    status: 'warn',
    message: 'not detected — install with: npx skills add obra/superpowers -y --agent <platform>',
  };
}

function getScopeBases(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
): Array<{
  scope: InstallScope;
  baseDir: string;
}> {
  if (scope === 'project') return [{ scope, baseDir: projectPath }];
  if (scope === 'global') return [{ scope, baseDir: context.homeDir }];

  const bases: Array<{ scope: InstallScope; baseDir: string }> = [
    { scope: 'project', baseDir: projectPath },
  ];
  if (path.resolve(projectPath) !== path.resolve(context.homeDir)) {
    bases.push({ scope: 'global', baseDir: context.homeDir });
  }
  return bases;
}

function globalHookCheckResult(
  platform: Platform,
  scope: InstallScope,
  inspection: Awaited<ReturnType<typeof inspectCometHooksForPlatform>>,
): CheckResult {
  const globalHookPresent =
    inspection.present || inspection.managedPresent === true || inspection.legacyPresent === true;
  return {
    check: `hooks: ${platform.name} (${scope})`,
    status:
      globalHookPresent || inspection.error || inspection.activationRequired ? 'warn' : 'pass',
    message: inspection.error
      ? `${inspection.error} — run: comet doctor --repair --scope global`
      : inspection.activationRequired
        ? 'Hook config and Cordis patch are present; the active dsh profile must load the official bridge'
        : globalHookPresent
          ? 'global blocking Hook remains — run: comet doctor --repair --scope global'
          : 'no global blocking Hook present',
  };
}

async function checkPlatformComponents(
  baseDir: string,
  platform: (typeof PLATFORMS)[number],
  scope: InstallScope,
  workflowSelection: InitWorkflowSelection,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const ruleDestinations = await getPlatformRuleDestinations(
    baseDir,
    platform,
    scope,
    workflowSelection,
  );
  if (ruleDestinations.length > 0) {
    let present = 0;
    const inspectionErrors: string[] = [];
    for (const destination of ruleDestinations) {
      try {
        if (
          platform.rulesFormat === 'dsh'
            ? await hasDshInstruction(baseDir, platform, scope)
            : await fileExists(destination)
        ) {
          present++;
        }
      } catch (error) {
        inspectionErrors.push(`${destination}: ${(error as Error).message}`);
      }
    }
    results.push({
      check: `rules: ${platform.name} (${scope})`,
      status:
        inspectionErrors.length === 0 && present === ruleDestinations.length ? 'pass' : 'warn',
      message:
        inspectionErrors.length > 0
          ? `unable to inspect managed Rule (${inspectionErrors.join('; ')}) — run: comet update --scope ${scope}`
          : present === ruleDestinations.length
            ? `complete (${present} files)`
            : `partial (${present}/${ruleDestinations.length} files) — run: comet update --scope ${scope}`,
    });
    const legacyRuleDestinations = getLegacyPlatformRuleDestinations(baseDir, platform, scope);
    let legacyRules = 0;
    const legacyInspectionErrors: string[] = [];
    for (const destination of legacyRuleDestinations) {
      try {
        if (await fileExists(destination)) legacyRules++;
      } catch (error) {
        legacyInspectionErrors.push(`${destination}: ${(error as Error).message}`);
      }
    }
    if (legacyInspectionErrors.length > 0) {
      results.push({
        check: `legacy rules: ${platform.name} (${scope})`,
        status: 'warn',
        message: `unable to inspect legacy managed Rule (${legacyInspectionErrors.join('; ')})`,
      });
    }
    if (legacyRules > 0) {
      results.push({
        check: `legacy rules: ${platform.name} (${scope})`,
        status: 'warn',
        message: `${legacyRules} legacy managed Rule file(s) remain — run: comet doctor --repair --scope ${scope}`,
      });
    }
  }

  results.push(...(await checkHookComponents(baseDir, platform, scope, workflowSelection)));

  return results;
}

async function checkHookComponents(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  workflowSelection: InitWorkflowSelection,
): Promise<CheckResult[]> {
  if (!platform.supportsHooks || !platform.hookFormat) return [];

  const results: CheckResult[] = [];
  const runtime = hookRouterRuntimePaths(baseDir, platform, scope);
  try {
    const [expected, installed] = await Promise.all([
      fs.readFile(runtime.source),
      fs.readFile(runtime.destination),
    ]);
    results.push({
      check: `hook runtime: ${platform.name} (${scope})`,
      status: expected.equals(installed) ? 'pass' : 'warn',
      message: expected.equals(installed)
        ? 'current'
        : `outdated — run: comet doctor --repair --scope ${scope}`,
    });
  } catch (error) {
    results.push({
      check: `hook runtime: ${platform.name} (${scope})`,
      status: 'warn',
      message: `unable to verify current Router runtime (${(error as Error).message}) — run: comet doctor --repair --scope ${scope}`,
    });
  }
  const inspection = await inspectCometHooksForPlatform(
    baseDir,
    platform,
    scope,
    workflowSelection,
  );
  if (scope === 'global') {
    results.push(globalHookCheckResult(platform, scope, inspection));
    return results;
  }
  results.push({
    check: `hooks: ${platform.name} (${scope})`,
    status:
      inspection.present &&
      !inspection.error &&
      !inspection.legacyPresent &&
      !inspection.duplicatePresent &&
      !inspection.activationRequired
        ? 'pass'
        : 'warn',
    message:
      inspection.present &&
      !inspection.error &&
      !inspection.legacyPresent &&
      !inspection.duplicatePresent
        ? 'exactly one managed Router Hook present'
        : inspection.present && inspection.duplicatePresent
          ? `duplicate managed Router Hooks remain — run: comet doctor --repair --scope ${scope}`
          : inspection.present && inspection.legacyPresent
            ? `Router Hook and legacy managed Hook coexist — run: comet doctor --repair --scope ${scope}`
            : inspection.present && inspection.activationRequired
              ? 'Hook config and Cordis patch are present; load the official bridge and run dsh with the project patch'
              : `${inspection.error ?? 'managed Hook missing'} — run: comet update --scope ${scope}`,
  });
  return results;
}

async function getPlatformsForSkillInspection(
  baseDir: string,
  scope: InstallScope,
  doctorScope: DoctorScope,
): Promise<Array<{ platform: Platform; inspectComponents: boolean }>> {
  return (
    await resolveCanonicalSkillRootOwners(baseDir, scope, {
      respectDetectionPaths: doctorScope === 'auto',
    })
  ).map(({ platform, hasOwnershipEvidence, sharedCanonicalRoot }) => ({
    platform,
    inspectComponents: !sharedCanonicalRoot || hasOwnershipEvidence,
  }));
}

async function getHookOnlyInspections(
  baseDir: string,
  scope: InstallScope,
  knownPlatformIds: ReadonlySet<string>,
): Promise<
  Array<{
    platform: Platform;
    inspection: Awaited<ReturnType<typeof inspectCometHooksForPlatform>>;
  }>
> {
  const results: Array<{
    platform: Platform;
    inspection: Awaited<ReturnType<typeof inspectCometHooksForPlatform>>;
  }> = [];
  for (const platform of PLATFORMS) {
    if (knownPlatformIds.has(platform.id) || !platform.supportsHooks || !platform.hookFormat) {
      continue;
    }
    const inspection = await inspectCometHooksForPlatform(baseDir, platform, scope);
    if (
      inspection.present ||
      inspection.managedPresent ||
      inspection.legacyPresent ||
      inspection.error
    ) {
      results.push({ platform, inspection });
    }
  }
  return results;
}

async function checkSkillCompleteness(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
  workflowSelection: InitWorkflowSelection,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const manifest = await readManifest();

  let anyCometInstall = false;
  const scopeState: Record<InstallScope, { hasInstall: boolean; hasComplete: boolean }> = {
    project: { hasInstall: false, hasComplete: false },
    global: { hasInstall: false, hasComplete: false },
  };
  for (const base of getScopeBases(projectPath, scope, context)) {
    const managedSkills = getManagedSkillPathsForSelection(
      manifest,
      base.scope === 'global' ? 'classic' : workflowSelection,
    );
    const total = managedSkills.length;
    const platforms = await getPlatformsForSkillInspection(base.baseDir, base.scope, scope);
    const detectedPlatformIds = new Set<string>();
    for (const { platform, inspectComponents } of platforms) {
      const skillsDirs = getPlatformSkillsDirs(platform, base.scope);
      const canonicalSkillsDir = skillsDirs[0];
      let detectedSkillsDir: string | undefined;
      let present: string[] = [];
      let missing: string[] = [];
      for (const skillsDir of skillsDirs) {
        const candidatePresent: string[] = [];
        const candidateMissing: string[] = [];
        for (const relPath of managedSkills) {
          const fullPath = path.join(base.baseDir, skillsDir, 'skills', relPath);
          if (await fileExists(fullPath)) candidatePresent.push(relPath);
          else candidateMissing.push(relPath);
        }
        if (candidatePresent.length === 0) continue;
        detectedSkillsDir = skillsDir;
        present = candidatePresent;
        missing = candidateMissing;
        break;
      }

      if (!detectedSkillsDir) continue;
      detectedPlatformIds.add(platform.id);
      anyCometInstall = true;
      scopeState[base.scope].hasInstall = true;
      const isLegacy = detectedSkillsDir !== canonicalSkillsDir;
      if (missing.length === 0 && !isLegacy) {
        scopeState[base.scope].hasComplete = true;
      }

      results.push(
        isLegacy
          ? {
              check: `skills: ${platform.name} (${base.scope})`,
              status: 'warn' as const,
              message: `legacy installation (${present.length}/${total} files) — run: comet update --scope ${base.scope}`,
            }
          : missing.length === 0
            ? {
                check: `skills: ${platform.name} (${base.scope})`,
                status: 'pass' as const,
                message: `complete (${total} files)`,
              }
            : {
                check: `skills: ${platform.name} (${base.scope})`,
                status: 'warn' as const,
                message: `partial (${present.length}/${total} files; missing ${missing.length}) — run: comet update --scope ${base.scope}`,
              },
      );
      if (inspectComponents) {
        results.push(
          ...(await checkPlatformComponents(
            base.baseDir,
            platform,
            base.scope,
            base.scope === 'global' ? 'classic' : workflowSelection,
          )),
        );
      }
    }
    for (const { platform } of await getHookOnlyInspections(
      base.baseDir,
      base.scope,
      detectedPlatformIds,
    )) {
      results.push(
        ...(await checkHookComponents(
          base.baseDir,
          platform,
          base.scope,
          base.scope === 'global' ? 'classic' : workflowSelection,
        )),
      );
    }
  }

  if (scope === 'auto' && !scopeState.project.hasInstall && scopeState.global.hasComplete) {
    results.push({
      check: 'Project scope',
      status: 'pass',
      message:
        'no project-local Comet skills installed; global scope is available — run: comet init --scope project only if this project needs its own copy',
    });
  }

  if (!anyCometInstall) {
    results.push({
      check: 'Comet skills',
      status: 'warn',
      message:
        scope === 'auto'
          ? 'not installed in project or global scope — run: comet init'
          : `not installed in ${scope} scope — run: comet init --scope ${scope}`,
    });
  }

  return results;
}

async function checkScriptsPresent(): Promise<CheckResult> {
  const assetsDir = getAssetsDir();
  const scriptsDir = path.join(assetsDir, 'skills', 'comet', 'scripts');
  if (!(await fileExists(scriptsDir))) {
    return { check: 'scripts present', status: 'warn', message: 'scripts directory not found' };
  }

  const entries = await readDir(scriptsDir);
  const scriptFiles = entries.filter((e) => e.endsWith('.mjs'));

  return {
    check: 'scripts present',
    status: 'pass',
    message: `OK (${scriptFiles.length} scripts)`,
  };
}

function formatMissingEvidence(missingEvidence: readonly string[]): string {
  return missingEvidence.join(', ');
}

function formatRuntimeEvalRecovery(
  nextCommand: string | null,
  missingEvidence: readonly string[],
): string {
  const missing = formatMissingEvidence(missingEvidence);
  if (nextCommand) {
    return `run ${nextCommand} or restore missing evidence (${missing}), then rerun comet doctor`;
  }
  return `restore missing evidence (${missing}) and rerun comet doctor`;
}

async function checkCometYamlValidity(projectPath: string): Promise<CheckResult[]> {
  let changesDir: string;
  try {
    const inspection = await inspectClassicLayout(projectPath);
    if (!inspection.configuredRootExists) return [];
    changesDir = inspection.paths.changesDir;
    const changesInspection = await inspectProtectedProjectPath(
      projectPath,
      path.relative(projectPath, changesDir).replaceAll('\\', '/'),
      {
        label: 'Classic changes directory',
        expected: 'directory',
      },
    );
    if (!changesInspection.exists) return [];
  } catch {
    // The layout check reports the concrete root/config problem. Do not follow
    // an unsafe or unavailable configured root merely to enumerate state.
    return [];
  }

  const entries = await readDir(changesDir);
  const results: CheckResult[] = [];

  for (const entry of entries) {
    if (entry === 'archive') continue;
    const changeDir = path.join(changesDir, entry);
    const yamlPath = path.join(changeDir, '.comet.yaml');
    const runtimePath = path.join(changeDir, '.comet');
    try {
      const changeInspection = await inspectProtectedProjectPath(
        projectPath,
        path.relative(projectPath, changeDir).replaceAll('\\', '/'),
        {
          label: `Classic change ${entry}`,
          expected: 'directory',
        },
      );
      if (!changeInspection.exists) continue;
      const yamlInspection = await inspectProtectedProjectPath(
        projectPath,
        path.relative(projectPath, yamlPath).replaceAll('\\', '/'),
        {
          label: `Classic state ${entry}`,
          expected: 'file',
        },
      );
      if (!yamlInspection.exists) continue;
      await inspectProtectedProjectPath(
        projectPath,
        path.relative(projectPath, runtimePath).replaceAll('\\', '/'),
        {
          label: `Classic runtime directory ${entry}`,
          expected: 'directory',
        },
      );
    } catch (error) {
      results.push({
        check: `.comet.yaml: ${entry}`,
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const diagnostic = await inspectClassicChangeReadOnly(changeDir, entry);
    if (diagnostic.valid) {
      const step =
        diagnostic.currentStep ??
        (diagnostic.runtimeMode === 'legacy-state' ? `legacy:${diagnostic.phase}` : 'completed');
      results.push({
        check: `.comet.yaml: ${entry}`,
        status: 'pass',
        message: `valid (step: ${step}, mode: ${diagnostic.runtimeMode})`,
      });
      if (diagnostic.runtimeEval) {
        const runtimeCheckMessage = diagnostic.runtimeEval.passed
          ? `pass (${diagnostic.runtimeEval.stepId})`
          : `fail (${diagnostic.runtimeEval.stepId}; missing: ${formatMissingEvidence(diagnostic.runtimeEval.missingEvidence)}; next: ${formatRuntimeEvalRecovery(diagnostic.nextCommand, diagnostic.runtimeEval.missingEvidence)})`;
        results.push({
          check: `runtime_check: ${entry}`,
          status: diagnostic.runtimeEval.passed ? 'pass' : 'warn',
          message: runtimeCheckMessage,
        });
      }
      continue;
    }

    results.push({
      check: `.comet.yaml: ${entry}`,
      status: 'fail',
      message: diagnostic.error ?? 'invalid Classic state',
    });
    results.push({
      check: `next: ${entry}`,
      status: 'warn',
      message: 'inspect .comet.yaml and rerun comet doctor',
    });
  }

  return results;
}

function codegraphCheckResults(diagnostic: CodegraphIntegrationDiagnostic): CheckResult[] {
  const cliResult: CheckResult = {
    check: 'CodeGraph CLI',
    status: diagnostic.cliStatus === 'installed' ? 'pass' : 'warn',
    message:
      diagnostic.cliStatus === 'installed'
        ? 'CodeGraph CLI is installed'
        : diagnostic.remediation
          ? `${diagnostic.detail} — run: ${diagnostic.remediation}`
          : diagnostic.detail,
  };
  const indexResult: CheckResult = {
    check: 'CodeGraph project index',
    status:
      diagnostic.indexStatus === 'current' || diagnostic.indexStatus === 'not_checked'
        ? 'pass'
        : 'warn',
    message:
      diagnostic.indexStatus === 'not_checked'
        ? 'project index is not part of global scope'
        : diagnostic.indexStatus === 'current'
          ? diagnostic.detail
          : diagnostic.remediation
            ? `${diagnostic.detail} — run: ${diagnostic.remediation}`
            : diagnostic.detail,
  };
  const agentSummary =
    diagnostic.agents.length === 0
      ? 'no supported Agent configuration detected'
      : diagnostic.agents
          .map(
            (agent) =>
              `${agent.name}: ${agent.registered ? (agent.valid ? 'registered' : 'invalid entry') : 'not registered'}`,
          )
          .join('; ');
  const mcpResult: CheckResult = {
    check: 'CodeGraph MCP registration',
    status: diagnostic.mcpStatus === 'registered' ? 'pass' : 'warn',
    message: agentSummary,
  };
  const effectiveResults = diagnostic.agents.map((agent) => ({
    check: `CodeGraph effective for ${agent.name}`,
    status: agent.effective ? ('pass' as const) : ('warn' as const),
    message: agent.effective
      ? 'CLI, current project index, and MCP registration are ready'
      : 'not ready — requires an installed CLI, current project index, and valid MCP registration',
  }));
  return [cliResult, indexResult, mcpResult, ...effectiveResults];
}

async function inspectManagedInstallAvailability(
  baseDir: string,
  scope: InstallScope,
  workflowSelection: InitWorkflowSelection,
): Promise<ManagedInstallAvailability> {
  const manifest = await readManifest();
  const managedSkills = getManagedSkillPathsForSelection(
    manifest,
    scope === 'global' ? 'classic' : workflowSelection,
  );
  let partial = false;
  for (const platform of PLATFORMS) {
    const skillsDirs = getPlatformSkillsDirs(platform, scope);
    const canonicalSkillsDir = skillsDirs[0];
    for (const skillsDir of skillsDirs) {
      const presence = await Promise.all(
        managedSkills.map((relative) =>
          fileExists(path.join(baseDir, skillsDir, 'skills', ...relative.split('/'))),
        ),
      );
      const present = presence.filter(Boolean).length;
      if (present === managedSkills.length && skillsDir === canonicalSkillsDir) return 'ready';
      if (present > 0) partial = true;
    }
  }
  return partial ? 'partial' : 'missing';
}

async function inspectDoctorRuntime(
  projectPath: string,
  context: DoctorContext,
  workflowSelection: InitWorkflowSelection,
): Promise<DoctorRuntimeDiagnostic> {
  const worktree = inspectGitWorktree(projectPath);
  const currentProjectInstall = await inspectManagedInstallAvailability(
    projectPath,
    'project',
    workflowSelection,
  );
  const primaryProjectInstall =
    worktree.isSecondaryWorktree && worktree.primaryWorktreeRoot
      ? await inspectManagedInstallAvailability(
          worktree.primaryWorktreeRoot,
          'project',
          workflowSelection,
        )
      : currentProjectInstall;
  const globalFallbackReady =
    (await inspectManagedInstallAvailability(context.homeDir, 'global', 'classic')) === 'ready';
  const effectiveScope =
    currentProjectInstall !== 'missing' ? 'project' : globalFallbackReady ? 'global' : 'none';
  const remediation =
    effectiveScope !== 'none'
      ? null
      : worktree.isSecondaryWorktree && primaryProjectInstall === 'ready'
        ? 'run comet init . --scope project in this worktree, or install a global fallback'
        : 'run comet init . --scope project';
  return {
    isSecondaryWorktree: worktree.isSecondaryWorktree,
    currentWorktreeRoot: worktree.currentWorktreeRoot,
    primaryWorktreeRoot: worktree.primaryWorktreeRoot,
    currentProjectInstall,
    primaryProjectInstall,
    globalFallbackReady,
    effectiveScope,
    remediation,
  };
}

function worktreeRuntimeCheck(runtime: DoctorRuntimeDiagnostic): CheckResult | null {
  if (!runtime.isSecondaryWorktree) return null;
  if (runtime.currentProjectInstall === 'ready') {
    return {
      check: 'Worktree runtime',
      status: 'pass',
      message: 'secondary Git worktree has a complete project-scope Comet installation',
    };
  }
  if (runtime.primaryProjectInstall === 'ready' && runtime.globalFallbackReady) {
    return {
      check: 'Worktree runtime',
      status: 'pass',
      message:
        'project assets exist only in the primary worktree; this worktree uses a complete global fallback and does not execute primary-worktree files',
    };
  }
  return {
    check: 'Worktree runtime',
    status: runtime.effectiveScope === 'none' ? 'fail' : 'warn',
    message:
      runtime.primaryProjectInstall === 'ready'
        ? `project assets exist only in the primary worktree and are not executed here; ${runtime.remediation}`
        : `secondary worktree has no complete effective runtime; ${runtime.remediation}`,
  };
}

async function collectResults(projectPath: string, scope: DoctorScope): Promise<DoctorReport> {
  const context = { homeDir: os.homedir() };
  return collectResultsWithContext(projectPath, scope, context);
}

async function collectResultsWithContext(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
): Promise<DoctorReport> {
  const results: CheckResult[] = [];
  if (scope !== 'global') {
    const configTransaction = await checkProjectConfigWriteTransaction(projectPath);
    if (configTransaction) results.push(configTransaction);
  }
  let config = null;
  let configError: string | null = null;
  if (scope !== 'global') {
    try {
      config = await readWorkflowProjectConfig(projectPath);
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error);
    }
  }
  const workflows = configError ? ['native', 'classic'] : configuredWorkflows(config);
  const workflowSelection: InitWorkflowSelection =
    workflows.includes('native') && workflows.includes('classic')
      ? 'both'
      : workflows.includes('native')
        ? 'native'
        : 'classic';
  const classicEnabled = workflowSelection !== 'native';
  const runtime = await inspectDoctorRuntime(projectPath, context, workflowSelection);
  const worktreeCheck = worktreeRuntimeCheck(runtime);
  if (worktreeCheck) results.push(worktreeCheck);
  if (configError) {
    results.push({ check: 'project config', status: 'fail', message: configError });
  }
  const scopeMode = checkScopeMode(projectPath, scope, context);
  if (scopeMode) results.push(scopeMode);
  results.push(checkEnvironment(projectPath, context));
  results.push(checkCometCli());
  if (scope !== 'global') {
    const classicInitialization = await checkClassicInitialization(projectPath);
    if (classicInitialization) results.push(classicInitialization);
  }
  if (classicEnabled) {
    results.push(await checkOpenSpecCli());
    results.push(
      await checkSuperpowers(
        projectPath,
        scope === 'project' && runtime.isSecondaryWorktree && runtime.globalFallbackReady
          ? 'auto'
          : scope,
        context,
      ),
    );
    if (scope !== 'global') {
      const classicLayout = await checkClassicLayout(projectPath);
      results.push(classicLayout);
      const platformToolAssets = await checkClassicPlatformToolAssets(projectPath);
      if (platformToolAssets) results.push(platformToolAssets);
      results.push(await checkClassicOpenSpecRoot(projectPath));
      results.push(await checkWorkingDirs(projectPath));
    }
  }
  const skillResults = await checkSkillCompleteness(projectPath, scope, context, workflowSelection);
  if (
    scope === 'project' &&
    runtime.isSecondaryWorktree &&
    runtime.primaryProjectInstall === 'ready' &&
    runtime.currentProjectInstall === 'missing'
  ) {
    const missing = skillResults.find((result) => result.check === 'Comet skills');
    if (missing) {
      missing.status = runtime.globalFallbackReady ? 'pass' : 'warn';
      missing.message = runtime.globalFallbackReady
        ? 'not copied into this secondary worktree; primary-worktree assets remain isolated and a complete global fallback is active'
        : `not copied into this secondary worktree; primary-worktree assets are not executed here — ${runtime.remediation}`;
    }
  }
  results.push(...skillResults);
  results.push(await checkScriptsPresent());
  const codegraph = inspectCodegraphIntegration(
    projectPath,
    scope === 'global' ? 'global' : 'project',
    context.homeDir,
  );
  results.push(...codegraphCheckResults(codegraph));
  if (classicEnabled && !configError && config && workflows.includes('classic')) {
    results.push(...(await checkCometYamlValidity(projectPath)));
  }
  if (scope !== 'global') {
    results.push(
      configError
        ? {
            check: 'current selection',
            status: 'fail',
            message: `unavailable because project config is invalid: ${configError}`,
          }
        : await checkCurrentSelection(projectPath),
    );
  }
  return { results, runtime, codegraph };
}

async function checkCurrentSelection(projectPath: string): Promise<CheckResult> {
  const resolution = await resolveHookWorkflowOwner(projectPath);
  if (resolution.status === 'none') {
    return resolution.staleSelection
      ? {
          check: 'current selection',
          status: 'warn',
          message: `${resolution.staleSelection.reason}; no active Comet change`,
        }
      : { check: 'current selection', status: 'pass', message: 'no active Comet change' };
  }
  if (resolution.status === 'owned') {
    return {
      check: 'current selection',
      status: 'pass',
      message: `${resolution.owner.workflow}:${resolution.owner.name} (${resolution.owner.phase})`,
    };
  }
  if (resolution.status === 'inferred') {
    return {
      check: 'current selection',
      status: 'warn',
      message: `${resolution.staleSelection ? `${resolution.staleSelection.reason}; ` : 'missing; '}Router can infer ${resolution.owner.workflow}:${resolution.owner.name} read-only — select it explicitly before concurrent work`,
    };
  }
  if (resolution.status === 'ambiguous') {
    return {
      check: 'current selection',
      status: 'fail',
      message: `${resolution.staleSelection ? `${resolution.staleSelection.reason}; ` : 'missing with '}multiple active changes: ${resolution.candidates.map((candidate) => `${candidate.workflow}:${candidate.name}`).join(', ')}`,
    };
  }
  if (resolution.status === 'stale') {
    return { check: 'current selection', status: 'fail', message: resolution.reason };
  }
  return { check: 'current selection', status: 'fail', message: 'unknown selection state' };
}

async function hasManagedInstall(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<boolean> {
  const manifest = await readManifest();
  const sentinel = getManagedSkillPaths(manifest)[0];
  if (!sentinel) return false;
  return (
    await Promise.all(
      getPlatformSkillsDirs(platform, scope).map((skillsDir) =>
        fileExists(path.join(baseDir, skillsDir, 'skills', ...sentinel.split('/'))),
      ),
    )
  ).some(Boolean);
}

async function repairDoctorState(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
  strategy?: 'continue' | 'rollback',
  repairCodegraph = false,
  quietCodegraph = false,
): Promise<string[]> {
  const repaired: string[] = [];
  if (scope !== 'global' && (await repairWorkflowProjectConfigTransaction(projectPath))) {
    repaired.push('project config write transaction');
  }
  const config = scope === 'global' ? null : await readWorkflowProjectConfig(projectPath);
  const workflows = configuredWorkflows(config);
  const language = configuredSkillLanguage(config, workflows);
  const workflowSelection: InitWorkflowSelection =
    workflows.includes('native') && workflows.includes('classic')
      ? 'both'
      : workflows.includes('native')
        ? 'native'
        : 'classic';
  const projectedProjectPlatforms = new Set<string>();
  if (scope !== 'global') {
    const worktree = inspectGitWorktree(projectPath);
    if (worktree.isSecondaryWorktree && worktree.primaryWorktreeRoot) {
      const sources: Array<{ baseDir: string; scope: InstallScope }> = [
        { baseDir: worktree.primaryWorktreeRoot, scope: 'project' },
        { baseDir: context.homeDir, scope: 'global' },
      ];
      for (const source of sources) {
        const projection = await projectCometHooksFromInstalledScope(
          projectPath,
          source.baseDir,
          source.scope,
          workflowSelection,
          { globalBaseDir: context.homeDir },
        );
        if (projection.failures.length > 0) {
          const details = projection.failures
            .map(({ platform, reason }) => `${platform}: ${reason}`)
            .join('; ');
          throw new Error(`failed to project Hook into linked worktree: ${details}`);
        }
        for (const platformId of projection.installedPlatforms) {
          projectedProjectPlatforms.add(platformId);
          repaired.push(`${platformId} (project) Hook projection`);
        }
        if (projection.installedPlatforms.length > 0) break;
      }
    }
  }
  const targets: Array<{ baseDir: string; scope: InstallScope; platform: Platform }> = [];
  const hookOnlyTargets: Array<{ baseDir: string; scope: InstallScope; platform: Platform }> = [];

  for (const base of getScopeBases(projectPath, scope, context)) {
    const platforms = await getPlatformsForSkillInspection(base.baseDir, base.scope, scope);
    const installedPlatformIds = new Set<string>(
      base.scope === 'project' ? projectedProjectPlatforms : [],
    );
    for (const { platform, inspectComponents } of platforms) {
      if (!inspectComponents || !(await hasManagedInstall(base.baseDir, platform, base.scope))) {
        continue;
      }
      installedPlatformIds.add(platform.id);
      targets.push({ baseDir: base.baseDir, scope: base.scope, platform });
    }
    for (const { platform } of await getHookOnlyInspections(
      base.baseDir,
      base.scope,
      installedPlatformIds,
    )) {
      hookOnlyTargets.push({ baseDir: base.baseDir, scope: base.scope, platform });
    }
  }

  let projectRouterReady = projectedProjectPlatforms.size > 0;

  for (const target of hookOnlyTargets) {
    if (target.scope === 'project') {
      const runtime = hookRouterRuntimePaths(target.baseDir, target.platform, target.scope);
      await copyFile(runtime.source, runtime.destination);
    }
    const hookResult =
      target.scope === 'project'
        ? await reconcileProjectCometHooksForPlatform(
            target.baseDir,
            target.platform,
            workflowSelection,
            { globalBaseDir: context.homeDir },
          )
        : await reconcileCometHooksForPlatform(
            target.baseDir,
            target.platform,
            target.scope,
            workflowSelection,
          );
    if (hookResult.status === 'failed') {
      throw new Error(
        `failed to repair Hook for ${target.platform.name} (${target.scope}): ${hookResult.reason}`,
      );
    }
    if (target.scope === 'project' && hookResult.status === 'installed') {
      projectRouterReady = true;
    }
    repaired.push(`${target.platform.name} (${target.scope}) Hook`);
  }

  for (const target of targets) {
    const { baseDir, scope: targetScope, platform } = target;
    if (platform.supportsHooks && platform.hookFormat) {
      const runtime = hookRouterRuntimePaths(baseDir, platform, targetScope);
      await copyFile(runtime.source, runtime.destination);
    }
    const hookResult =
      targetScope === 'project'
        ? await reconcileProjectCometHooksForPlatform(baseDir, platform, workflowSelection, {
            globalBaseDir: context.homeDir,
          })
        : await reconcileCometHooksForPlatform(baseDir, platform, targetScope, workflowSelection);
    if (hookResult.status === 'failed') {
      throw new Error(
        `failed to repair Hook for ${platform.name} (${targetScope}): ${hookResult.reason}`,
      );
    }
    if (targetScope === 'project' && hookResult.status === 'installed') {
      projectRouterReady = true;
    }
  }

  if (scope !== 'global' && projectRouterReady) {
    const selectionRepair = await repairCometCurrentSelection(projectPath, {
      migrateLegacyClassic: workflows.includes('classic'),
    });
    if (selectionRepair.migratedLegacyClassic) repaired.push('Classic selection v1');
    if (selectionRepair.clearedStaleSelection) repaired.push('stale current selection');
  }
  if (scope !== 'global' && strategy) {
    if (await repairClassicLayoutInitialization(projectPath, strategy)) {
      repaired.push('Classic initialization');
    } else if (await repairClassicRootMove(projectPath, strategy)) {
      repaired.push('Classic root move');
    }
  }

  for (const target of targets) {
    const { baseDir, scope: targetScope, platform } = target;
    const ruleResult = await copyCometRulesForPlatform(
      baseDir,
      platform,
      true,
      language,
      targetScope,
      workflowSelection,
    );
    if (ruleResult.failed > 0) {
      throw new Error(`failed to repair Rule for ${platform.name} (${targetScope})`);
    }
    repaired.push(`${platform.name} (${targetScope})`);
  }
  if (repairCodegraph && scope !== 'global') {
    const diagnostic = inspectCodegraphIndex(projectPath);
    if (
      diagnostic.status === 'project_not_initialized' ||
      diagnostic.status === 'index_incomplete' ||
      diagnostic.status === 'index_stale'
    ) {
      repairCodegraphIndex(
        projectPath,
        diagnostic.remediation === 'codegraph init -i'
          ? 'project_not_initialized'
          : diagnostic.remediation === 'codegraph sync'
            ? 'index_stale'
            : 'index_incomplete',
        quietCodegraph,
      );
      repaired.push('CodeGraph project index');
    }
  }
  return repaired;
}

function icon(status: string): string {
  if (status === 'pass') return '✓';
  if (status === 'warn') return '⚠';
  return '✗';
}

interface DoctorOptions {
  json?: boolean;
  repair?: boolean;
  yes?: boolean;
  strategy?: 'continue' | 'rollback';
  scope?: DoctorScope;
  homeDir?: string;
}

export async function doctorCommand(
  targetPath: string,
  options: DoctorOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const scope = options.scope ?? 'auto';
  const context = { homeDir: path.resolve(options.homeDir ?? os.homedir()) };
  if (options.strategy && !options.repair) {
    throw new Error('--strategy requires --repair');
  }
  if (options.yes && !options.repair) {
    throw new Error('--yes requires --repair');
  }
  const repaired = options.repair
    ? await repairDoctorState(
        projectPath,
        scope,
        context,
        options.strategy,
        options.yes === true,
        options.json === true,
      )
    : [];
  const report =
    options.homeDir === undefined
      ? await collectResults(projectPath, scope)
      : await collectResultsWithContext(projectPath, scope, context);
  const { results, runtime, codegraph } = report;
  const healthy = results.every((result) => result.status !== 'fail');
  const status = healthy ? 'passed' : 'failed';

  if (options.json) {
    console.log(
      JSON.stringify({ scope, status, healthy, repaired, runtime, codegraph, results }, null, 2),
    );
    return;
  }

  console.log(`Comet Doctor (scope: ${scope})\n`);

  if (options.repair) {
    console.log(`  Repaired: ${repaired.length > 0 ? repaired.join(', ') : 'nothing to change'}\n`);
  }

  for (const r of results) {
    console.log(`  ${icon(r.status)} ${r.check}: ${r.message}`);
  }

  console.log();
}
