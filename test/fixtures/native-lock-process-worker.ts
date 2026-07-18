import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  acquireNativeLock,
  diagnoseNativeLock,
  releaseNativeLock,
  takeOverNativeStaleLock,
  type NativeLock,
} from '../../domains/comet-native/native-lock.js';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';

async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

const [mode, projectRoot, lockName, role, readyFile, goFile, statusFile, releaseFile] =
  process.argv.slice(2);
if (
  !mode ||
  !projectRoot ||
  !lockName ||
  !role ||
  !readyFile ||
  !goFile ||
  !statusFile ||
  !releaseFile
) {
  throw new Error('Native lock process worker arguments are incomplete');
}

const paths = await nativeProjectPaths(projectRoot, '.');
const lockFile = path.join(paths.locksDir, `${lockName}.lock`);
if (mode === 'takeover') {
  const diagnosis = await diagnoseNativeLock(lockFile);
  if (diagnosis.status !== 'stale' || !diagnosis.owner || !diagnosis.identity) {
    throw new Error(`Expected a stale lock before the barrier, received ${diagnosis.status}`);
  }
  await fs.writeFile(readyFile, 'ready\n');
  await waitFor(goFile);
  if (role === 'late') await waitFor(`${goFile}.primary`);
  const takeover = await takeOverNativeStaleLock(paths, lockFile, diagnosis);
  let acquired: NativeLock | null = null;
  try {
    acquired = await acquireNativeLock(paths, lockName, `${role} takeover contender`);
    await fs.writeFile(statusFile, `acquired:${acquired.owner.id}\n`);
    if (role === 'primary') await fs.writeFile(`${goFile}.primary`, 'acquired\n');
    await waitFor(releaseFile);
  } catch (error) {
    await fs.writeFile(statusFile, `blocked:${(error as Error).message}\n`);
  } finally {
    if (acquired) await releaseNativeLock(acquired);
  }
  process.stdout.write(JSON.stringify({ takeover }));
} else if (mode === 'release-old') {
  const oldLock = JSON.parse(await fs.readFile(releaseFile, 'utf8')) as NativeLock;
  await fs.writeFile(readyFile, 'ready\n');
  await waitFor(goFile);
  if (role === 'late') await waitFor(`${goFile}.primary`);
  try {
    await releaseNativeLock(oldLock);
    await fs.writeFile(statusFile, 'released\n');
  } catch (error) {
    await fs.writeFile(statusFile, `blocked:${(error as Error).message}\n`);
  }
} else if (mode === 'acquire-race') {
  await fs.writeFile(readyFile, 'ready\n');
  await waitFor(goFile);
  let acquired: NativeLock | null = null;
  try {
    acquired = await acquireNativeLock(paths, lockName, `${role} direct contender`);
    await fs.writeFile(statusFile, `acquired:${acquired.owner.id}\n`);
    await waitFor(releaseFile);
  } catch (error) {
    await fs.writeFile(statusFile, `blocked:${(error as Error).message}\n`);
  } finally {
    if (acquired) await releaseNativeLock(acquired);
  }
} else {
  throw new Error(`Unknown Native lock process worker mode: ${mode}`);
}
