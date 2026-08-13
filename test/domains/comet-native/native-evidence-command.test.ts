import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { nativeEvidenceCommand } from '../../../domains/comet-native/native-evidence-command.js';

const acceptanceId = `acceptance-${'a'.repeat(64)}`;

describe('Native evidence command', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('formats canonical evidence entries from a file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-evidence-command-'));
    roots.push(root);
    const file = path.join(root, 'entries.json');
    await fs.writeFile(
      file,
      JSON.stringify([
        {
          acceptance_id: acceptanceId,
          status: 'passed',
          evidence_refs: [`runtime/evidence/receipts/${'b'.repeat(64)}.json`],
        },
      ]),
    );

    await expect(nativeEvidenceCommand(['format', '--entries', file], root)).resolves.toMatchObject(
      {
        command: 'evidence format',
        exitCode: 0,
        data: { block: expect.stringContaining(acceptanceId) },
      },
    );
  });

  it.each([
    ['not-json', 'valid JSON'],
    ['{}', 'JSON array'],
  ])('rejects %s evidence input', async (contents, message) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-evidence-command-'));
    roots.push(root);
    const file = path.join(root, 'entries.json');
    await fs.writeFile(file, contents);

    await expect(nativeEvidenceCommand(['format', '--entries', file], root)).rejects.toThrow(
      message,
    );
  });

  it('rejects unknown subcommands and unexpected arguments', async () => {
    await expect(nativeEvidenceCommand(['unknown'], 'project')).rejects.toThrow(
      'Unknown evidence command',
    );
    await expect(
      nativeEvidenceCommand(['format', '--entries', 'a', 'extra'], 'project'),
    ).rejects.toThrow('Unexpected argument');
  });
});
