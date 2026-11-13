import * as engine from '../engine/run-store.js';
import { resolveClassicRunDirectory, resolveClassicLocalTarget } from './classic-runtime-paths.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import { discoverClassicProject } from './classic-layout.js';
import path from 'node:path';

export async function resolveClassicRunReadPath(changeDir: string, ref: string) {
  const absolute = path.resolve(changeDir, ref);
  const relative = path.relative(path.resolve(changeDir), absolute);
  if (
    path.isAbsolute(ref) ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  )
    throw new Error('Run path must stay inside the change directory');
  const projectRoot = await discoverClassicProject(changeDir);
  const local = await resolveClassicLocalTarget(projectRoot, absolute, { readOnly: true });
  const inspectionRoot = local?.root ?? changeDir;
  const target = local?.target ?? absolute;
  const root =
    inspectionRoot === path.parse(target).root
      ? resolveWorkspaceRuntimeRootSync(projectRoot)
      : inspectionRoot;
  return { root, ref: path.relative(root, target).replaceAll('\\', '/'), inspectionRoot, target };
}

export async function appendTrajectory(
  ...args: Parameters<typeof engine.appendTrajectory>
): Promise<Awaited<ReturnType<typeof engine.appendTrajectory>>> {
  args[0] = await resolveClassicRunDirectory(args[0]);
  return engine.appendTrajectory(...args);
}

export async function readTrajectory(
  ...args: Parameters<typeof engine.readTrajectory>
): Promise<Awaited<ReturnType<typeof engine.readTrajectory>>> {
  const resolved = await resolveClassicRunReadPath(args[0], args[1]);
  args[0] = resolved.root;
  args[1] = resolved.ref;
  return engine.readTrajectory(...args);
}

export async function readArtifacts(
  ...args: Parameters<typeof engine.readArtifacts>
): Promise<Awaited<ReturnType<typeof engine.readArtifacts>>> {
  const resolved = await resolveClassicRunReadPath(args[0], args[1]);
  args[0] = resolved.root;
  args[1] = resolved.ref;
  return engine.readArtifacts(...args);
}

export async function writeArtifacts(
  ...args: Parameters<typeof engine.writeArtifacts>
): Promise<Awaited<ReturnType<typeof engine.writeArtifacts>>> {
  args[0] = await resolveClassicRunDirectory(args[0]);
  return engine.writeArtifacts(...args);
}

export async function writeContext(
  ...args: Parameters<typeof engine.writeContext>
): Promise<Awaited<ReturnType<typeof engine.writeContext>>> {
  args[0] = await resolveClassicRunDirectory(args[0]);
  return engine.writeContext(...args);
}

export async function readContext(
  ...args: Parameters<typeof engine.readContext>
): Promise<Awaited<ReturnType<typeof engine.readContext>>> {
  const resolved = await resolveClassicRunReadPath(args[0], args[1]);
  args[0] = resolved.root;
  args[1] = resolved.ref;
  return engine.readContext(...args);
}

export async function writePendingAction(
  ...args: Parameters<typeof engine.writePendingAction>
): Promise<Awaited<ReturnType<typeof engine.writePendingAction>>> {
  args[0] = await resolveClassicRunDirectory(args[0]);
  return engine.writePendingAction(...args);
}

export async function readPendingAction(
  ...args: Parameters<typeof engine.readPendingAction>
): Promise<Awaited<ReturnType<typeof engine.readPendingAction>>> {
  const resolved = await resolveClassicRunReadPath(args[0], args[1]);
  args[0] = resolved.root;
  args[1] = resolved.ref;
  return engine.readPendingAction(...args);
}

export async function clearPendingAction(
  ...args: Parameters<typeof engine.clearPendingAction>
): Promise<Awaited<ReturnType<typeof engine.clearPendingAction>>> {
  args[0] = await resolveClassicRunDirectory(args[0]);
  return engine.clearPendingAction(...args);
}

export async function writeCheckpoint(
  ...args: Parameters<typeof engine.writeCheckpoint>
): Promise<Awaited<ReturnType<typeof engine.writeCheckpoint>>> {
  args[0] = await resolveClassicRunDirectory(args[0]);
  return engine.writeCheckpoint(...args);
}

export async function readCheckpoint(
  ...args: Parameters<typeof engine.readCheckpoint>
): Promise<Awaited<ReturnType<typeof engine.readCheckpoint>>> {
  const resolved = await resolveClassicRunReadPath(args[0], args[1]);
  args[0] = resolved.root;
  args[1] = resolved.ref;
  return engine.readCheckpoint(...args);
}
