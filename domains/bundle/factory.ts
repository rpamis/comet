import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { stringify } from 'yaml';
import { discoverBundleCandidates, type BundleCandidate } from './candidates.js';
import { createBundleDraft, optimizeBundleDraft } from './draft.js';
import { composeBundleFactoryPlan } from './factory-compose.js';
import {
  hashBundleFactoryPlan,
  normalizeBundleFactoryPlan,
  readBundleFactoryPlan,
  writeBundleFactoryPlanArtifact,
} from './factory-plan.js';
import { buildBundleFactoryProposal } from './factory-proposal.js';
import { readBundleSkillPreferences } from './preferences.js';
import { reconcileBundleAuthoringState, writeBundleAuthoringState } from './state.js';
import { generateFactorySkillPackage } from '../factory/package.js';
import { hashBundle } from './hash.js';
import { loadBundle } from './load.js';
import type { BundleAuthoringState, BundleFactoryMetadata, BundleManifest } from './types.js';
import { COMET_FIVE_PHASE_NODES } from '../workflow-contract/builtins.js';

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function entrySkillId(state: BundleAuthoringState): string {
  return slug(state.name);
}

function generatedNodeSkillName(workflowName: string, nodeId: string): string {
  const base = slug(workflowName) || 'workflow';
  const suffix = slug(nodeId) || 'node';
  return `${base}-${suffix}`;
}

const WORKFLOW_CONTRACT_BUILTIN_SKILLS = new Set(
  COMET_FIVE_PHASE_NODES.map((node) => node.implementation.skill),
);

function isWorkflowContractBuiltinSkill(skill: string): boolean {
  return WORKFLOW_CONTRACT_BUILTIN_SKILLS.has(skill);
}

function isMissingStateError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function confirmationHash(factory: BundleFactoryMetadata): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        goal: factory.goal,
        preferredSkills: factory.preferredSkills,
        requiredSkills: factory.requiredSkills ?? [],
        resolvedSkills: factory.resolvedSkills,
        callChain: factory.callChain,
        workflowProtocol: factory.workflowProtocol ?? null,
        composition: factory.composition ?? null,
        planHash: factory.planHash ?? null,
      }),
    )
    .digest('hex');
}

function proposalConfirmation(options: {
  proposalHash: string;
  preferenceHash: string | null;
  warnings?: string[];
}): BundleFactoryMetadata['proposalConfirmation'] {
  return {
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    proposalHash: options.proposalHash,
    preferenceHash: options.preferenceHash,
    acceptedCapabilities: ['skills', 'scripts', 'rules', 'hooks', 'references', 'agents'],
    warnings: options.warnings ?? [],
  };
}

