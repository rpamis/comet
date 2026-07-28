import { AsyncLocalStorage } from 'async_hooks';
import { promises as fs } from 'fs';
import path from 'path';

import { discoverClassicProject } from './classic-layout.js';

export interface ClassicCommandContext {
  invocationCwd: string;
  projectRoot: string;
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
  return { invocationCwd, projectRoot };
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
