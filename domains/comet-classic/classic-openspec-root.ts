import path from 'path';

import { parseDocument } from 'yaml';

import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import {
  assertClassicLayoutReadable,
  classicProjectRelative,
  type ClassicLayoutPaths,
} from './classic-layout.js';

const OPENSPEC_CONFIG_MAX_BYTES = 1024 * 1024;

export interface ClassicOpenSpecRootHealth {
  layout: ClassicLayoutPaths;
  configPath: string;
  schema: string;
}

/**
 * Prove that the configured OpenSpec root is an initialized, readable project
 * root rather than a directory tree that only happens to contain Comet's
 * working folders.
 */
export async function assertClassicOpenSpecRootHealthy(
  projectRoot: string,
  layout?: ClassicLayoutPaths,
): Promise<ClassicOpenSpecRootHealth> {
  const resolvedLayout = layout ?? (await assertClassicLayoutReadable(projectRoot));
  const configPath = path.join(resolvedLayout.openSpecRoot, 'config.yaml');
  const relativeConfig = classicProjectRelative(resolvedLayout.projectRoot, configPath);
  let source: string;
  try {
    const result = await readProtectedProjectFile(
      resolvedLayout.projectRoot,
      relativeConfig,
      OPENSPEC_CONFIG_MAX_BYTES,
      {
        label: 'Classic OpenSpec project config',
        bigint: true,
      },
    );
    source = result.bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Classic OpenSpec root is unhealthy: ${relativeConfig} is missing; rerun OpenSpec initialization for the configured Classic layout`,
        { cause: error },
      );
    }
    throw new Error(
      `Classic OpenSpec root is unhealthy: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `Classic OpenSpec root is unhealthy: ${relativeConfig} is invalid YAML (${document.errors[0].message})`,
    );
  }
  const value = document.toJS() as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Classic OpenSpec root is unhealthy: ${relativeConfig} must contain a mapping`);
  }
  const schema = (value as Record<string, unknown>).schema;
  if (typeof schema !== 'string' || schema.trim() === '') {
    throw new Error(
      `Classic OpenSpec root is unhealthy: ${relativeConfig} must declare a non-empty schema`,
    );
  }

  return {
    layout: resolvedLayout,
    configPath: relativeConfig,
    schema,
  };
}
