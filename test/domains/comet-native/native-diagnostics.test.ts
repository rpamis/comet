import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  inspectNativeStatus,
  listNativeStatus,
} from '../../../domains/comet-native/native-diagnostics.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

const brief = `# Outcome
Ship a focused outcome.
# Scope
One capability.
# Non-goals
No migration.
# Acceptance examples
- The behavior works.
# Constraints and invariants
Keep compatibility.
# Decisions
Use Native state.
# Open questions
None.
# Verification expectations
Run focused checks.
`;

const verification = `# Acceptance evidence
Acceptance passed.
# Commands and results
Tests passed.
# Skipped checks
None.
# Spec consistency
Consistent.
# Known limitations and risks
None.
# Conclusion
Pass.
`;

describe('Native status diagnostics', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function validChange(name: string): Promise<void> {
    const state = await createNativeChange({ paths, name, language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, name), state.brief), brief);
  }

  it('returns an empty projection for an empty Native root', async () => {
    expect(await listNativeStatus(paths)).toEqual([]);
  });

  it('sorts multiple active changes and projects only Native next commands', async () => {
    await validChange('zeta-change');
    await validChange('alpha-change');
    await selectNativeChange(paths, 'zeta-change');

    const statuses = await listNativeStatus(paths);
    expect(statuses.map((status) => status.name)).toEqual(['alpha-change', 'zeta-change']);
    expect(statuses[0]).toMatchObject({
      phase: 'shape',
      selected: false,
      nextCommand: 'comet native next alpha-change',
    });
    expect(statuses[1]).toMatchObject({ selected: true });
    expect(JSON.stringify(statuses)).not.toMatch(/openspec|superpowers|comet classic/iu);
  });

  it('reports malformed change YAML without hiding the other changes', async () => {
    await validChange('healthy-change');
    const broken = path.join(paths.changesDir, 'broken-change');
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, 'change.yaml'), 'schema: [invalid\n');

    const statuses = await listNativeStatus(paths);
    expect(statuses).toHaveLength(2);
    expect(statuses.find((status) => status.name === 'broken-change')).toMatchObject({
      phase: 'invalid',
      nextCommand: null,
      archiveReady: false,
    });
  });

  it('only marks Archive ready after brief, spec, and verification checks pass', async () => {
    await validChange('ready-change');
    const changeDir = nativeChangeDir(paths, 'ready-change');
    await fs.writeFile(path.join(changeDir, 'verification.md'), verification);
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'ready-change'),
    );
    await writeNativeChange(paths, {
      ...state,
      phase: 'archive',
      verification_result: 'pass',
      verification_report: 'verification.md',
    });

    expect(await inspectNativeStatus(paths, 'ready-change')).toMatchObject({
      archiveReady: true,
      nextCommand: 'comet native archive ready-change',
    });
    await fs.rm(path.join(changeDir, 'verification.md'));
    expect(await inspectNativeStatus(paths, 'ready-change')).toMatchObject({
      archiveReady: false,
      nextCommand: null,
    });
  });

  it('never scans a fixture openspec tree', async () => {
    await validChange('native-only');
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'foreign-change'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'foreign-change', 'change.yaml'),
      'not: native\n',
    );
    expect((await listNativeStatus(paths)).map((status) => status.name)).toEqual(['native-only']);
  });
});
