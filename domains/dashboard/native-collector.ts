import path from 'node:path';

import { inspectNativeArchivePreflight } from '../comet-native/native-archive-inspection.js';
import { readProjectConfig } from '../comet-native/native-config.js';
import { inspectNativeConflictRadar } from '../comet-native/native-conflict-inspection.js';
import { listNativeStatusPage } from '../comet-native/native-diagnostics.js';
import { nativeProjectPaths } from '../comet-native/native-paths.js';
import {
  adaptNativeDashboardProjection,
  NATIVE_DASHBOARD_LIMITS,
  type NativeDashboardProjection,
} from './native-adapter.js';

/** Collect a fresh, read-only Native Dashboard projection when this project enables Native. */
export async function collectNativeDashboardProjection(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<NativeDashboardProjection | null> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  if (!config) return null;
  const paths = await nativeProjectPaths(root, config.native.artifact_root);
  const statuses = [];
  let statusCursor: string | null = null;
  let totalStatusCount: number | undefined;
  do {
    const page = await listNativeStatusPage(paths, { cursor: statusCursor });
    totalStatusCount ??= page.total;
    if (page.total !== totalStatusCount) {
      throw new Error('Native status total changed during Dashboard pagination');
    }
    statuses.push(...page.items.slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges - statuses.length));
    statusCursor = page.nextCursor;
  } while (statusCursor !== null && statuses.length < NATIVE_DASHBOARD_LIMITS.maxChanges);
  const preflightEntries = await Promise.all(
    statuses.map(async (status) => {
      if (status.phase === 'invalid' || status.revision === null) {
        return [status.name, null] as const;
      }
      try {
        return [
          status.name,
          await inspectNativeArchivePreflight({ paths, name: status.name, now: options.now }),
        ] as const;
      } catch {
        return [status.name, null] as const;
      }
    }),
  );
  const conflictRadar = await inspectNativeConflictRadar(paths).catch(() => null);
  return adaptNativeDashboardProjection({
    generatedAt: (options.now ?? new Date()).toISOString(),
    statuses,
    preflights: Object.fromEntries(preflightEntries),
    conflictRadar,
    omittedSourceChangeCount: Math.max(0, (totalStatusCount ?? 0) - statuses.length),
  });
}
