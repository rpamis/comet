import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { importClassicLegacyRuntimeData } from '../../../domains/comet-classic/classic-legacy-runtime-import.js';
import { readClassicDelivery } from '../../../domains/comet-classic/classic-progress.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(location: 'project-local' | 'git-common' = 'project-local') {
  const frozen = JSON.parse(
    await fs.readFile(
      path.resolve('test/fixtures/classic-052-legacy-delivery-receipts', location + '.json'),
      'utf8',
    ),
  );
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-legacy-receipt-business-')),
    root = path.join(temporary, 'project');
  roots.push(temporary);
  await fs.mkdir(root);
  vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'data'));
  for (const file of frozen.materials) {
    const target = path.resolve(root, file.ref);
    expect(target.startsWith(root + path.sep)).toBe(true);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(file.bytesBase64, 'base64'));
  }
  const change = path.join(root, 'openspec/changes/demo'),
    source = path.join(root, frozen.receiptRef),
    receiptBytes = await fs.readFile(source),
    receipt = JSON.parse(receiptBytes.toString('utf8')),
    ref = 'classic-delivery-receipts/' + path.basename(source),
    target = path.join(resolveWorkspaceRuntimeRootSync(root), ref);
  return { temporary, root, change, source, receiptBytes, receipt, ref, target };
}

it.each(['project-local', 'git-common'] as const)(
  'explicitly imports the original published Classic %s delivery receipt without changing its authorization',
  async (location) => {
    const f = await fixture(location),
      before = await readClassicDelivery(f.root, f.change, { evidence: false }),
      authorization = await fs.readFile(path.join(f.change, '.comet/delivery.json')),
      head =
        location === 'git-common'
          ? await fs.readFile(path.join(f.root, '.git/refs/heads/main'))
          : null;
    expect(before.verification.status).toBe('needsVerification');
    expect(await importClassicLegacyRuntimeData(f.root)).toContain(f.ref);
    const after = await readClassicDelivery(f.root, f.change, { evidence: false });
    expect(after.verification.status).toBe('complete');
    expect(after.delivery).toMatchObject({
      changeIdentity: f.receipt.changeIdentity,
      authorizationId: f.receipt.authorizationId,
      ...(f.receipt.commit ? { commit: f.receipt.commit } : {}),
    });
    expect(await fs.readFile(f.source)).toEqual(f.receiptBytes);
    expect(await fs.readFile(f.target)).toEqual(f.receiptBytes);
    expect(await fs.readFile(path.join(f.change, '.comet/delivery.json'))).toEqual(authorization);
    if (head) expect(await fs.readFile(path.join(f.root, '.git/refs/heads/main'))).toEqual(head);
    expect(await importClassicLegacyRuntimeData(f.root)).toEqual([]);
    expect(await readClassicDelivery(f.root, f.change, { evidence: false })).toEqual(after);
  },
);

it.each(['identity', 'authorization', 'unknown-field', 'schema'] as const)(
  'rejects a legacy Classic receipt with %s drift before publishing it',
  async (damage) => {
    const f = await fixture(),
      invalid = { ...f.receipt };
    if (damage === 'identity') invalid.changeIdentity = 'run:another';
    else if (damage === 'authorization') invalid.authorizationId = 'another-approval';
    else if (damage === 'unknown-field') invalid.unexpected = true;
    else invalid.schemaVersion = 99;
    const bytes = JSON.stringify(invalid);
    await fs.writeFile(f.source, bytes);
    const authorization = await fs.readFile(path.join(f.change, '.comet/delivery.json'));
    await expect(importClassicLegacyRuntimeData(f.root)).rejects.toThrow();
    await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(f.source, 'utf8')).toBe(bytes);
    expect(await fs.readFile(path.join(f.change, '.comet/delivery.json'))).toEqual(authorization);
    expect(
      (await readClassicDelivery(f.root, f.change, { evidence: false })).verification.status,
    ).toBe('needsVerification');
  },
);

it('rejects a legacy Classic receipt that conflicts with the authorized commit before importing it', async () => {
  const f = await fixture('git-common');
  // SIMULATED sealed-evidence conflict; retain the published identity and authorization ID.
  const authorizationFile = path.join(f.change, '.comet/delivery.json');
  const sealed = JSON.parse(await fs.readFile(authorizationFile, 'utf8'));
  await fs.writeFile(authorizationFile, JSON.stringify({ ...sealed, commit: f.receipt.commit }));
  const invalid = JSON.stringify({ ...f.receipt, commit: 'a'.repeat(40) });
  await fs.writeFile(f.source, invalid);
  const authorization = await fs.readFile(authorizationFile);
  const head = await fs.readFile(path.join(f.root, '.git/refs/heads/main'));
  await expect(importClassicLegacyRuntimeData(f.root)).rejects.toThrow(
    'Classic delivery receipt conflicts with authorization evidence',
  );
  await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(f.source, 'utf8')).toBe(invalid);
  expect(await fs.readFile(path.join(f.change, '.comet/delivery.json'))).toEqual(authorization);
  expect(await fs.readFile(path.join(f.root, '.git/refs/heads/main'))).toEqual(head);
});

it('rejects conflicting original Classic receipt locations before importing either', async () => {
  const f = await fixture('git-common'),
    other = path.join(f.root, '.comet/classic-deliveries', path.basename(f.source)),
    different = JSON.stringify({ ...f.receipt, archiveCompleted: !f.receipt.archiveCompleted });
  await fs.mkdir(path.dirname(other), { recursive: true });
  await fs.writeFile(other, different);
  await expect(importClassicLegacyRuntimeData(f.root)).rejects.toThrow(
    'Conflicting legacy Classic delivery receipts',
  );
  await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(other, 'utf8')).toBe(different);
  expect(await fs.readFile(f.source)).toEqual(f.receiptBytes);
});

it('keeps an authoritative current Classic receipt without replacing it from an old location', async () => {
  const f = await fixture(),
    current = JSON.stringify({ ...f.receipt, archiveCompleted: true });
  await fs.mkdir(path.dirname(f.target), { recursive: true });
  await fs.writeFile(f.target, current);
  const invalid = '{"unreadable":';
  await fs.writeFile(f.source, invalid);
  expect(await importClassicLegacyRuntimeData(f.root)).toEqual([]);
  expect(await fs.readFile(f.target, 'utf8')).toBe(current);
  expect(await fs.readFile(f.source, 'utf8')).toBe(invalid);
  expect(
    (await readClassicDelivery(f.root, f.change, { evidence: false })).verification.status,
  ).toBe('complete');
});

it('rejects a linked old Classic receipt directory without copying or changing its target', async () => {
  const f = await fixture(),
    directory = path.dirname(f.source),
    external = path.join(f.temporary, 'external'),
    file = path.join(external, path.basename(f.source));
  await fs.mkdir(external);
  await fs.writeFile(file, f.receiptBytes);
  await fs.rename(directory, directory + '-original');
  await fs.symlink(external, directory, 'junction');
  await expect(importClassicLegacyRuntimeData(f.root)).rejects.toThrow(/symbolic|junction|link/i);
  expect(await fs.readFile(file)).toEqual(f.receiptBytes);
  await expect(fs.access(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
});
