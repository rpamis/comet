import path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import type { BigIntStats } from 'fs';
import {
  hasComparableFileObject,
  sameFileObject,
  type FileObjectIdentity,
} from '../../platform/fs/file-identity.js';
import { classicLayoutPaths } from '../comet-classic/classic-layout.js';
import { nativeProjectPaths } from '../comet-native/native-paths.js';
import {
  readWorkflowProjectConfigIdentity,
  readWorkflowProjectConfigSnapshot,
  workflowProjectConfigIdentityEquals,
  type WorkflowProjectConfigIdentity,
} from '../workflow-contract/project-config-reader.js';
import { lstat, realpath, rename, rmdir, unlink, writeFile } from 'fs/promises';

import {
  fileExists,
  readDir,
  removeFile,
  removeDir,
  isDirEmpty,
} from '../../platform/fs/file-system.js';
import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  getPlatformSkillsDirs,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import {
  readManifest,
  getManagedSkillPaths,
  getManagedSkillPathsForSelection,
  computeRuleDestPath,
  isManagedHookCommand,
  removeManagedHooksFromJsonFile,
} from './platform-install.js';
import type { CometWorkflow, InitWorkflowSelection } from '../comet-entry/types.js';
import { removeCometProjectInstructions } from './project-instructions.js';
import { readJsonObjectFile } from './json-object.js';
import { SKILLS_AGENT_MAP } from '../integrations/superpowers.js';

interface RemovalResult {
  removed: number;
  failed: number;
}

const OPENCODE_STYLE_PLATFORM_IDS = new Set(['opencode', 'mimocode']);
const LEGACY_RULE_PATHS = [
  'comet/rules/comet-phase-guard.md',
  'comet-native/rules/comet-native-phase-guard.md',
] as const;
const LEGACY_HOOK_SCRIPT_PATHS = [
  'comet/scripts/comet-hook-guard.mjs',
  'comet-native/scripts/comet-native-hook-guard.mjs',
] as const;

type ManagedWorkingTree = {
  readonly [entry: string]: 'file' | ManagedWorkingTree;
};

function managedWorkingTreeEntry(
  tree: ManagedWorkingTree,
  entry: string,
): 'file' | ManagedWorkingTree | undefined {
  return Object.prototype.hasOwnProperty.call(tree, entry) ? tree[entry] : undefined;
}

