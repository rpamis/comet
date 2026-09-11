import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { nativeNewCommand } from '../../../domains/comet-native/native-new-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Native capability association during change creation', () => {
  it('validates an explicit capability and writes a revocable association draft', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-capability-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.git'));
    await fs.mkdir(path.join(root, 'docs', 'comet', 'specs', 'authentication'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, 'docs', 'comet', 'specs', 'authentication', 'spec.md'),
      '# Authentication\n',
      'utf8',
    );

    const result = await nativeNewCommand(['extend-auth', '--capability', 'authentication'], root);
    expect(result.exitCode).toBe(0);
    const data = result.data as {
      capabilityDiscovery?: { associationDraft?: { status: string; capability: string } };
      associationPath?: string;
      deltaProposal?: { specSource: string; deltaSource: string; baseHash: string };
    };
    expect(data.capabilityDiscovery?.associationDraft).toMatchObject({
      status: 'explicit',
      capability: 'authentication',
    });
    expect(data.associationPath).toBeDefined();
    await expect(fs.readFile(data.associationPath!, 'utf8')).resolves.toContain(
      'schema: comet.capability-association.v1',
    );
    expect(data.deltaProposal).toMatchObject({
      specSource: 'specs/authentication/spec.md',
      deltaSource: 'specs/authentication/delta.yaml',
    });
    expect(data.deltaProposal?.baseHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      fs.readFile(
        path.join(
          root,
          'docs',
          'comet',
          'changes',
          'extend-auth',
          'specs',
          'authentication',
          'spec.md',
        ),
        'utf8',
      ),
    ).resolves.toBe('# Authentication\n');
    await expect(
      fs.readFile(
        path.join(
          root,
          'docs',
          'comet',
          'changes',
          'extend-auth',
          'specs',
          'authentication',
          'delta.yaml',
        ),
        'utf8',
      ),
    ).resolves.toMatch(/schema: comet\.native\.delta\.v1[\s\S]*operations: \[\]/);
  });

  it('honors the configured Remote Project Knowledge provider instead of scanning local Specs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-capability-remote-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.git'));
    await fs.mkdir(path.join(root, 'docs', 'comet', 'specs', 'authentication'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, 'docs', 'comet', 'specs', 'authentication', 'spec.md'),
      '# Authentication\n\n## Requirement: authentication.login Login security\n\nLogin security behavior.\n',
      'utf8',
    );
    await writeProjectConfig(root, {
      ...defaultProjectConfig('docs', 'en'),
      knowledge: {
        provider: 'remote',
        remote: { endpoint: 'http://127.0.0.1:1/knowledge', timeout_ms: 100 },
      },
    });

    const result = await nativeNewCommand(
      ['extend-auth', '--task', 'Improve login security'],
      root,
    );
    expect(result.exitCode).toBe(0);
    expect(
      (result.data as { capabilityDiscovery?: { associationDraft?: unknown } }).capabilityDiscovery
        ?.associationDraft,
    ).toBeNull();
  });

  it('reuses a bounded discovery result for the same task and Spec sources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-capability-cache-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.git'));
    await fs.mkdir(path.join(root, 'docs', 'comet', 'specs', 'authentication'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, 'docs', 'comet', 'specs', 'authentication', 'spec.md'),
      '# Authentication\n\n## Requirement: authentication.login Login security\n\nLogin security behavior.\n',
      'utf8',
    );

    const task = 'Improve authentication login security';
    const first = await nativeNewCommand(['extend-auth', '--task', task], root);
    expect(first.exitCode).toBe(0);
    const cache = path.join(root, '.comet', 'runtime', 'native', 'capability-discovery-cache.json');
    await expect(fs.readFile(cache, 'utf8')).resolves.toContain('comet.native.capability-cache.v1');

    const firstMtime = (await fs.stat(cache)).mtimeMs;
    await fs.rm(path.join(root, 'docs', 'comet', 'changes', 'extend-auth'), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(root, '.comet', 'runtime', 'native', 'changes', 'extend-auth'), {
      recursive: true,
      force: true,
    });
    const second = await nativeNewCommand(['extend-auth-again', '--task', task], root);
    expect(second.exitCode).toBe(0);
    expect(
      (second.data as { capabilityDiscovery?: { associationDraft?: unknown } }).capabilityDiscovery
        ?.associationDraft,
    ).toBeDefined();
    expect((await fs.stat(cache)).mtimeMs).toBe(firstMtime);
  });

  it('invalidates task discovery when content changes without a metadata change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-capability-content-cache-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.git'));
    const source = path.join(root, 'docs', 'comet', 'specs', 'authentication', 'spec.md');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(
      source,
      '# Authentication\n\n## Requirement: authentication.login Login security\n\nLogin security behavior.\n',
      'utf8',
    );

    const task = 'Improve login security';
    const first = await nativeNewCommand(['extend-auth', '--task', task], root);
    expect(first.exitCode).toBe(0);
    const originalStat = await fs.stat(source);
    await fs.writeFile(
      source,
      '# Billing\n\n## Requirement: billing.invoice Invoice processing\n\nInvoice processing behavior.\n',
      'utf8',
    );
    await fs.utimes(source, originalStat.atime, originalStat.mtime);
    await fs.rm(path.join(root, 'docs', 'comet', 'changes', 'extend-auth'), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(root, '.comet', 'runtime', 'native', 'changes', 'extend-auth'), {
      recursive: true,
      force: true,
    });

    const second = await nativeNewCommand(['extend-auth-again', '--task', task], root);
    expect(second.exitCode).toBe(0);
    expect(
      (second.data as { capabilityDiscovery?: { associationDraft?: unknown } }).capabilityDiscovery
        ?.associationDraft,
    ).toBeNull();
  });
});
