import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectNativeContractFiles } from '../../../domains/comet-native/native-contract-files.js';

const brief = `# Outcome
Ship sessions.

# Acceptance examples
- Valid login creates a session.
`;

const spec = `## Requirement: Sessions
### Scenario: Expiry
- **WHEN** a session expires
- **THEN** access is rejected
`;

describe('Native contract file collector', () => {
  let changeDir: string;

  beforeEach(async () => {
    changeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-contract-files-'));
    await fs.mkdir(path.join(changeDir, 'specs', 'sessions'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await fs.writeFile(path.join(changeDir, 'specs', 'sessions', 'spec.md'), spec);
  });

  afterEach(async () => {
    await fs.rm(changeDir, { recursive: true, force: true });
  });

  it('collects a deterministic contract without returning source contents', async () => {
    const collected = await collectNativeContractFiles({
      changeDir,
      briefRef: 'brief.md',
      specChanges: [
        {
          capability: 'sessions',
          operation: 'create',
          source: 'specs/sessions/spec.md',
          base_hash: null,
        },
      ],
    });

    expect(collected).toMatchObject({ sourceCount: 2, totalBytes: brief.length + spec.length });
    expect(collected.contract.acceptance).toHaveLength(2);
    expect(collected.contract.contractHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(collected)).not.toContain('Ship sessions');
  });

  it('binds remove operations without reading a proposed source', async () => {
    const collected = await collectNativeContractFiles({
      changeDir,
      briefRef: 'brief.md',
      specChanges: [
        {
          capability: 'legacy-sessions',
          operation: 'remove',
          base_hash: 'a'.repeat(64),
        },
      ],
    });

    expect(collected.sourceCount).toBe(1);
    expect(collected.contract.specs[0]).toMatchObject({
      operation: 'remove',
      source: null,
      contentHash: null,
    });
  });

  it('rejects sensitive sources and total-byte overflow', async () => {
    await fs.writeFile(path.join(changeDir, '.npmrc'), 'token=secret');
    await expect(
      collectNativeContractFiles({
        changeDir,
        briefRef: '.npmrc',
        specChanges: [],
      }),
    ).rejects.toThrow('sensitive');

    const largeSpecs = [];
    for (let index = 0; index < 5; index += 1) {
      const capability = `large-${index}`;
      const source = `specs/${capability}/spec.md`;
      await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
      await fs.writeFile(
        path.join(changeDir, ...source.split('/')),
        `# Notes\n${'x'.repeat(900_000)}`,
      );
      largeSpecs.push({ capability, operation: 'create' as const, source, base_hash: null });
    }
    await expect(
      collectNativeContractFiles({
        changeDir,
        briefRef: 'brief.md',
        specChanges: largeSpecs,
      }),
    ).rejects.toThrow(/exceeds/iu);
  });
});
