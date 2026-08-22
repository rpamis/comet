import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';

import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import type { MemoryProviderConfig } from './types.js';

const CONFIG_PATH = '.comet/config.yaml';
const CONFIG_KEY = 'personal_memory';
const DEFAULT_PROFILE_CHARS = 2000;
const DEFAULT_TASK_CHARS = 6000;

export async function readPersonalMemoryConfig(homeDir: string): Promise<MemoryProviderConfig> {
  let source = '';
  try {
    source = await readFile(path.join(homeDir, ...CONFIG_PATH.split('/')), 'utf8');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (source.trim().length === 0) return defaultConfig();

  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid global Comet config: ${document.errors[0].message}`);
  }
  const root = document.toJS() as unknown;
  if (root === null || root === undefined) return defaultConfig();
  if (typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Invalid global Comet config: root must be a mapping');
  }
  return normalizeConfig((root as Record<string, unknown>)[CONFIG_KEY]);
}

export async function writePersonalMemoryConfig(
  homeDir: string,
  config: MemoryProviderConfig,
): Promise<void> {
  const file = path.join(homeDir, ...CONFIG_PATH.split('/'));
  let source = '';
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid global Comet config: ${document.errors[0].message}`);
  }
  const root = document.toJS() as unknown;
  if (root !== null && root !== undefined && (typeof root !== 'object' || Array.isArray(root))) {
    throw new Error('Invalid global Comet config: root must be a mapping');
  }
  if (
    config.provider === 'remote' &&
    (!config.remote || config.remote.endpoint.trim().length === 0)
  ) {
    throw new Error('Invalid personal_memory config: remote provider needs remote.endpoint');
  }
  document.set(CONFIG_KEY, toYamlConfig(config));
  await atomicWriteContainedText(file, document.toString(), { containedRoot: homeDir });
}

function defaultConfig(): MemoryProviderConfig {
  return {
    provider: 'local',
    profileCharLimit: DEFAULT_PROFILE_CHARS,
    taskContextCharLimit: DEFAULT_TASK_CHARS,
  };
}

function normalizeConfig(value: unknown): MemoryProviderConfig {
  if (value === undefined || value === null) return defaultConfig();
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid personal_memory config: expected a mapping');
  }
  const record = value as Record<string, unknown>;
  const provider = record.provider === 'remote' ? 'remote' : 'local';
  const remoteValue = record.remote;
  let remote: MemoryProviderConfig['remote'];
  if (remoteValue !== undefined) {
    if (typeof remoteValue !== 'object' || remoteValue === null || Array.isArray(remoteValue)) {
      throw new Error('Invalid personal_memory.remote config: expected a mapping');
    }
    const remoteRecord = remoteValue as Record<string, unknown>;
    if (typeof remoteRecord.endpoint !== 'string' || remoteRecord.endpoint.trim().length === 0) {
      throw new Error('Invalid personal_memory.remote.endpoint: expected a non-empty string');
    }
    remote = {
      endpoint: remoteRecord.endpoint.trim(),
      ...(typeof remoteRecord.token_env === 'string' ? { tokenEnv: remoteRecord.token_env } : {}),
      ...(typeof remoteRecord.profile === 'string' ? { profile: remoteRecord.profile } : {}),
      ...(typeof remoteRecord.timeout_ms === 'number'
        ? { timeoutMs: remoteRecord.timeout_ms }
        : {}),
    };
  }
  if (provider === 'remote' && remote === undefined) {
    throw new Error('Invalid personal_memory config: remote provider needs remote.endpoint');
  }
  return {
    provider,
    profileCharLimit: positiveNumber(record.profile_char_limit, DEFAULT_PROFILE_CHARS),
    taskContextCharLimit: positiveNumber(record.task_context_char_limit, DEFAULT_TASK_CHARS),
    ...(remote === undefined ? {} : { remote }),
  };
}

function toYamlConfig(config: MemoryProviderConfig): Record<string, unknown> {
  return {
    provider: config.provider,
    profile_char_limit: config.profileCharLimit,
    task_context_char_limit: config.taskContextCharLimit,
    ...(config.remote === undefined
      ? {}
      : {
          remote: {
            endpoint: config.remote.endpoint,
            ...(config.remote.tokenEnv === undefined ? {} : { token_env: config.remote.tokenEnv }),
            ...(config.remote.profile === undefined ? {} : { profile: config.remote.profile }),
            ...(config.remote.timeoutMs === undefined
              ? {}
              : { timeout_ms: config.remote.timeoutMs }),
          },
        }),
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
