import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  writeProjectConfig,
  defaultProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { createNativeArchiveTransactionV2 } from '../../domains/comet-native/native-archive-transaction.js';
import { nativeChangeRuntimeDir } from '../../domains/comet-native/native-paths.js';
import { writeNativeWorkspaceIdentity } from '../../domains/comet-native/native-workspace.js';
import type {
  NativeProjectPaths,
  NativeChangeState,
} from '../../domains/comet-native/native-types.js';
import type { NativeArchiveTransactionJournalV2 } from '../../domains/comet-native/native-transaction.js';
interface FileBytes {
  ref: string;
  bytesBase64: string;
}
export interface FrozenNativeArchive {
  state: NativeChangeState;
  journal: NativeArchiveTransactionJournalV2;
  nativeDirectories: string[];
  nativeFiles: FileBytes[];
  changeRuntimeFiles: FileBytes[];
  transactionFiles: FileBytes[];
  provenance: Record<string, unknown>;
}
/** 加载真实发布数据，不重新生成旧预检、检查收据或执行计划。 */
export async function loadPreparedNativeArchive(
  paths: NativeProjectPaths,
  variant: 'replace-create' | 'remove' | 'no-spec' | 'all-spec',
  options?: { createTransaction?: boolean },
) {
  const fixture = JSON.parse(
    await fs.readFile(
      path.resolve('test/fixtures/native-052-archive-transactions', variant + '.json'),
      'utf8',
    ),
  ) as FrozenNativeArchive;
  await writeProjectConfig(paths.projectRoot, defaultProjectConfig(paths.artifactRootRef, 'en'));
  const materialize = async (root: string, files: FileBytes[]) => {
    for (const file of files) {
      const target = path.join(root, ...file.ref.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(file.bytesBase64, 'base64'));
    }
  };
  for (const ref of fixture.nativeDirectories)
    await fs.mkdir(path.join(paths.nativeRoot, ...ref.split('/')), { recursive: true });
  await materialize(paths.nativeRoot, fixture.nativeFiles);
  await materialize(
    nativeChangeRuntimeDir(paths, fixture.state.name),
    fixture.changeRuntimeFiles.filter(
      (f) =>
        f.ref === 'run-state.json' ||
        f.ref === 'trajectory.jsonl' ||
        f.ref.startsWith('checkpoints/'),
    ),
  );
  await writeNativeWorkspaceIdentity({
    paths,
    name: fixture.state.name,
    revision: fixture.state.revision,
  });
  await materialize(
    path.join(paths.transactionsDir, fixture.journal.id),
    fixture.transactionFiles.filter((f) => f.ref.startsWith('staged/')),
  );
  if (options?.createTransaction !== false)
    await createNativeArchiveTransactionV2(paths, fixture.journal);
  return fixture;
}
