import { promises as fs } from 'node:fs';
import path from 'node:path';

import { defaultProjectConfig, readProjectConfig } from './native-config.js';
import { atomicWriteText } from './native-atomic-file.js';
import {
  discoverWorkflowCapabilityCandidates,
  renderCapabilityAssociationDraft,
} from '../project-knowledge/capability-discovery.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  inspectNativeTotalSpec,
  nativeLegacySectionHash,
  nativeTotalSpecHash,
  renderNativeDelta,
  type NativeDeltaDocument,
} from './native-delta-spec.js';
import {
  createNativeCapabilityKnowledgeProvider,
  readNativeCapabilityDiscoveryCache,
  writeNativeCapabilityDiscoveryCache,
} from './native-capability-discovery.js';
import { ensureNativeDirectories, nativeProjectPaths } from './native-paths.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { createNativePortableChange, nativePortableChangeDir } from './native-portable-runtime.js';
import { selectNativeChange } from './native-selection.js';
import { prepareNativeWorkspace } from './native-workspace-preparation.js';
import { recordNativeWorkspaceConfig } from './native-workspace-config.js';
import { type NativeWorkspaceIsolation } from './native-workspace.js';
import {
  assertNoArguments,
  languageOption,
  NativeUsageError,
  requiredPositional,
  success,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

async function initializeNativeDeltaProposal(options: {
  paths: Awaited<ReturnType<typeof nativeProjectPaths>>;
  changeName: string;
  capability: string;
}): Promise<{ specSource: string; deltaSource: string; baseHash: string }> {
  const canonical = await readNativeBoundedTextFile({
    root: options.paths.specsDir,
    ref: `${options.capability}/spec.md`,
    maxBytes: null,
    includeHash: false,
  });
  const capabilitySegments = options.capability.split('/');
  const changeRoot = nativePortableChangeDir(options.paths, options.changeName);
  const specSource = `specs/${options.capability}/spec.md`;
  const deltaSource = `specs/${options.capability}/delta.yaml`;
  await fs.mkdir(path.join(changeRoot, 'specs', ...capabilitySegments), { recursive: true });
  await atomicWriteText(path.join(changeRoot, ...specSource.split('/')), canonical.text, {
    containedRoot: options.paths.nativeRoot,
  });
  const baseHash = nativeTotalSpecHash(canonical.text);
  const inspected = inspectNativeTotalSpec(canonical.text);
  const delta: NativeDeltaDocument = {
    schema: 'comet.native.delta.v1',
    capability: options.capability,
    base_hash: baseHash,
    base_version: 1,
    legacy_hash: nativeLegacySectionHash(canonical.text),
    base_requirements: Object.fromEntries(
      inspected.requirements.map((requirement) => [
        requirement.id,
        nativeTotalSpecHash(requirement.raw),
      ]),
    ),
    operations: [],
  };
  await atomicWriteText(
    path.join(changeRoot, ...deltaSource.split('/')),
    renderNativeDelta(delta),
    { containedRoot: options.paths.nativeRoot },
  );
  return { specSource, deltaSource, baseHash };
}

async function discoverNativeCapability(
  projectRoot: string,
  artifactRoot: string,
  task: string | undefined,
  capability: string | undefined,
) {
  if (!task && !capability) return null;
  const diagnostics: Array<{ code: string; message: string }> = [];
  const scope = {
    workflow: 'native' as const,
    currentSpecRoot: `${artifactRoot}/comet/specs`,
    archiveRoot: `${artifactRoot}/comet/archive`,
  };
  try {
    if (task && !capability) {
      const cached = await readNativeCapabilityDiscoveryCache({
        projectRoot,
        scope,
        task,
      });
      if (cached) return cached;
    }
    const provider = capability
      ? undefined
      : await createNativeCapabilityKnowledgeProvider({
          projectRoot,
          scope,
          reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        });
    const result = await discoverWorkflowCapabilityCandidates({
      projectRoot,
      scope,
      ...(provider ? { provider } : {}),
      ...(task ? { task } : {}),
      ...(capability ? { capability } : {}),
    });
    const combined = { ...result, diagnostics: [...diagnostics, ...result.diagnostics] };
    if (task && !capability) {
      await writeNativeCapabilityDiscoveryCache({
        projectRoot,
        scope,
        task,
        result: combined,
      });
    }
    return combined;
  } catch (error) {
    if (capability) throw error;
    return {
      workflow: 'native' as const,
      query: null,
      candidates: [],
      associationDraft: null,
      diagnostics: [
        ...diagnostics,
        {
          code: 'capability-discovery',
          message: `能力候选召回不可用，未自动关联：${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      searched: Boolean(task),
      providerLimit: 40,
    };
  }
}

export async function nativeNewCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  let config = await readProjectConfig(projectRoot);
  const language = languageOption(args, config?.native.language ?? 'en');
  const isolation = (takeOption(args, '--isolation') ?? 'current') as NativeWorkspaceIsolation;
  if (isolation !== 'current' && isolation !== 'branch' && isolation !== 'worktree') {
    throw new NativeUsageError('--isolation must be current, branch, or worktree');
  }
  const changeBranch = takeOption(args, '--change-branch');
  const targetBranch = takeOption(args, '--target-branch');
  const worktreePath = takeOption(args, '--worktree-path');
  const task = takeOption(args, '--task');
  const capability = takeOption(args, '--capability');
  assertNoArguments(args);
  const sourceConfig = config;
  if (config?.native.pending_root_move) {
    throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
  }
  const prepared = await prepareNativeWorkspace({
    projectRoot,
    name,
    isolation,
    ...(changeBranch ? { changeBranch } : {}),
    ...(targetBranch ? { targetBranch } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    sourceConfig,
  });
  projectRoot = prepared.projectRoot;
  config = await readProjectConfig(projectRoot);
  const initialProjectConfig = config === null ? defaultProjectConfig('docs', language) : undefined;
  if (!config) config = initialProjectConfig!;
  if (config.native.pending_root_move) {
    throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
  }
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  await ensureNativeDirectories(paths);
  const capabilityDiscovery = await discoverNativeCapability(
    projectRoot,
    config.native.artifact_root,
    task,
    capability,
  );
  const state = await createNativePortableChange({
    paths,
    name,
    language,
    workspaceBinding: prepared.binding,
    ...(initialProjectConfig ? { initialProjectConfig } : {}),
  });
  let associationPath: string | undefined;
  let deltaProposal: Awaited<ReturnType<typeof initializeNativeDeltaProposal>> | undefined;
  if (capabilityDiscovery?.associationDraft) {
    deltaProposal = await initializeNativeDeltaProposal({
      paths,
      changeName: state.name,
      capability: capabilityDiscovery.associationDraft.capability,
    });
    associationPath = path.join(
      nativePortableChangeDir(paths, state.name),
      'capability-association.yaml',
    );
    await atomicWriteText(
      associationPath,
      renderCapabilityAssociationDraft(capabilityDiscovery.associationDraft),
      { containedRoot: paths.nativeRoot },
    );
  }
  await selectNativeChange(paths, state.name);
  if (initialProjectConfig) await recordNativeWorkspaceConfig(projectRoot);
  return success(
    'new',
    {
      ...state,
      preparation: prepared.preparation,
      ...(capabilityDiscovery === null
        ? {}
        : {
            capabilityDiscovery,
            ...(associationPath === undefined ? {} : { associationPath }),
            ...(deltaProposal === undefined ? {} : { deltaProposal }),
          }),
      continuation: nativePortableContinuation(state),
    },
    `Created Native change ${state.name}\n`,
  );
}