function bundleManifest(
  state: BundleAuthoringState,
  skillId: string,
  internalSkillIds: string[] = [],
): BundleManifest {
  return {
    apiVersion: 'comet/v1alpha1',
    kind: 'SkillBundle',
    metadata: {
      name: state.name,
      version: state.base?.version ?? '1.0.0',
      description: state.factory?.goal ?? `Generated Comet Skill Creator bundle for ${state.name}.`,
      defaultLocale: state.defaultLocale,
      locales: [...state.locales],
    },
    skills: [
      {
        id: skillId,
        path: `skills/${skillId}`,
        visibility: 'entry',
      },
      ...internalSkillIds.map((id) => ({
        id,
        path: `skills/${id}`,
        visibility: 'internal' as const,
      })),
    ],
    resources: {
      rules: [
        {
          id: `${skillId}-orchestration`,
          path: `rules/${skillId}-orchestration.md`,
          mode: 'always',
          required: true,
        },
      ],
      hooks: [
        {
          id: `${skillId}-before-write-guard`,
          path: `hooks/${skillId}-before-write-guard.yaml`,
        },
        {
          id: `${skillId}-before-tool-guard`,
          path: `hooks/${skillId}-before-tool-guard.yaml`,
        },
      ],
      references: [
        `skills/${skillId}/reference/resolved-skills.json`,
        `skills/${skillId}/reference/workflow-protocol.json`,
        `skills/${skillId}/reference/decision-points.md`,
        `skills/${skillId}/reference/recovery.md`,
        `skills/${skillId}/reference/authoring-lanes.json`,
        `skills/${skillId}/reference/skill-review.md`,
        `skills/${skillId}/reference/composition-report.md`,
        `skills/${skillId}/reference/subagents/script-author.md`,
      ],
      scripts: [
        {
          id: 'comet-plan',
          path: `skills/${skillId}/scripts/comet-plan.mjs`,
          sideEffect: 'write',
          runtime: 'node',
        },
        {
          id: 'comet-check',
          path: `skills/${skillId}/scripts/comet-check.mjs`,
          sideEffect: 'read',
          runtime: 'node',
        },
        {
          id: 'comet-hook-guard',
          path: `skills/${skillId}/scripts/comet-hook-guard.mjs`,
          sideEffect: 'read',
          runtime: 'node',
        },
        {
          id: 'workflow-state',
          path: `skills/${skillId}/scripts/workflow-state.mjs`,
          sideEffect: 'write',
          runtime: 'node',
        },
        {
          id: 'workflow-guard',
          path: `skills/${skillId}/scripts/workflow-guard.mjs`,
          sideEffect: 'read',
          runtime: 'node',
        },
        {
          id: 'workflow-handoff',
          path: `skills/${skillId}/scripts/workflow-handoff.mjs`,
          sideEffect: 'read',
          runtime: 'node',
        },
      ],
      assets: [],
      agents: [],
    },
    platforms: {
      requires: ['skills', 'scripts', 'rules', 'hooks', 'references'],
      optional: [],
      overrides: [],
    },
    // Bundle-level engine packaging is a separate legacy channel. Factory output
    // currently embeds Comet-native runtime files inside the generated entry Skill.
    engine: { enabled: false },
  };
}

function orchestrationRule(skillId: string): string {
  return `# ${skillId} Orchestration

This Bundle is generated by the Comet Skill Creator and uses a portable control plane.

- Entry Skill: \`skills/${skillId}/SKILL.md\`
- Plan script: \`skills/${skillId}/scripts/comet-plan.mjs\`
- Check script: \`skills/${skillId}/scripts/comet-check.mjs\`
- Hook guard script: \`skills/${skillId}/scripts/comet-hook-guard.mjs\`
- Workflow state script: \`skills/${skillId}/scripts/workflow-state.mjs\`
- Workflow guard script: \`skills/${skillId}/scripts/workflow-guard.mjs\`
- Workflow handoff script: \`skills/${skillId}/scripts/workflow-handoff.mjs\`

Run the generated Skill through its workflow protocol and keep resolved Skill evidence in \`skills/${skillId}/reference/\`.
`;
}

function hookDescriptor(event: 'before_write' | 'before_tool'): string {
  const matcher = event === 'before_write' ? 'Write|Edit' : '"*"';
  return `event: ${event}
matcher: ${matcher}
script: comet-hook-guard
failure: block
requiresConfirmation: false
`;
}

function beforeWriteHookDescriptor(): string {
  return hookDescriptor('before_write');
}

function beforeToolHookDescriptor(): string {
  return hookDescriptor('before_tool');
}

async function clearDirectory(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(root, entry.name), {
        recursive: true,
        force: true,
      }),
    ),
  );
}

function assertFactoryCandidatesResolved(state: BundleAuthoringState): void {
  const unresolved = state.factory?.resolvedSkills.filter(
    (skill) => skill.status === 'missing' || skill.status === 'ambiguous',
  );
  if (!unresolved || unresolved.length === 0) return;
  throw new Error(
    `Bundle ${state.name} has unresolved factory Skill candidates: ${unresolved
      .map((skill) => `${skill.query} (${skill.status})`)
      .join(', ')}`,
  );
}

function assertFactoryCompositionReady(name: string, factory: BundleFactoryMetadata): void {
  const issues = factory.composition?.issues ?? [];
  if (issues.length === 0) return;
  throw new Error(
    `Bundle ${name} has unresolved factory composition issues: ${issues
      .map((issue) => issue.message)
      .join('; ')}`,
  );
}

