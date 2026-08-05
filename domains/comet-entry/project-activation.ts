import os from 'os';

import {
  assertClassicLayoutInitializationSafe,
  beginClassicLayoutInitialization,
  checkpointClassicLayoutInitialization,
  completeClassicLayoutInitialization,
  type ClassicLayoutInitializationPermit,
} from '../comet-classic/classic-layout-initialization.js';
import { classicLayoutPaths, classicProjectRelative } from '../comet-classic/classic-layout.js';
import { assertClassicOpenSpecRootHealthy } from '../comet-classic/classic-openspec-root.js';
import {
  discoverNativeProject,
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../comet-native/native-paths.js';
import { installOpenSpec } from '../integrations/openspec.js';
import { projectCometHooksFromInstalledScope } from '../skill/project-hook-projection.js';
import {
  defaultWorkflowProjectConfig,
  readWorkflowGlobalConfig,
  readWorkflowProjectConfig,
  workflowProjectConfigFromGlobalConfig,
  writeWorkflowProjectConfig,
  type WorkflowProjectConfig,
} from '../workflow-contract/index.js';
import { ensureProtectedProjectDirectory } from '../workflow-contract/protected-project-path.js';

import type { CometEntryResolution, CometEntryResolutionSource } from './types.js';
import { resolveInitWorkflow } from './init-workflow.js';

export interface ProjectActivationOptions {
  homeDir?: string;
}

export interface ProjectActivationResult {
  config: WorkflowProjectConfig;
  source: Extract<
    CometEntryResolutionSource,
    'global-config' | 'built-in-default' | 'legacy-project'
  >;
}

async function ensureWorkflowDirectories(
  projectRoot: string,
  config: WorkflowProjectConfig,
): Promise<ClassicLayoutInitializationPermit | undefined> {
  const workflows = config.workflows ?? [config.default_workflow];
  if (workflows.includes('native')) {
    if (!config.native) {
      throw new Error('Global Comet config enables Native without a native configuration');
    }
    await ensureNativeDirectories(
      await nativeProjectPaths(projectRoot, config.native.artifact_root),
    );
  }
  if (!workflows.includes('classic')) return undefined;

  const artifactLayout = config.classic?.artifact_layout ?? 'docs';
  let initialization = await assertClassicLayoutInitializationSafe(projectRoot, artifactLayout);
  initialization = await beginClassicLayoutInitialization(projectRoot, initialization);
  const permit = initialization.initializationPermit;
  const mutationGuard = async () => {
    await assertClassicLayoutInitializationSafe(projectRoot, artifactLayout, permit);
  };
  const status = await installOpenSpec(
    projectRoot,
    [],
    'project',
    false,
    [],
    artifactLayout,
    mutationGuard,
  );
  if (status !== 'installed') {
    throw new Error(
      'Classic project activation requires a compatible globally installed OpenSpec CLI',
    );
  }

  const layout = classicLayoutPaths(projectRoot, artifactLayout);
  await assertClassicOpenSpecRootHealthy(projectRoot, layout);
  for (const directory of [
    layout.archiveDir,
    layout.specsDir,
    layout.superpowersSpecsDir,
    layout.superpowersPlansDir,
    layout.superpowersReportsDir,
  ]) {
    const relative = classicProjectRelative(projectRoot, directory);
    await ensureProtectedProjectDirectory(projectRoot, relative, {
      label: `Classic working directory ${relative}`,
    });
  }
  await ensureProtectedProjectDirectory(projectRoot, '.comet', {
    label: 'Comet project state directory',
  });
  await checkpointClassicLayoutInitialization(projectRoot, permit);
  return permit;
}

export async function activateCometProject(
  projectRoot: string,
  options: ProjectActivationOptions = {},
): Promise<ProjectActivationResult> {
  const globalConfig = await readWorkflowGlobalConfig(options.homeDir ?? os.homedir());
  let config = globalConfig
    ? workflowProjectConfigFromGlobalConfig(globalConfig)
    : defaultWorkflowProjectConfig('docs');
  let source: ProjectActivationResult['source'] = globalConfig
    ? 'global-config'
    : 'built-in-default';
  const projectDecision = await resolveInitWorkflow(projectRoot);
  if (projectDecision.source === 'legacy-project') {
    config = {
      schema: 'comet.project.v1',
      default_workflow: 'classic',
      workflows: ['classic'],
      ambient_resume: config.ambient_resume,
      classic: {
        artifact_layout: projectDecision.classicArtifactLayout,
        language: config.classic?.language ?? config.native?.language ?? 'en',
        context_compression: config.classic?.context_compression ?? 'off',
        review_mode: config.classic?.review_mode ?? 'standard',
        auto_transition: config.classic?.auto_transition ?? true,
      },
    };
    source = 'legacy-project';
  }

  // Materialize project-owned artifact directories before publishing the
  // project config. A failed activation therefore never leaves a configured
  // project pointing at an incomplete artifact root.
  const classicPermit = await ensureWorkflowDirectories(projectRoot, config);
  const workflows = config.workflows ?? [config.default_workflow];
  const workflowSelection =
    workflows.includes('native') && workflows.includes('classic')
      ? 'both'
      : config.default_workflow;
  const hookProjection = await projectCometHooksFromInstalledScope(
    projectRoot,
    options.homeDir ?? os.homedir(),
    'global',
    workflowSelection,
    { globalBaseDir: options.homeDir ?? os.homedir() },
  );
  if (hookProjection.failures.length > 0) {
    const details = hookProjection.failures
      .map(({ platform, reason }) => `${platform}: ${reason}`)
      .join('; ');
    throw new Error(`Comet project Hook activation failed: ${details}`);
  }
  await writeWorkflowProjectConfig(projectRoot, config);
  if (classicPermit) {
    await completeClassicLayoutInitialization(projectRoot, classicPermit);
  }
  return { config, source };
}

export async function resolveOrActivateCometEntry(
  startPath: string,
  options: ProjectActivationOptions = {},
): Promise<CometEntryResolution> {
  const projectRoot = await discoverNativeProject(startPath);
  const existing = await readWorkflowProjectConfig(projectRoot);
  const activated = existing ? null : await activateCometProject(projectRoot, options);
  const config = existing ?? activated!.config;
  return {
    workflow: config.default_workflow,
    skill: config.default_workflow === 'native' ? 'comet-native' : 'comet-classic',
    source: activated?.source ?? 'project-config',
  };
}