function setManagedWorkingTreeEntry(
  tree: ManagedWorkingTree,
  entry: string,
  value: 'file' | ManagedWorkingTree,
): void {
  Object.defineProperty(tree, entry, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

const EMPTY_MANAGED_WORKING_TREE: ManagedWorkingTree = {};
const OPENSPEC_WORKING_TREE: ManagedWorkingTree = {
  changes: {
    archive: EMPTY_MANAGED_WORKING_TREE,
  },
  specs: EMPTY_MANAGED_WORKING_TREE,
};
const SUPERPOWERS_WORKING_TREE: ManagedWorkingTree = {
  specs: EMPTY_MANAGED_WORKING_TREE,
  plans: EMPTY_MANAGED_WORKING_TREE,
  reports: EMPTY_MANAGED_WORKING_TREE,
};
const COMET_WORKING_TREE: ManagedWorkingTree = {
  'config.yaml': 'file',
};
const NATIVE_WORKING_TREE: ManagedWorkingTree = {
  specs: EMPTY_MANAGED_WORKING_TREE,
  changes: EMPTY_MANAGED_WORKING_TREE,
  archive: EMPTY_MANAGED_WORKING_TREE,
  runtime: {
    locks: EMPTY_MANAGED_WORKING_TREE,
    transactions: EMPTY_MANAGED_WORKING_TREE,
  },
};

interface WorkingObjectIdentity {
  kind: 'file' | 'directory';
  fileObject: FileObjectIdentity;
  size: bigint;
}

interface InspectedWorkingNode {
  identity: WorkingObjectIdentity;
  children: Map<string, InspectedWorkingNode> | null;
}

interface ManagedWorkingTreePlan {
  directory: string;
  managedTree: ManagedWorkingTree;
  root: InspectedWorkingNode;
  ancestorIdentities: Map<string, WorkingObjectIdentity>;
  countRemoval: boolean;
}

interface QuarantinedWorkingTree {
  plan: ManagedWorkingTreePlan;
  quarantine: string;
}

interface RemoveWorkingDirsOptions {
  workflows?: readonly CometWorkflow[];
  testHooks?: {
    afterPlanInspection?: () => void | Promise<void>;
  };
}

function birthtimeOf(stat: BigIntStats): bigint {
  return stat.birthtimeNs;
}

function workingIdentity(stat: BigIntStats): WorkingObjectIdentity {
  return {
    kind: stat.isFile() ? 'file' : 'directory',
    fileObject: { dev: stat.dev, ino: stat.ino, birthtime: birthtimeOf(stat) },
    size: stat.size,
  };
}

function sameWorkingIdentity(
  expected: WorkingObjectIdentity,
  actual: WorkingObjectIdentity,
): boolean {
  if (expected.kind !== actual.kind) return false;
  if (
    hasComparableFileObject(expected.fileObject, actual.fileObject) &&
    !sameFileObject(expected.fileObject, actual.fileObject)
  ) {
    return false;
  }
  if (
    !hasComparableFileObject(expected.fileObject, actual.fileObject) &&
    !sameFileObject(expected.fileObject, actual.fileObject)
  ) {
    return false;
  }
  return expected.kind === 'directory' || expected.size === actual.size;
}

function isInsideDirectory(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

async function readWorkingObjectIdentity(
  target: string,
  expected: 'file' | 'directory',
): Promise<WorkingObjectIdentity> {
  const stat = await lstat(target, { bigint: true });
  if (stat.isSymbolicLink() || (expected === 'file' ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`Refusing to remove non-${expected} working object: ${target}`);
  }
  return workingIdentity(stat);
}

async function captureAncestorIdentities(
  projectRoot: string,
  directory: string,
): Promise<Map<string, WorkingObjectIdentity>> {
  if (!isInsideDirectory(projectRoot, directory)) {
    throw new Error(`Working directory is outside the project root: ${directory}`);
  }
  const identities = new Map<string, WorkingObjectIdentity>();
  let cursor = projectRoot;
  identities.set(path.resolve(cursor), await readWorkingObjectIdentity(cursor, 'directory'));
  const relative = path.relative(projectRoot, directory);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    identities.set(path.resolve(cursor), await readWorkingObjectIdentity(cursor, 'directory'));
  }
  return identities;
}

async function assertIdentityChain(
  projectRoot: string,
  target: string,
  identities: ReadonlyMap<string, WorkingObjectIdentity>,
): Promise<void> {
  if (!isInsideDirectory(projectRoot, target)) {
    throw new Error(`Working directory is outside the project root: ${target}`);
  }
  let cursor = projectRoot;
  const paths = [cursor];
  const relative = path.relative(projectRoot, target);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    paths.push(cursor);
  }
  for (const current of paths) {
    const expected = identities.get(path.resolve(current));
    if (!expected) {
      throw new Error(`Working-directory identity is not bound: ${current}`);
    }
    const actual = await readWorkingObjectIdentity(current, expected.kind);
    if (!sameWorkingIdentity(expected, actual)) {
      throw new Error(`Working-directory object changed after inspection: ${current}`);
    }
  }
}

async function inspectManagedNode(
  projectRoot: string,
  directory: string,
  managedTree: ManagedWorkingTree,
  identities: Map<string, WorkingObjectIdentity>,
): Promise<InspectedWorkingNode> {
  const identity = identities.get(path.resolve(directory));
  if (!identity) throw new Error(`Working-directory identity is not bound: ${directory}`);
  const entries = (await readDir(directory)).sort();
  await assertIdentityChain(projectRoot, directory, identities);
  const children = new Map<string, InspectedWorkingNode>();

  for (const entry of entries) {
    if (!Object.prototype.hasOwnProperty.call(managedTree, entry)) {
      throw new Error(
        `Refusing to remove unknown working-directory content: ${path.join(directory, entry)}`,
      );
    }
    const expected = managedTree[entry];
    const entryPath = path.join(directory, entry);
    if (expected === 'file') {
      const childIdentity = await readWorkingObjectIdentity(entryPath, 'file');
      identities.set(path.resolve(entryPath), childIdentity);
      children.set(entry, { identity: childIdentity, children: null });
      continue;
    }
    const childIdentity = await readWorkingObjectIdentity(entryPath, 'directory');
    identities.set(path.resolve(entryPath), childIdentity);
    children.set(entry, await inspectManagedNode(projectRoot, entryPath, expected, identities));
  }

  const entriesAfter = (await readDir(directory)).sort();
  await assertIdentityChain(projectRoot, directory, identities);
  if (JSON.stringify(entriesAfter) !== JSON.stringify(entries)) {
    throw new Error(`Working directory changed during inspection: ${directory}`);
  }
  return { identity, children };
}

async function inspectManagedWorkingTree(
  projectRoot: string,
  directory: string,
  managedTree: ManagedWorkingTree,
  countRemoval = false,
): Promise<ManagedWorkingTreePlan | null> {
  try {
    const ancestorIdentities = await captureAncestorIdentities(projectRoot, directory);
    return {
      directory,
      managedTree,
      root: await inspectManagedNode(projectRoot, directory, managedTree, ancestorIdentities),
      ancestorIdentities,
      countRemoval,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function validateManagedNode(
  projectRoot: string,
  directory: string,
  node: InspectedWorkingNode,
  identities: ReadonlyMap<string, WorkingObjectIdentity>,
): Promise<void> {
  await assertIdentityChain(projectRoot, directory, identities);
  const actualIdentity = await readWorkingObjectIdentity(directory, node.identity.kind);
  if (!sameWorkingIdentity(node.identity, actualIdentity)) {
    throw new Error(`Working-directory object changed after inspection: ${directory}`);
  }
  if (!node.children) return;

  const entries = (await readDir(directory)).sort();
  await assertIdentityChain(projectRoot, directory, identities);
  const expectedEntries = [...node.children.keys()].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error(`Working directory changed after inspection: ${directory}`);
  }
  for (const entry of expectedEntries) {
    await validateManagedNode(
      projectRoot,
      path.join(directory, entry),
      node.children.get(entry)!,
      identities,
    );
  }
  const entriesAfter = (await readDir(directory)).sort();
  await assertIdentityChain(projectRoot, directory, identities);
  if (JSON.stringify(entriesAfter) !== JSON.stringify(expectedEntries)) {
    throw new Error(`Working directory changed after inspection: ${directory}`);
  }
}

async function validateManagedWorkingTree(
  projectRoot: string,
  plan: ManagedWorkingTreePlan,
): Promise<void> {
  await validateManagedNode(projectRoot, plan.directory, plan.root, plan.ancestorIdentities);
}

function mergeManagedWorkingTree(
  target: ManagedWorkingTree,
  segments: readonly string[],
  managedTree: ManagedWorkingTree,
): void {
  if (segments.length === 0) {
    for (const [entry, expected] of Object.entries(managedTree)) {
      const current = managedWorkingTreeEntry(target, entry);
      if (current === 'file' || expected === 'file') {
        if (current !== undefined && current !== expected) {
          throw new Error(`Conflicting managed working-tree entry: ${entry}`);
        }
        setManagedWorkingTreeEntry(target, entry, expected);
      } else if (current === undefined) {
        setManagedWorkingTreeEntry(target, entry, expected);
      } else {
        mergeManagedWorkingTree(current, [], expected);
      }
    }
    return;
  }
  const [head, ...tail] = segments;
  const current = managedWorkingTreeEntry(target, head);
  if (current === 'file') throw new Error(`Conflicting managed working-tree entry: ${head}`);
  const child = current ?? Object.create(null);
  setManagedWorkingTreeEntry(target, head, child);
  mergeManagedWorkingTree(child, tail, managedTree);
}

function cloneManagedWorkingTree(managedTree: ManagedWorkingTree): ManagedWorkingTree {
  return Object.fromEntries(
    Object.entries(managedTree).map(([entry, expected]) => [
      entry,
      expected === 'file' ? expected : cloneManagedWorkingTree(expected),
    ]),
  );
}

async function assertWorkingTreeAbsentOrRealDirectory(
  projectRoot: string,
  directory: string,
): Promise<boolean> {
  try {
    await captureAncestorIdentities(projectRoot, directory);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function realWorkingFileExists(file: string): Promise<boolean> {
  try {
    await readWorkingObjectIdentity(file, 'file');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function validateQuarantinedNode(
  directory: string,
  node: InspectedWorkingNode,
  ancestors: readonly { path: string; identity: WorkingObjectIdentity }[],
): Promise<void> {
  await assertQuarantineAncestorIdentities(ancestors);
  const actual = await readWorkingObjectIdentity(directory, node.identity.kind);
  if (!sameWorkingIdentity(node.identity, actual)) {
    throw new Error(`Quarantined working object changed: ${directory}`);
  }
  if (!node.children) return;
  const entries = (await readDir(directory)).sort();
  await assertQuarantineAncestorIdentities(ancestors);
  const expectedEntries = [...node.children.keys()].sort();
  const after = await readWorkingObjectIdentity(directory, 'directory');
  if (
    !sameWorkingIdentity(node.identity, after) ||
    JSON.stringify(entries) !== JSON.stringify(expectedEntries)
  ) {
    throw new Error(`Quarantined working directory changed: ${directory}`);
  }
  for (const entry of expectedEntries) {
    await validateQuarantinedNode(path.join(directory, entry), node.children.get(entry)!, [
      ...ancestors,
      { path: directory, identity: node.identity },
    ]);
  }
  const entriesAfter = (await readDir(directory)).sort();
  await assertQuarantineAncestorIdentities(ancestors);
  const finalIdentity = await readWorkingObjectIdentity(directory, 'directory');
  if (
    !sameWorkingIdentity(node.identity, finalIdentity) ||
    JSON.stringify(entriesAfter) !== JSON.stringify(expectedEntries)
  ) {
    throw new Error(`Quarantined working directory changed: ${directory}`);
  }
}

async function assertQuarantineAncestorIdentities(
  ancestors: readonly { path: string; identity: WorkingObjectIdentity }[],
): Promise<void> {
  for (const ancestor of ancestors) {
    const actual = await readWorkingObjectIdentity(ancestor.path, 'directory');
    if (!sameWorkingIdentity(ancestor.identity, actual)) {
      throw new Error(`Quarantine ancestor changed: ${ancestor.path}`);
    }
  }
}

async function removeQuarantinedNode(
  directory: string,
  node: InspectedWorkingNode,
  ancestors: readonly { path: string; identity: WorkingObjectIdentity }[],
): Promise<void> {
  await assertQuarantineAncestorIdentities(ancestors);
  const actual = await readWorkingObjectIdentity(directory, node.identity.kind);
  if (!sameWorkingIdentity(node.identity, actual)) {
    throw new Error(`Quarantined working object changed: ${directory}`);
  }
  if (!node.children) {
    await unlink(directory);
    return;
  }

  for (const [entry, child] of node.children) {
    await removeQuarantinedNode(path.join(directory, entry), child, [
      ...ancestors,
      { path: directory, identity: node.identity },
    ]);
  }
  const entries = await readDir(directory);
  await assertQuarantineAncestorIdentities(ancestors);
  const after = await readWorkingObjectIdentity(directory, 'directory');
  if (!sameWorkingIdentity(node.identity, after) || entries.length !== 0) {
    throw new Error(`Quarantined working directory changed before removal: ${directory}`);
  }
  await assertQuarantineAncestorIdentities(ancestors);
  const beforeRemove = await readWorkingObjectIdentity(directory, 'directory');
  if (!sameWorkingIdentity(node.identity, beforeRemove)) {
    throw new Error(`Quarantined working directory changed before removal: ${directory}`);
  }
  await rmdir(directory);
}

function quarantineAncestorChain(
  plan: ManagedWorkingTreePlan,
): Array<{ path: string; identity: WorkingObjectIdentity }> {
  const parent = path.dirname(plan.directory);
  return [...plan.ancestorIdentities.entries()]
    .filter(([candidate]) => candidate !== path.resolve(plan.directory))
    .filter(([candidate]) => isInsideDirectory(candidate, parent))
    .sort(([left], [right]) => left.split(path.sep).length - right.split(path.sep).length)
    .map(([ancestorPath, identity]) => ({ path: ancestorPath, identity }));
}

async function rollbackQuarantinedTrees(
  quarantined: readonly QuarantinedWorkingTree[],
): Promise<void> {
  for (const item of [...quarantined].reverse()) {
    try {
      await rename(item.quarantine, item.plan.directory);
    } catch {
      // Preserve the original failure. A conflicting replacement remains
      // visible for explicit repair instead of being overwritten.
    }
  }
}

async function removeManagedWorkingTree(
  projectRoot: string,
  plans: readonly ManagedWorkingTreePlan[],
): Promise<RemovalResult> {
  for (const plan of plans) {
    await validateManagedWorkingTree(projectRoot, plan);
  }

  // Preserve the existing retry contract for a config directory whose final
  // rmdir is denied, while ensuring this probe happens before any tree moves.
  const configPlan = plans.find((plan) => plan.countRemoval);
  if (configPlan?.root.children && configPlan.root.children.size > 0) {
    try {
      await rmdir(configPlan.directory);
      throw new Error('Managed config directory changed after inspection');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
    }
  }

  const quarantined: QuarantinedWorkingTree[] = [];
  try {
    for (const plan of plans) {
      await validateManagedWorkingTree(projectRoot, plan);
      const ancestors = quarantineAncestorChain(plan);
      await assertQuarantineAncestorIdentities(ancestors);
      const quarantine = path.join(
        path.dirname(plan.directory),
        `.${path.basename(plan.directory)}.comet-uninstall-${randomUUID()}`,
      );
      try {
        await lstat(quarantine);
        throw new Error(`Uninstall quarantine already exists: ${quarantine}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(plan.directory, quarantine);
      const item = { plan, quarantine };
      quarantined.push(item);
      await assertQuarantineAncestorIdentities(ancestors);
      await validateQuarantinedNode(quarantine, plan.root, ancestors);
    }
  } catch (error) {
    await rollbackQuarantinedTrees(quarantined);
    throw error;
  }

  let removed = 0;
  try {
    for (const item of quarantined) {
      await removeQuarantinedNode(
        item.quarantine,
        item.plan.root,
        quarantineAncestorChain(item.plan),
      );
      if (item.plan.countRemoval) removed++;
    }
  } catch {
    const remaining: QuarantinedWorkingTree[] = [];
    for (const item of quarantined) {
      try {
        await lstat(item.quarantine);
        remaining.push(item);
      } catch {
        // A fully removed quarantine has nothing left to restore.
      }
    }
    await rollbackQuarantinedTrees(remaining);
    return { removed, failed: 1 };
  }
  return { removed, failed: 0 };
}

async function removeManagedSkillsFromDirs(
  baseDir: string,
  skillsDirs: string[],
  managedSkills: string[],
): Promise<RemovalResult> {
  let removed = 0;
  let failed = 0;
  const parentDirs = new Set<string>();
  for (const skillsDir of skillsDirs) {
    const platformRoot = path.join(baseDir, skillsDir);
    const skillsRoot = path.join(baseDir, skillsDir, 'skills');
    let sharedBoundary = false;
    for (const boundary of [platformRoot, skillsRoot]) {
      try {
        if ((await lstat(boundary)).isSymbolicLink()) {
          failed++;
          sharedBoundary = true;
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          failed++;
          sharedBoundary = true;
          break;
        }
      }
    }
    if (sharedBoundary) continue;

    for (const skillRelPath of managedSkills) {
      try {
        const parts = skillRelPath.split('/');
        let current = baseDir;
        let linkedAncestor = false;
        const ancestorParts = [
          ...skillsDir.split(/[\\/]/u).filter(Boolean),
          'skills',
          ...parts.slice(0, -1),
        ];
        for (const part of ancestorParts) {
          current = path.join(current, part);
          if ((await lstat(current)).isSymbolicLink()) {
            if (await removeFile(current)) removed++;
            linkedAncestor = true;
            break;
          }
        }
        if (linkedAncestor) continue;

        if (await removeFile(path.join(skillsRoot, ...parts))) removed++;
        current = skillsRoot;
        for (const part of parts.slice(0, -1)) {
          current = path.join(current, part);
          parentDirs.add(current);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
      }
    }
  }

  for (const dir of [...parentDirs].sort(
    (left, right) => right.split(path.sep).length - left.split(path.sep).length,
  )) {
    try {
      if (await isDirEmpty(dir)) await removeDir(dir);
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

export async function removeLegacyCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  const canonicalDir = getPlatformSkillsDir(platform, scope);
  const legacyDirs = getPlatformSkillsDirs(platform, scope).filter((dir) => dir !== canonicalDir);
  if (legacyDirs.length === 0) return { removed: 0, failed: 0 };

  const managedSkills = getManagedSkillPaths(await readManifest());
  return removeManagedSkillsFromDirs(baseDir, legacyDirs, managedSkills);
}

async function removeCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
  workflowsToRemove: readonly CometWorkflow[] = ['native', 'classic'],
  workflowsToKeep: readonly CometWorkflow[] = [],
): Promise<RemovalResult> {
  const manifest = await readManifest();
  const selectionFor = (workflows: readonly CometWorkflow[]): InitWorkflowSelection =>
    workflows.length === 2 ? 'both' : workflows[0]!;
  const removablePaths = new Set(
    getManagedSkillPathsForSelection(manifest, selectionFor(workflowsToRemove)),
  );
  for (const retainedPath of getManagedSkillPathsForSelection(
    manifest,
    workflowsToKeep.length === 0 ? 'both' : selectionFor(workflowsToKeep),
  )) {
    if (workflowsToKeep.length > 0) removablePaths.delete(retainedPath);
  }
  const managedSkills = [...removablePaths];
  const skillsDir = getPlatformSkillsDir(platform, scope);
  const uniqueSkillsDirs = [
    ...new Set([
      ...getPlatformSkillsDirs(platform, scope),
      ...(scope === 'global' && platform.id === 'pi' ? [platform.skillsDir] : []),
    ]),
  ];
  const skillsRemoval = await removeManagedSkillsFromDirs(baseDir, uniqueSkillsDirs, managedSkills);
  let removed = skillsRemoval.removed;
  let failed = skillsRemoval.failed;

  if (OPENCODE_STYLE_PLATFORM_IDS.has(platform.id)) {
    const commandsDir = path.join(baseDir, skillsDir, 'commands');
    for (const skillRelPath of manifest.skills.filter((path) => removablePaths.has(path))) {
      const parts = skillRelPath.split('/');
      if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue;

      const skillName = parts[0];
      const commandFile = path.join(commandsDir, `${skillName}.md`);
      try {
        const result = await removeFile(commandFile);
        if (result) {
          removed++;
        }
      } catch {
        failed++;
      }
    }
  }

  if (platform.id === 'pi') {
    if (workflowsToKeep.length > 0) {
      return { removed, failed };
    }
    const extensionsDir = path.join(baseDir, skillsDir, 'extensions');
    try {
      if (await removeFile(path.join(extensionsDir, 'comet-commands.ts'))) {
        removed++;
      }
    } catch {
      failed++;
    }
    try {
      if (await isDirEmpty(extensionsDir)) {
        await removeDir(extensionsDir);
      }
    } catch {
      failed++;
    }
  }

  return { removed, failed };
}

async function removeCometRulesForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  if (!platform.rulesDir || !platform.rulesFormat) {
    return { removed: 0, failed: 0 };
  }

  const manifest = await readManifest();
  const rulePaths = [
    ...(manifest.rules ?? []),
    ...(manifest.nativeRules ?? []),
    ...LEGACY_RULE_PATHS,
  ];
  if (!rulePaths || rulePaths.length === 0) {
    return { removed: 0, failed: 0 };
  }

  const skillsDir = getPlatformSkillsDir(platform, scope);
  const rulesBase =
    platform.rulesBaseDir !== undefined
      ? platform.rulesBaseDir === ''
        ? baseDir
        : path.join(baseDir, platform.rulesBaseDir)
      : path.join(baseDir, skillsDir);

  let removed = 0;
  let failed = 0;

  for (const ruleRelPath of rulePaths) {
    const ruleFileName = path.basename(ruleRelPath);
    const rulesDestDir = path.join(rulesBase, platform.rulesDir);
    const dest = computeRuleDestPath(rulesDestDir, ruleFileName, platform.rulesFormat);

    try {
      const result = await removeFile(dest);
      if (result) {
        removed++;
      }
    } catch {
      failed++;
    }
  }

  const rulesDestDir = path.join(rulesBase, platform.rulesDir);
  try {
    if (await isDirEmpty(rulesDestDir)) {
      await removeDir(rulesDestDir);
    }
  } catch {
    failed++;
  }

  return { removed, failed };
}

async function removeOpenSpecSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  let removed = 0;
  let failed = 0;
  for (const skillsDir of getPlatformSkillsDirs(platform, scope)) {
    const skillsRoot = path.join(baseDir, skillsDir, 'skills');
    try {
      for (const entry of await readDir(skillsRoot)) {
        if (!/^openspec-[a-z0-9-]+$/iu.test(entry)) continue;
        if (await removeDir(path.join(skillsRoot, entry))) removed++;
      }
    } catch {
      failed++;
    }
    const commandsRoot = path.join(baseDir, skillsDir, 'commands');
    try {
      for (const entry of await readDir(commandsRoot)) {
        if (!/^(?:opsx|openspec)-[a-z0-9-]+\.[a-z0-9.]+$/iu.test(entry)) continue;
        if (await removeFile(path.join(commandsRoot, entry))) removed++;
      }
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

function removeSuperpowersSkillsForPlatform(
  projectPath: string,
  platform: Platform,
  scope: InstallScope = 'project',
): RemovalResult {
  const agent = SKILLS_AGENT_MAP[platform.id];
  if (!agent) return { removed: 0, failed: 0 };
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const scopeArgs = scope === 'global' ? ['--global'] : [];
  try {
    const output = execFileSync(command, ['skills', 'list', '--json', ...scopeArgs], {
      cwd: projectPath,
      encoding: 'utf8',
      timeout: 30_000,
      shell: process.platform === 'win32',
    });
    const listed = JSON.parse(output) as Array<{
      agents?: unknown;
      name?: unknown;
      source?: unknown;
    }>;
    const names = listed.flatMap((skill) =>
      skill.source === 'obra/superpowers' &&
      typeof skill.name === 'string' &&
      Array.isArray(skill.agents) &&
      skill.agents.includes(agent)
        ? [skill.name]
        : [],
    );
    let removed = 0;
    let failed = 0;
    for (const name of names) {
      try {
        execFileSync(command, ['skills', 'remove', name, '--agent', agent, '--yes', ...scopeArgs], {
          cwd: projectPath,
          stdio: 'ignore',
          timeout: 60_000,
          shell: process.platform === 'win32',
        });
        removed++;
      } catch {
        failed++;
      }
    }
    return { removed, failed };
  } catch {
    return { removed: 0, failed: 1 };
  }
}

async function removeCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  if (!platform.supportsHooks || !platform.hookFormat) {
    return { removed: 0, failed: 0 };
  }

  const manifest = await readManifest();
  const hooksConfig = { ...(manifest.hooks ?? {}), ...(manifest.nativeHooks ?? {}) };
  if (!hooksConfig || Object.keys(hooksConfig).length === 0) {
    return { removed: 0, failed: 0 };
  }

  const hookFormat = platform.hookFormat;
  const platformBase = path.join(baseDir, getPlatformConfigDir(platform, scope));
  const scriptRelPaths = [...new Set([...Object.keys(hooksConfig), ...LEGACY_HOOK_SCRIPT_PATHS])];

  try {
    switch (hookFormat) {
      case 'claude-code': {
        const canonicalFile = platform.hookConfigFile ?? 'settings.local.json';
        const files = [canonicalFile, ...(platform.legacyHookConfigFiles ?? [])];
        let removed = 0;
        let failed = 0;
        for (const file of new Set(files)) {
          let result: RemovalResult;
          try {
            result = await removeManagedHooksFromJsonFile(
              path.join(platformBase, file),
              scriptRelPaths,
            );
          } catch {
            if (file === canonicalFile) failed++;
            continue;
          }
          removed += result.removed;
          if (file === canonicalFile) failed += result.failed;
        }
        return { removed, failed };
      }
      case 'qwen':
      case 'qoder':
      case 'codebuddy':
        return await removeQwenStyleHooks(platformBase, scriptRelPaths);
      case 'gemini':
        return await removeGeminiHooks(platformBase, scriptRelPaths);
      case 'windsurf':
        return await removeWindsurfHooks(platformBase, scriptRelPaths);
      case 'copilot':
        return await removeCopilotHooks(platformBase);
      case 'kiro':
        return await removeKiroHooks(platformBase, scriptRelPaths);
      default:
        return { removed: 0, failed: 0 };
    }
  } catch {
    return { removed: 0, failed: 1 };
  }
}

async function removeQwenStyleHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const settingsPath = path.join(platformBase, 'settings.json');
  if (!(await fileExists(settingsPath))) return { removed: 0, failed: 0 };
  let removed = 0;
  const readResult = await readJsonObjectFile(settingsPath);
  if (readResult.status === 'missing') return { removed: 0, failed: 0 };
  if (readResult.status === 'error') return { removed: 0, failed: 1 };
  const settings = readResult.value;

  const existingHooks = settings.hooks as Record<string, unknown> | undefined;
  if (!existingHooks) {
    return { removed: 0, failed: 0 };
  }

  const existingPreToolUse = existingHooks.PreToolUse as Array<Record<string, unknown>> | undefined;
  if (!existingPreToolUse || !Array.isArray(existingPreToolUse)) {
    return { removed: 0, failed: 0 };
  }

  const filtered = existingPreToolUse.flatMap((group) => {
    if (!Array.isArray(group.hooks)) return [group];

    const hooksBefore = (group.hooks as Array<Record<string, unknown>>).length;
    const hooks = (group.hooks as Array<Record<string, unknown>>).filter(
      (hook) => !isManagedHookCommand(hook.command, scriptRelPaths),
    );
    removed += hooksBefore - hooks.length;

    const hasUnknownMetadata = Object.keys(group).some(
      (key) => key !== 'matcher' && key !== 'hooks',
    );
    if (hooks.length === 0) return hasUnknownMetadata ? [{ ...group, hooks: [] }] : [];
    return [{ ...group, hooks }];
  });

  if (filtered.length === 0) {
    delete existingHooks.PreToolUse;
  } else {
    existingHooks.PreToolUse = filtered;
  }

  if (Object.keys(existingHooks).length === 0) {
    delete settings.hooks;
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { removed, failed: 0 };
}

async function removeGeminiHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const settingsPath = path.join(platformBase, 'settings.json');
  if (!(await fileExists(settingsPath))) return { removed: 0, failed: 0 };
  let removed = 0;
  const readResult = await readJsonObjectFile(settingsPath);
  if (readResult.status === 'missing') return { removed: 0, failed: 0 };
  if (readResult.status === 'error') return { removed: 0, failed: 1 };
  const settings = readResult.value;

  const existingHooks = settings.hooks as Record<string, unknown> | undefined;
  if (!existingHooks) {
    return { removed: 0, failed: 0 };
  }

  const existingBeforeTool = existingHooks.BeforeTool as Array<Record<string, unknown>> | undefined;
  if (!existingBeforeTool || !Array.isArray(existingBeforeTool)) {
    return { removed: 0, failed: 0 };
  }

  const filtered = existingBeforeTool.flatMap((group) => {
    if (!Array.isArray(group.hooks)) return [group];

    const hooksBefore = (group.hooks as Array<Record<string, unknown>>).length;
    const hooks = (group.hooks as Array<Record<string, unknown>>).filter(
      (hook) => !isManagedHookCommand(hook.command, scriptRelPaths),
    );
    removed += hooksBefore - hooks.length;

    const hasUnknownMetadata = Object.keys(group).some(
      (key) => key !== 'matcher' && key !== 'hooks',
    );
    if (hooks.length === 0) return hasUnknownMetadata ? [{ ...group, hooks: [] }] : [];
    return [{ ...group, hooks }];
  });

  if (filtered.length === 0) {
    delete existingHooks.BeforeTool;
  } else {
    existingHooks.BeforeTool = filtered;
  }

  if (Object.keys(existingHooks).length === 0) {
    delete settings.hooks;
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { removed, failed: 0 };
}

async function removeWindsurfHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const hooksPath = path.join(platformBase, 'hooks.json');
  if (!(await fileExists(hooksPath))) return { removed: 0, failed: 0 };
  let removed = 0;
  const readResult = await readJsonObjectFile(hooksPath);
  if (readResult.status === 'missing') return { removed: 0, failed: 0 };
  if (readResult.status === 'error') return { removed: 0, failed: 1 };
  const hooksFile = readResult.value;

  const existingHooks = hooksFile.hooks as Record<string, unknown> | undefined;
  if (!existingHooks) {
    return { removed: 0, failed: 0 };
  }

  const existingPreWrite = existingHooks.pre_write_code as
    | Array<Record<string, unknown>>
    | undefined;
  if (!existingPreWrite || !Array.isArray(existingPreWrite)) {
    return { removed: 0, failed: 0 };
  }

  const filtered = existingPreWrite.filter((entry) => {
    if (isManagedHookCommand(entry.command, scriptRelPaths)) {
      removed++;
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    delete existingHooks.pre_write_code;
  } else {
    existingHooks.pre_write_code = filtered;
  }

  if (Object.keys(existingHooks).length === 0) {
    delete hooksFile.hooks;
  }

  await writeFile(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n', 'utf-8');
  return { removed, failed: 0 };
}

async function removeCopilotHooks(platformBase: string): Promise<RemovalResult> {
  const hookFilePath = path.join(platformBase, 'hooks', 'comet-guard.json');
  let removed = 0;
  let failed = 0;
  try {
    if (await removeFile(hookFilePath)) removed++;
  } catch {
    failed++;
  }

  const hooksDir = path.join(platformBase, 'hooks');
  try {
    if (await isDirEmpty(hooksDir)) {
      await removeDir(hooksDir);
    }
  } catch {
    failed++;
  }

  return { removed, failed };
}

async function removeKiroHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const hooksDir = path.join(platformBase, 'hooks');
  try {
    if (!(await lstat(hooksDir)).isDirectory()) {
      return { removed: 0, failed: 1 };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { removed: 0, failed: 0 };
    }
    return { removed: 0, failed: 1 };
  }

  let removed = 0;
  let failed = 0;
  const entries = await readDir(hooksDir);

  for (const entry of entries) {
    if (!entry.endsWith('.kiro.hook')) continue;
    const baseName = entry.replace('.kiro.hook', '');
    const isCometHook = scriptRelPaths.some((scriptPath) => {
      const scriptBase = path.basename(scriptPath).replace(/\.mjs$/u, '');
      return scriptBase === baseName;
    });

    if (isCometHook) {
      const hookPath = path.join(hooksDir, entry);
      try {
        if (await removeFile(hookPath)) {
          removed++;
        }
      } catch {
        failed++;
      }
    }
  }

  try {
    if (await isDirEmpty(hooksDir)) {
      await removeDir(hooksDir);
    }
  } catch {
    failed++;
  }

  return { removed, failed };
}

async function removeWorkingDirs(
  projectPath: string,
  options: RemoveWorkingDirsOptions = {},
): Promise<RemovalResult> {
  let projectRoot: string;
  try {
    projectRoot = await realpath(projectPath);
    const rootStat = await lstat(projectRoot, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { removed: 0, failed: 1 };
    }
  } catch {
    return { removed: 0, failed: 1 };
  }
  const cometDir = path.join(projectRoot, '.comet');
  const docsDir = path.join(projectRoot, 'docs');
  const legacyOpenSpecRoot = path.join(projectRoot, 'openspec');
  const docsOpenSpecRoot = path.join(docsDir, 'openspec');

  let plans: ManagedWorkingTreePlan[];
  let configIdentity: WorkflowProjectConfigIdentity;
  try {
    const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot, {
      allowPartialProject: true,
    });
    const document = snapshot.document;
    configIdentity = snapshot.identity;
    const configuredWorkflows = document?.config
      ? (document.config.workflows ?? [document.config.default_workflow])
      : [];
    const workflowsToRemove = options.workflows;
    const classicEnabled =
      (workflowsToRemove === undefined || workflowsToRemove.includes('classic')) &&
      (configuredWorkflows.includes('classic') || document?.classic !== undefined);
    const nativeEnabled =
      (workflowsToRemove === undefined || workflowsToRemove.includes('native')) &&
      (configuredWorkflows.includes('native') || document?.native !== undefined);
    const selectiveWorkflowRemoval =
      workflowsToRemove !== undefined && workflowsToRemove.length < configuredWorkflows.length;
    const fullWorkflowRemoval =
      workflowsToRemove === undefined ||
      (configuredWorkflows.length > 0 && workflowsToRemove.length === configuredWorkflows.length);
    const classicOnlyRemoval =
      workflowsToRemove?.includes('classic') === true && !workflowsToRemove.includes('native');
    const removingClassicWorkingDirs = classicEnabled || fullWorkflowRemoval;
    const artifactLayout = classicEnabled ? (document?.classic?.artifact_layout ?? 'legacy') : null;
    const layout = artifactLayout ? classicLayoutPaths(projectRoot, artifactLayout) : null;
    const preserveOpenSpecRoot =
      layout !== null &&
      (await realWorkingFileExists(path.join(layout.openSpecRoot, 'config.yaml')));
    const splitDocsWorkingTrees =
      artifactLayout === 'docs' && (preserveOpenSpecRoot || classicOnlyRemoval);

    if (artifactLayout) {
      const legacyRootExists = await assertWorkingTreeAbsentOrRealDirectory(
        projectRoot,
        legacyOpenSpecRoot,
      );
      const docsRootExists = await assertWorkingTreeAbsentOrRealDirectory(
        projectRoot,
        docsOpenSpecRoot,
      );
      if (legacyRootExists && docsRootExists) {
        throw new Error('Refusing to remove conflicting legacy and docs OpenSpec roots');
      }
      const alternateRootExists = artifactLayout === 'legacy' ? docsRootExists : legacyRootExists;
      if (alternateRootExists) {
        throw new Error('Refusing to remove an OpenSpec root that does not match project config');
      }
    }

    const cometTree = cloneManagedWorkingTree(
      workflowsToRemove === undefined || workflowsToRemove.length === configuredWorkflows.length
        ? COMET_WORKING_TREE
        : EMPTY_MANAGED_WORKING_TREE,
    );
    const docsTree: ManagedWorkingTree = removingClassicWorkingDirs
      ? { superpowers: cloneManagedWorkingTree(SUPERPOWERS_WORKING_TREE) }
      : {};
    const legacyTree = removingClassicWorkingDirs
      ? cloneManagedWorkingTree(OPENSPEC_WORKING_TREE)
      : {};
    if (artifactLayout === 'docs' && !preserveOpenSpecRoot) {
      mergeManagedWorkingTree(docsTree, ['openspec'], OPENSPEC_WORKING_TREE);
    }

    let separateNativeRoot: string | null = null;
    if (nativeEnabled) {
      if (!document?.native) throw new Error('Native project config is incomplete');
      const nativePaths = await nativeProjectPaths(projectRoot, document.native.artifact_root);
      if (isInsideDirectory(docsDir, nativePaths.nativeRoot)) {
        if (splitDocsWorkingTrees || selectiveWorkflowRemoval) {
          separateNativeRoot = nativePaths.nativeRoot;
        } else {
          mergeManagedWorkingTree(
            docsTree,
            path.relative(docsDir, nativePaths.nativeRoot).split(path.sep).filter(Boolean),
            NATIVE_WORKING_TREE,
          );
        }
      } else if (isInsideDirectory(cometDir, nativePaths.nativeRoot)) {
        if (selectiveWorkflowRemoval) {
          separateNativeRoot = nativePaths.nativeRoot;
        } else {
          mergeManagedWorkingTree(
            cometTree,
            path.relative(cometDir, nativePaths.nativeRoot).split(path.sep).filter(Boolean),
            NATIVE_WORKING_TREE,
          );
        }
      } else if (
        artifactLayout === 'legacy' &&
        isInsideDirectory(legacyOpenSpecRoot, nativePaths.nativeRoot)
      ) {
        mergeManagedWorkingTree(
          legacyTree,
          path.relative(legacyOpenSpecRoot, nativePaths.nativeRoot).split(path.sep).filter(Boolean),
          NATIVE_WORKING_TREE,
        );
      } else {
        separateNativeRoot = nativePaths.nativeRoot;
      }
    }

    const candidates: Array<
      readonly [directory: string, tree: ManagedWorkingTree, countRemoval: boolean]
    > = [];
    if (splitDocsWorkingTrees) {
      candidates.push([path.join(docsDir, 'superpowers'), SUPERPOWERS_WORKING_TREE, false]);
      if (artifactLayout === 'docs' && !preserveOpenSpecRoot) {
        candidates.push([layout!.openSpecRoot, OPENSPEC_WORKING_TREE, false]);
      }
    } else if (Object.keys(docsTree).length > 0) {
      candidates.push([docsDir, docsTree, false]);
    }
    if (artifactLayout === 'legacy' && !preserveOpenSpecRoot) {
      candidates.push([layout!.openSpecRoot, legacyTree, false]);
    }
    if (separateNativeRoot) {
      candidates.push([separateNativeRoot, NATIVE_WORKING_TREE, false]);
    }
    if (Object.keys(cometTree).length > 0) candidates.push([cometDir, cometTree, true]);

    plans = [];
    for (const [directory, managedTree, countRemoval] of candidates) {
      const inspected = await inspectManagedWorkingTree(
        projectRoot,
        directory,
        managedTree,
        countRemoval,
      );
      if (inspected) plans.push(inspected);
    }
    await options.testHooks?.afterPlanInspection?.();
    if (
      !workflowProjectConfigIdentityEquals(
        configIdentity,
        await readWorkflowProjectConfigIdentity(projectRoot),
      )
    ) {
      throw new Error('Project config changed during uninstall planning');
    }
    for (const plan of plans) {
      await validateManagedWorkingTree(projectRoot, plan);
    }
  } catch {
    return { removed: 0, failed: 1 };
  }

  try {
    return await removeManagedWorkingTree(projectRoot, plans);
  } catch {
    return { removed: 0, failed: 1 };
  }
}

export {
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeOpenSpecSkillsForPlatform,
  removeSuperpowersSkillsForPlatform,
  removeWorkingDirs,
  removeCometProjectInstructions,
};