function assertPreferenceCapabilitiesAllowed(
  preferences: Awaited<ReturnType<typeof readBundleSkillPreferences>> | null,
): void {
  const policies = preferences?.preferences.policies;
  if (!policies) return;
  if (policies.scripts === 'deny') {
    throw new Error(
      'Project Skill preference policy denies scripts required by generated Factory output',
    );
  }
  if (policies.hooks === 'deny') {
    throw new Error(
      'Project Skill preference policy denies hooks required by generated Factory output',
    );
  }
}

function applyBuiltInCandidates(
  projectRoot: string,
  candidates: BundleCandidate[],
): BundleCandidate[] {
  return candidates.map((candidate) => {
    if (!isWorkflowContractBuiltinSkill(candidate.name) || candidate.status !== 'missing') {
      return candidate;
    }
    return {
      name: candidate.name,
      preferenceIndex: candidate.preferenceIndex,
      status: 'available',
      sources: [
        {
          name: candidate.name,
          preferenceIndex: candidate.preferenceIndex,
          platform: 'builtin',
          scope: 'builtin',
          origin: 'builtin',
          factory: {
            query: candidate.name,
          },
          root: path.join(projectRoot, '.comet', '__bundle_builtin__', candidate.name),
          description: `Built-in Comet workflow step: ${candidate.name}.`,
          skillMd: `# ${candidate.name}\n`,
          references: [],
          scripts: [],
          hash: `builtin:${candidate.name}`,
        },
      ],
    };
  });
}

export async function composeFactoryMetadata(
  name: string,
  factory: BundleFactoryMetadata,
): Promise<BundleFactoryMetadata> {
  const compositionEntrySkills =
    factory.compositionEntrySkills && factory.compositionEntrySkills.length > 0
      ? factory.compositionEntrySkills
      : factory.callChain.map((item) => item.skill);
  const composed = await composeBundleFactoryPlan({
    entrySkills: compositionEntrySkills,
    preferredSkills: factory.preferredSkills,
    resolvedSkills: factory.resolvedSkills,
  });
  const callChain = composed.callChain.length > 0 ? composed.callChain : factory.callChain;
  return {
    ...factory,
    compositionEntrySkills: [...compositionEntrySkills],
    callChain,
    composition: composed.composition,
  };
}

