import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  recordFailedMigrationRepair,
  recallFailedMigrationRepair,
  resolveWorkspaceRuntimeRoot,
} from '../../../domains/workflow-contract/workspace-runtime.js';
import { resolveWorkspaceRuntimeLocation } from '../../../platform/paths/workspace-runtime.js';

describe('migration repair failure memoization', () => {
  let projectRoot: string;
  let source: string;
  let location: ReturnType<typeof resolveWorkspaceRuntimeLocation>;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-repair-memo-'));
    source = path.join(projectRoot, '.comet', 'runtime');
    await fs.mkdir(path.join(source, 'sdk-runs', 'native'), { recursive: true });
    await fs.writeFile(
      path.join(path.dirname(source), '.runtime.comet-runtime-migration.json'),
      JSON.stringify({ probe: true }),
    );
    await fs.writeFile(path.join(source, 'sdk-runs', 'native', 'checkpoint.json'), '{"a":1}');
    location = resolveWorkspaceRuntimeLocation(projectRoot);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(location.workspaceRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('recalls the recorded failure only while the source stays unchanged', async () => {
    await expect(recallFailedMigrationRepair(source, location)).resolves.toBeNull();

    await recordFailedMigrationRepair(source, location, new Error('boom: hazard found'));

    const recalled = await recallFailedMigrationRepair(source, location);
    expect(recalled).toBeInstanceOf(Error);
    expect(recalled!.message).toContain('boom: hazard found');
    expect(recalled!.message).toContain('源未变化');

    // 源内容变化（新增文件）后指纹失配，恢复完整流程。
    await fs.writeFile(path.join(source, 'sdk-runs', 'native', 'extra.json'), '{}');
    await expect(recallFailedMigrationRepair(source, location)).resolves.toBeNull();
  });

  it('does not recall when the journal itself disappears', async () => {
    await recordFailedMigrationRepair(source, location, new Error('boom'));
    await fs.rm(path.join(path.dirname(source), '.runtime.comet-runtime-migration.json'));
    await expect(recallFailedMigrationRepair(source, location)).resolves.toBeNull();
  });

  it('memoizes a real failed repair through resolveWorkspaceRuntimeRoot', async () => {
    const backup = path.join(
      path.dirname(source),
      '.runtime.comet-runtime-source-11111111-1111-4111-8111-111111111111',
    );
    const stage = path.join(
      path.dirname(location.runtimeRoot),
      '.runtime.comet-runtime-stage-11111111-1111-4111-8111-111111111111',
    );
    const journal = {
      fence: 'directory',
      journalSchema: 'comet.workspace-runtime-migration-journal.v1',
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: location.workspaceId,
      source,
      target: location.runtimeRoot,
      backup,
      stage,
      kind: 'directory',
      contentHash: '0'.repeat(64),
      sourceIdentity: 'x'.repeat(64),
      pid: 1,
      hostname: os.hostname(),
    };
    await fs.writeFile(journalPathOf(source), JSON.stringify(journal));

    await expect(resolveWorkspaceRuntimeRoot(projectRoot)).rejects.toThrow(/迁移/);

    const second = await resolveWorkspaceRuntimeRoot(projectRoot).catch((error: Error) => error);
    expect(second).toBeInstanceOf(Error);
    expect(second.message).toContain('源未变化');
  });
});

function journalPathOf(source: string): string {
  return path.join(path.dirname(source), `.${path.basename(source)}.comet-runtime-migration.json`);
}
