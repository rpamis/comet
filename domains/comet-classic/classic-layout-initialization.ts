import path from 'path';

import {
  readWorkflowProjectConfigIdentity,
  readWorkflowProjectConfigSnapshot,
  workflowProjectConfigIdentityEquals,
  type WorkflowProjectConfigIdentity,
} from '../workflow-contract/project-config-reader.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  assertClassicLayoutWritable,
  classicLayoutPaths,
  classicProjectRelative,
  type ClassicArtifactLayout,
  type ClassicLayoutPaths,
} from './classic-layout.js';

const ROOT_MOVE_JOURNAL = '.comet/classic-root-move.json';
const initializationPermitBrand = Symbol('ClassicLayoutInitializationPermit');

export interface ClassicLayoutInitializationPermit {
  readonly projectRoot: string;
  readonly artifactLayout: ClassicArtifactLayout;
  readonly configIdentity: WorkflowProjectConfigIdentity;
  readonly [initializationPermitBrand]: true;
}

export interface ClassicLayoutInitialization extends ClassicLayoutPaths {
  readonly initializationPermit: ClassicLayoutInitializationPermit;
}

function permitsDesiredRoot(
  permit: ClassicLayoutInitializationPermit | undefined,
  projectRoot: string,
  desiredLayout: ClassicArtifactLayout,
): permit is ClassicLayoutInitializationPermit {
  return (
    permit?.[initializationPermitBrand] === true &&
    permit.projectRoot === projectRoot &&
    permit.artifactLayout === desiredLayout
  );
}

function initializationPermit(
  projectRoot: string,
  artifactLayout: ClassicArtifactLayout,
  configIdentity: WorkflowProjectConfigIdentity,
): ClassicLayoutInitializationPermit {
  return {
    projectRoot,
    artifactLayout,
    configIdentity,
    [initializationPermitBrand]: true,
  };
}

/**
 * Validate the only two safe OpenSpec initialization states:
 * an existing configured Classic layout that is already writable, or a truly
 * fresh project where neither managed OpenSpec root exists.
 */
export async function assertClassicLayoutInitializationSafe(
  projectRoot: string,
  desiredLayout: ClassicArtifactLayout,
  permit?: ClassicLayoutInitializationPermit,
  expectedConfigIdentity?: WorkflowProjectConfigIdentity,
): Promise<ClassicLayoutInitialization> {
  const root = path.resolve(projectRoot);
  const configSnapshot = await readWorkflowProjectConfigSnapshot(root, {
    allowPartialProject: true,
  });
  const configIdentity = await readWorkflowProjectConfigIdentity(root);
  if (!workflowProjectConfigIdentityEquals(configIdentity, configSnapshot.identity)) {
    throw new Error('Project config changed while inspecting Classic layout initialization');
  }
  if (
    expectedConfigIdentity &&
    !workflowProjectConfigIdentityEquals(configIdentity, expectedConfigIdentity)
  ) {
    throw new Error('Project config changed after the workflow decision');
  }
  if (
    permit?.[initializationPermitBrand] === true &&
    permit.projectRoot === root &&
    permit.artifactLayout === desiredLayout &&
    !workflowProjectConfigIdentityEquals(permit.configIdentity, configIdentity)
  ) {
    throw new Error('Project config changed during Classic layout initialization');
  }
  const config = configSnapshot.document;
  const configuredWorkflows =
    config?.config?.workflows ?? (config?.config ? [config.config.default_workflow] : []);
  const legacyClassicConfigured =
    config !== null &&
    ['language', 'context_compression', 'review_mode', 'auto_transition'].some((key) =>
      Object.prototype.hasOwnProperty.call(config.value, key),
    );
  const classicEnabled =
    configuredWorkflows.includes('classic') ||
    (!config?.config && (config?.classic !== undefined || legacyClassicConfigured));

  const pendingMove = await inspectProtectedProjectPath(root, ROOT_MOVE_JOURNAL, {
    label: ROOT_MOVE_JOURNAL,
    expected: 'file',
  });
  if (pendingMove.exists) {
    throw new Error(
      'Classic root move transaction is incomplete; inspect it with comet doctor and recover it explicitly before writing',
    );
  }

  const legacy = classicLayoutPaths(root, 'legacy');
  const docs = classicLayoutPaths(root, 'docs');
  const [legacyRoot, docsRoot] = await Promise.all([
    inspectProtectedProjectPath(root, classicProjectRelative(root, legacy.openSpecRoot), {
      label: 'Classic managed physical path openspec',
      expected: 'directory',
    }),
    inspectProtectedProjectPath(root, classicProjectRelative(root, docs.openSpecRoot), {
      label: 'Classic managed physical path docs/openspec',
      expected: 'directory',
    }),
  ]);
  const desired = desiredLayout === 'docs' ? docs : legacy;
  const desiredRoot = desiredLayout === 'docs' ? docsRoot : legacyRoot;
  const alternateRoot = desiredLayout === 'docs' ? legacyRoot : docsRoot;

  if (config && classicEnabled) {
    const configuredLayout = config.classic?.artifact_layout ?? 'legacy';
    if (configuredLayout !== desiredLayout) {
      throw new Error(
        `Configured Classic layout is ${configuredLayout}, but OpenSpec initialization requested ${desiredLayout}`,
      );
    }
    if (!legacyRoot.exists && !docsRoot.exists) {
      return {
        ...desired,
        initializationPermit: permitsDesiredRoot(permit, root, desiredLayout)
          ? permit
          : initializationPermit(root, desiredLayout, configIdentity),
      };
    }
    if (!config.config) {
      if (desiredRoot.exists && !alternateRoot.exists) {
        return {
          ...desired,
          initializationPermit: permitsDesiredRoot(permit, root, desiredLayout)
            ? permit
            : initializationPermit(root, desiredLayout, configIdentity),
        };
      }
      if (desiredRoot.exists && alternateRoot.exists) {
        throw new Error(
          'Classic layout conflict: both openspec/ and docs/openspec/ exist; resolve the conflict before writing',
        );
      }
      throw new Error(
        `Configured Classic OpenSpec root is missing for ${desiredLayout} layout while the alternate root exists`,
      );
    }
    const configured = await assertClassicLayoutWritable(root);
    return {
      ...configured,
      initializationPermit: permitsDesiredRoot(permit, root, desiredLayout)
        ? permit
        : initializationPermit(root, desiredLayout, configIdentity),
    };
  }

  if (legacyRoot.exists || docsRoot.exists) {
    if (
      permitsDesiredRoot(permit, root, desiredLayout) &&
      desiredRoot.exists &&
      !alternateRoot.exists
    ) {
      return { ...desired, initializationPermit: permit };
    }
    throw new Error(
      'Cannot initialize Classic layout without .comet/config.yaml when openspec/ or docs/openspec/ already exists',
    );
  }

  return {
    ...desired,
    initializationPermit: initializationPermit(root, desiredLayout, configIdentity),
  };
}