export async function generateBundleDraftFromFactoryState(options: {
  projectRoot: string;
  state: BundleAuthoringState;
}): Promise<BundleAuthoringState> {
  const { state } = options;
  if (!state.factory) {
    throw new Error(`Bundle ${state.name} does not have Skill Creator metadata`);
  }
  assertFactoryCandidatesResolved(state);
  const factory = state.factory.composition
    ? state.factory
    : await composeFactoryMetadata(state.name, state.factory);
  assertFactoryCompositionReady(state.name, factory);
  assertFactoryProposalConfirmed(state);

  const skillId = entrySkillId(state);
  await clearDirectory(state.draftPath);
  if (!factory.workflowProtocol) {
    throw new Error(`Bundle ${state.name} Skill Creator metadata is missing workflowProtocol`);
  }
  const internalSkillIds = factory.workflowProtocol.nodes
    .filter((node) => !node.disabled)
    .map((node) => generatedNodeSkillName(factory.workflowProtocol!.name, node.id));
  await fs.writeFile(
    path.join(state.draftPath, 'bundle.yaml'),
    stringify(bundleManifest(state, skillId, internalSkillIds)),
    'utf8',
  );

  const generated = await generateFactorySkillPackage({
    root: state.draftPath,
    name: skillId,
    version: state.base?.version ?? '1.0.0',
    description: factory.goal,
    goal: factory.goal,
    defaultLocale: state.defaultLocale,
    callChain: factory.callChain,
    workflowDefinition: factory.workflowDefinition,
    workflowProtocol: factory.workflowProtocol,
    composition: factory.composition,
    resolvedSkills: factory.resolvedSkills,
    preference: {
      mode: factory.preferenceMode,
      policies: factory.preferencePolicies,
      requiredSkills: factory.requiredSkills,
      sourcePath: factory.preferencePath,
      sourceHash: factory.preferenceHash,
      warnings: factory.preferenceWarnings,
    },
    deviations: factory.deviations,
    engineMode: factory.engineMode,
    skillCreator: factory.skillCreatorIntent
      ? {
          intent: factory.skillCreatorIntent,
        }
      : undefined,
    contentDrafts: factory.authoringContent,
    authoringReview: factory.authoringReview,
  });
  await fs.mkdir(path.join(state.draftPath, 'rules'), { recursive: true });
  await fs.writeFile(
    path.join(state.draftPath, 'rules', `${skillId}-orchestration.md`),
    orchestrationRule(skillId),
    'utf8',
  );
  await fs.mkdir(path.join(state.draftPath, 'hooks'), { recursive: true });
  await fs.writeFile(
    path.join(state.draftPath, 'hooks', `${skillId}-before-write-guard.yaml`),
    beforeWriteHookDescriptor(),
    'utf8',
  );
  await fs.writeFile(
    path.join(state.draftPath, 'hooks', `${skillId}-before-tool-guard.yaml`),
    beforeToolHookDescriptor(),
    'utf8',
  );

  const bundle = await loadBundle(state.draftPath);
  const currentHash = await hashBundle(bundle);
  const updated: BundleAuthoringState = {
    ...state,
    status: 'draft',
    currentHash,
    factory: {
      ...factory,
      generatedSkillPackage: {
        entrySkill: skillId,
        internalSkills: generated.internalSkills,
        packageRoot: generated.packageRoot,
        enginePath: generated.enginePath,
        evalManifestPath: generated.evalManifestPath,
        controlPlane: generated.controlPlane,
        platformAgents: generated.platformAgents,
        unauthoredSubstanceNodes: generated.unauthoredSubstanceNodes,
        wrapperClassification: generated.wrapperClassification,
      },
    },
  };
  delete updated.eval;
  delete updated.review;
  delete updated.ready;
  delete updated.conflict;
  await writeBundleAuthoringState(options.projectRoot, updated);
  return updated;
}

