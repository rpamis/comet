import path from 'path';
import os from 'os';
import { fileExists, readDir } from '../../platform/fs/file-system.js';
import {
  getOpenSpecVersion,
  isCommandAvailable,
  isOpenSpecVersionCompatible,
  MINIMUM_OPENSPEC_VERSION,
} from '../../domains/integrations/openspec.js';
import {
  hasCodegraphProjectIndex,
  resolveCodegraphCommand,
} from '../../domains/integrations/codegraph.js';
import {
  readManifest,
  getAssetsDir,
  getManagedSkillPaths,
} from '../../domains/skill/platform-install.js';
import {
  getPlatformRuleDestinations,
  inspectCometHooksForPlatform,
} from '../../domains/skill/platform-inspect.js';
import {
  PLATFORMS,
  getPlatformSkillsDirs,
  type Platform,
} from '../../platform/install/platforms.js';
import { resolveCanonicalSkillRootOwners } from '../../platform/install/skill-root-owner.js';
import type { InstallScope } from '../../platform/install/types.js';
import { inspectClassicChange } from '../../domains/comet-classic/classic-diagnostics.js';
import { getCurrentVersion } from '../../platform/version/version.js';

interface CheckResult {
  check: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

type DoctorScope = InstallScope | 'auto';
interface DoctorContext {
  homeDir: string;
}

const SUPERPOWERS_SENTINELS = [
  'using-superpowers/SKILL.md',
  'test-driven-development/SKILL.md',
  'writing-plans/SKILL.md',
] as const;

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
  const specsDir = path.join(projectPath, 'docs', 'superpowers', 'specs');
  const plansDir = path.join(projectPath, 'docs', 'superpowers', 'plans');
  const specsExist = await fileExists(specsDir);
  const plansExist = await fileExists(plansDir);

  if (specsExist && plansExist) {
    return { check: 'working directories', status: 'pass', message: 'present' };
  }
  if (!specsExist && !plansExist) {
    return {
      check: 'working directories',
      status: 'warn',
      message:
        'project not initialized for Comet — run: comet init --scope project if this project should use Comet workflows',
    };
  }
  const missing = [];
  if (!specsExist) missing.push('specs');
  if (!plansExist) missing.push('plans');
  return {
    check: 'working directories',
    status: 'warn',
    message: `partial (missing: ${missing.join(', ')})`,
  };
}

