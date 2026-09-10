import { AsyncLocalStorage } from 'async_hooks';
import { promises as fs } from 'fs';
import path from 'path';

import type { ClassicCommandHandler } from './classic-cli.js';
import { discoverClassicProject } from './classic-layout.js';

export interface ClassicCommandContext {
  invocationCwd: string;
  projectRoot: string;
  observations: Map<string, Promise<unknown>>;
}

export interface ClassicCommandContextOptions {
  invocationCwd?: string;
  projectRoot?: string;
}

const commandContext = new AsyncLocalStorage<ClassicCommandContext>();

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

async function resolveCommandContext(
  options: ClassicCommandContextOptions,
): Promise<ClassicCommandContext> {
  const invocationCwd = path.resolve(options.invocationCwd ?? process.cwd());
  const projectRoot = path.resolve(
    options.projectRoot ?? (await discoverClassicProject(invocationCwd)),
  );
  const [realInvocationCwd, realProjectRoot] = await Promise.all([
    fs.realpath(invocationCwd),
    fs.realpath(projectRoot),
  ]);
  if (!isInside(realProjectRoot, realInvocationCwd)) {
    throw new Error(
      `Classic command invocation cwd is outside the discovered project: ${invocationCwd}`,
    );
  }
  return { invocationCwd, projectRoot, observations: new Map() };
}

export async function withClassicCommandContext<T>(
  options: ClassicCommandContextOptions,
  operation: (context: ClassicCommandContext) => Promise<T>,
): Promise<T> {
  const active = commandContext.getStore();
  if (active) return operation(active);
  const resolved = await resolveCommandContext(options);
  return commandContext.run(resolved, () => operation(resolved));
}

export function classicCommandProjectRoot(): string {
  const active = commandContext.getStore();
  if (!active) throw new Error('Classic command project context is unavailable');
  return active.projectRoot;
}

export function classicCommandInvocationCwd(): string {
  const active = commandContext.getStore();
  if (!active) throw new Error('Classic command invocation context is unavailable');
  return active.invocationCwd;
}

/** Operation-local reuse requires a caller-supplied content fingerprint, never a cross-command cache. */
export async function classicOperationObservation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const active = commandContext.getStore();
  if (!active) return operation();
  const existing = active.observations.get(key);
  if (existing) return existing as Promise<T>;
  const pending = operation();
  active.observations.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    active.observations.delete(key);
    throw error;
  }
}

/**
 * Wraps a Classic command handler so its command context is always established
 * before the handler body runs. Handlers that need `classicCommandProjectRoot()`
 * or `classicCommandInvocationCwd()` must be exported through this wrapper instead
 * of calling `withClassicCommandContext` by hand, so a handler can never consume
 * the context without first establishing it.
 */
export function withProjectContext(handler: ClassicCommandHandler): ClassicCommandHandler {
  return (args, options) => withClassicCommandContext(options, () => handler(args, options));
}