export async function initializeBundleFactoryState(options: {
  projectRoot: string;
  name: string;
  filePath: string;
  confirmedProposal?: boolean;
}): Promise<BundleAuthoringState> {
  const projectRoot = path.resolve(options.projectRoot);
  const projectPreferences = await readBundleSkillPreferences(projectRoot);
  assertPreferenceCapabilitiesAllowed(projectPreferences);
  const plan = normalizeBundleFactoryPlan({
    plan: await readBundleFactoryPlan(path.resolve(options.filePath)),
    projectPreferredSkills: projectPreferences?.names ?? null,
  });
  const proposal = await buildBundleFactoryProposal({
    projectRoot,
    name: options.name,
    filePath: options.filePath,
  });
  let state: BundleAuthoringState | null = null;
  try {
    state = await reconcileBundleAuthoringState(projectRoot, options.name);
  } catch (error) {
    if (!isMissingStateError(error)) throw error;
  }
  if (options.confirmedProposal && !proposal.canGenerate && state?.factory) {
    const currentPlanHash = state.factory.planHash ?? null;
    const requestedPlanHash = hashBundleFactoryPlan(plan);
    if (currentPlanHash !== null && currentPlanHash !== requestedPlanHash) {
      throw new Error(
        `Confirmed Skill Creator plan ${requestedPlanHash} does not match current Skill Creator plan ${currentPlanHash}; rerun comet creator init without --confirmed-proposal to replace the plan, or confirm the current plan file`,
      );
    }
    const factory = state.factory.composition
      ? state.factory
      : await composeFactoryMetadata(state.name, state.factory);
    assertFactoryCandidatesResolved({ ...state, factory });
    assertFactoryCompositionReady(state.name, factory);
    const updated: BundleAuthoringState = {
      ...state,
      factory: {
        ...factory,
        proposalConfirmation: proposalConfirmation({
          proposalHash: confirmationHash(factory),
          preferenceHash: factory.preferenceHash ?? proposal.preference.hash,
        }),
      },
    };
    await writeBundleAuthoringState(projectRoot, updated);
    return updated;
  }
  if (options.confirmedProposal && !proposal.canGenerate) {
    throw new Error(
      `Cannot confirm blocked Skill Creator proposal: ${proposal.blockers.join('; ')}`,
    );
  }
  const resolvedSkills = applyBuiltInCandidates(
    projectRoot,
    await discoverBundleCandidates({
      projectRoot,
      preferences: plan.preferredSkills.length > 0 ? plan.preferredSkills : null,
    }),
  );
  const factoryResolvedSkills = resolvedSkills.map((candidate) => ({
    query: candidate.name,
    preferenceIndex: candidate.preferenceIndex,
    status: candidate.status,
    sources: candidate.sources,
  }));
  const planArtifact = await writeBundleFactoryPlanArtifact({
    projectRoot,
    name: options.name,
    plan,
  });
  const flattenedCandidates = resolvedSkills.flatMap((candidate) => candidate.sources);
  const factory: BundleFactoryMetadata = await composeFactoryMetadata(options.name, {
    goal: plan.goal,
    preferredSkills: plan.preferredSkills,
    requiredSkills: projectPreferences?.preferences.require ?? [],
    skillCreatorIntent: plan.skillCreatorIntent,
    workflowDefinition: plan.workflowDefinition,
    workflowProtocol: plan.workflowProtocol,
    preferenceMode: projectPreferences?.preferences.mode,
    preferencePolicies: projectPreferences?.preferences.policies,
    preferencePath: projectPreferences?.path,
    preferenceHash: projectPreferences?.hash,
    preferenceWarnings: projectPreferences?.warnings ?? [],
    compositionEntrySkills: plan.callChain.map((item) => item.skill),
    resolvedSkills: factoryResolvedSkills,
    callChain: plan.callChain,
    deviations: structuredClone(plan.deviations),
    engineMode: plan.engineMode,
    runnerMode: plan.runnerMode,
    planPath: planArtifact.planPath,
    planHash: planArtifact.planHash,
    proposalConfirmation: options.confirmedProposal
      ? proposalConfirmation({
          proposalHash: proposal.proposalHash,
          preferenceHash: proposal.preference.hash,
          warnings: [...proposal.warnings, ...proposal.blockers],
        })
      : undefined,
  });

  if (!state) {
    const optimizeSourceRoot =
      plan.mode === 'optimize' ? path.resolve(projectRoot, plan.sourceRoot!) : null;
    state =
      plan.mode === 'optimize'
        ? await optimizeBundleDraft({
            projectRoot,
            name: options.name,
            sourceRoot: optimizeSourceRoot!,
            candidates: flattenedCandidates,
            defaultLocale: plan.defaultLocale,
            locales: plan.locales,
            engineEnabled: plan.engineEnabled,
            factory,
          })
        : await createBundleDraft({
            projectRoot,
            name: options.name,
            candidates: flattenedCandidates,
            defaultLocale: plan.defaultLocale,
            locales: plan.locales,
            engineEnabled: plan.engineEnabled,
            factory,
          });
    return state;
  }

  if (plan.mode && plan.mode !== state.mode) {
    throw new Error(`Bundle ${state.name} already exists in ${state.mode} mode`);
  }

  const updated: BundleAuthoringState = {
    ...state,
    status: 'draft',
    currentHash: null,
    candidates: flattenedCandidates,
    defaultLocale: plan.defaultLocale,
    locales: plan.locales,
    engineEnabled: plan.engineEnabled,
    factory,
  };
  delete updated.eval;
  delete updated.review;
  delete updated.ready;
  delete updated.conflict;
  await writeBundleAuthoringState(projectRoot, updated);
  return updated;
}

export function assertFactoryProposalConfirmed(state: {
  name: string;
  factory?: BundleFactoryMetadata;
}): void {
  if (!state.factory) return;
  if (state.factory.proposalConfirmation?.confirmed === true) return;
  throw new Error(
    `Skill Creator proposal confirmation is required before generating, reviewing, or publishing ${state.name}; review the Skill Creator proposal and rerun comet creator init with --confirmed-proposal`,
  );
}