async function checkSuperpowers(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
): Promise<CheckResult> {
  const detected: string[] = [];
  for (const base of getScopeBases(projectPath, scope, context)) {
    for (const platform of PLATFORMS) {
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

async function checkPlatformComponents(
  baseDir: string,
  platform: (typeof PLATFORMS)[number],
  scope: InstallScope,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const ruleDestinations = await getPlatformRuleDestinations(baseDir, platform, scope);
  if (ruleDestinations.length > 0) {
    let present = 0;
    const inspectionErrors: string[] = [];
    for (const destination of ruleDestinations) {
      try {
        if (await fileExists(destination)) present++;
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
  }

  if (platform.supportsHooks && platform.hookFormat) {
    const inspection = await inspectCometHooksForPlatform(baseDir, platform, scope);
    results.push({
      check: `hooks: ${platform.name} (${scope})`,
      status: inspection.present ? 'pass' : 'warn',
      message: inspection.present
        ? 'managed Hook present'
        : `${inspection.error ?? 'managed Hook missing'} — run: comet update --scope ${scope}`,
    });
  }

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

async function checkSkillCompleteness(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const manifest = await readManifest();
  const managedSkills = getManagedSkillPaths(manifest);
  const total = managedSkills.length;

  let anyCometInstall = false;
  const scopeState: Record<InstallScope, { hasInstall: boolean; hasComplete: boolean }> = {
    project: { hasInstall: false, hasComplete: false },
    global: { hasInstall: false, hasComplete: false },
  };
  for (const base of getScopeBases(projectPath, scope, context)) {
    const platforms = await getPlatformsForSkillInspection(base.baseDir, base.scope, scope);
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
        results.push(...(await checkPlatformComponents(base.baseDir, platform, base.scope)));
      }
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
  const changesDir = path.join(projectPath, 'openspec', 'changes');
  if (!(await fileExists(changesDir))) return [];

  const entries = await readDir(changesDir);
  const results: CheckResult[] = [];

  for (const entry of entries) {
    if (entry === 'archive') continue;
    const changeDir = path.join(changesDir, entry);
    const yamlPath = path.join(changeDir, '.comet.yaml');
    if (!(await fileExists(yamlPath))) continue;

    const diagnostic = await inspectClassicChange(changeDir, entry);
    if (diagnostic.valid) {
      results.push({
        check: `.comet.yaml: ${entry}`,
        status: 'pass',
        message: `valid (step: ${diagnostic.currentStep ?? 'completed'}, mode: ${diagnostic.runtimeMode})`,
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

async function checkCodegraph(projectPath: string, scope: DoctorScope): Promise<CheckResult> {
  if (scope !== 'global' && hasCodegraphProjectIndex(projectPath)) {
    return { check: 'CodeGraph', status: 'pass', message: 'initialized (.codegraph/ present)' };
  }

  if (!resolveCodegraphCommand()) {
    return {
      check: 'CodeGraph CLI',
      status: 'warn',
      message: 'not installed — install with: npm install -g @colbymchenry/codegraph',
    };
  }

  if (scope === 'global') {
    return { check: 'CodeGraph CLI', status: 'pass', message: 'installed' };
  }

  const codegraphDir = path.join(projectPath, '.codegraph');
  if (!(await fileExists(codegraphDir))) {
    return {
      check: 'CodeGraph',
      status: 'warn',
      message: 'CLI installed but project not initialized — run: codegraph init -i',
    };
  }

  return { check: 'CodeGraph', status: 'pass', message: 'initialized (.codegraph/ present)' };
}

async function collectResults(projectPath: string, scope: DoctorScope): Promise<CheckResult[]> {
  const context = { homeDir: os.homedir() };
  return collectResultsWithContext(projectPath, scope, context);
}

async function collectResultsWithContext(
  projectPath: string,
  scope: DoctorScope,
  context: DoctorContext,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const scopeMode = checkScopeMode(projectPath, scope, context);
  if (scopeMode) results.push(scopeMode);
  results.push(checkEnvironment(projectPath, context));
  results.push(checkCometCli());
  results.push(await checkOpenSpecCli());
  results.push(await checkSuperpowers(projectPath, scope, context));
  if (scope !== 'global') {
    results.push(await checkWorkingDirs(projectPath));
  }
  results.push(...(await checkSkillCompleteness(projectPath, scope, context)));
  results.push(await checkScriptsPresent());
  results.push(await checkCodegraph(projectPath, scope));
  results.push(...(await checkCometYamlValidity(projectPath)));
  return results;
}

function icon(status: string): string {
  if (status === 'pass') return '✓';
  if (status === 'warn') return '⚠';
  return '✗';
}

interface DoctorOptions {
  json?: boolean;
  scope?: DoctorScope;
  homeDir?: string;
}

export async function doctorCommand(
  targetPath: string,
  options: DoctorOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const scope = options.scope ?? 'auto';
  const results =
    options.homeDir === undefined
      ? await collectResults(projectPath, scope)
      : await collectResultsWithContext(projectPath, scope, {
          homeDir: path.resolve(options.homeDir),
        });

  if (options.json) {
    console.log(JSON.stringify({ scope, results }, null, 2));
    return;
  }

  console.log(`Comet Doctor (scope: ${scope})\n`);

  for (const r of results) {
    console.log(`  ${icon(r.status)} ${r.check}: ${r.message}`);
  }

  console.log();
}
