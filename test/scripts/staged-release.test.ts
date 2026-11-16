import { describe, expect, it, vi } from 'vitest';
import {
  publishPackages,
  resolveReleaseSource,
  validateStageReceipt,
} from '../../scripts/release/publish-release.mjs';

const names = ['@rpamis/comet', '@rpamis/comet-codex-plugin', 'comet-dsh-plugin'];
const packages = names.map((name, i) => ({ name, tarball: `/packages/${i}.tgz` }));
const head = 'a'.repeat(40);
const receipt = () => ({
  schema: 'comet.release-stage.v1',
  version: '0.5.4',
  head,
  runId: '42',
  body: 'release notes',
  packages: [],
});

describe('staged release', () => {
  const options = { version: '0.5.4', head, directory: '/downloads', action: 'stage' };
  function services() {
    return {
      request: vi.fn(async () => null),
      runNpm: vi.fn(async (args: string[]) => {
        const item = packages.find((item) => item.tarball === args[2])!;
        return JSON.stringify({ name: item.name, version: '0.5.4', stageId: `stage-${item.name}` });
      }),
      save: vi.fn(),
    };
  }

  it('stages all three packages without direct publishing, approval or public downloads', async () => {
    const io = services();
    const saved = receipt();
    const result = await publishPackages(packages, { ...options, receipt: saved }, io);
    expect(result.map((item) => item.status)).toEqual(['staged', 'staged', 'staged']);
    expect(io.runNpm.mock.calls.map(([args]) => args.slice(0, 3))).toEqual([
      ['stage', 'publish', '/packages/0.tgz'],
      ['stage', 'publish', '/packages/1.tgz'],
      ['stage', 'publish', '/packages/2.tgz'],
    ]);
    expect(saved.packages).toHaveLength(3);
    expect(io.save).toHaveBeenCalled();
  });

  it('restores recorded stage IDs without resubmitting packages awaiting approval', async () => {
    const io = services();
    const saved = {
      ...receipt(),
      packages: names.map((name) => ({ name, status: 'staged', stageId: `id-${name}` })),
    };
    await publishPackages(packages, { ...options, receipt: saved }, io);
    expect(io.runNpm).not.toHaveBeenCalled();
  });

  it('preserves completed stages and stops on unknown upload results without retrying', async () => {
    const io = services();
    io.runNpm.mockRejectedValueOnce(new Error('connection lost'));
    const saved = receipt();
    await expect(publishPackages(packages, { ...options, receipt: saved }, io)).rejects.toThrow(
      'connection lost',
    );
    expect(io.runNpm).toHaveBeenCalledTimes(1);
    expect(saved.packages).toEqual([{ name: names[0], status: 'submitting' }]);
    await expect(publishPackages(packages, { ...options, receipt: saved }, io)).rejects.toThrow(
      'unknown',
    );
    expect(io.runNpm).toHaveBeenCalledTimes(1);
  });

  it('does not treat dry-run output without a stage ID as a successful submission', async () => {
    const io = services();
    io.runNpm.mockResolvedValueOnce(JSON.stringify({ name: names[0], version: '0.5.4' }));
    await expect(publishPackages(packages, { ...options, receipt: receipt() }, io)).rejects.toThrow(
      'stageId',
    );
  });

  it('requires every package to be public before finalize performs any download', async () => {
    const io = services();
    io.request.mockImplementation(async (url: string) =>
      url.includes('codex') ? null : ({ version: '0.5.4', gitHead: head } as never),
    );
    await expect(publishPackages(packages, { ...options, action: 'finalize' }, io)).rejects.toThrow(
      'npm approval',
    );
    expect(io.runNpm).not.toHaveBeenCalled();
  });

  it('finalize only pulls approved versions and never calls stage, publish or approve', async () => {
    const io = services();
    io.request.mockResolvedValue({ version: '0.5.4', gitHead: head } as never);
    io.runNpm.mockImplementation(async (args: string[]) =>
      JSON.stringify([{ name: args[1].slice(0, args[1].lastIndexOf('@')), version: '0.5.4' }]),
    );
    const result = await publishPackages(packages, { ...options, action: 'finalize' }, io);
    expect(result.every((item) => item.status === 'verified')).toBe(true);
    expect(io.runNpm.mock.calls.every(([args]) => args[0] === 'pack')).toBe(true);
  });

  it('rejects receipts from another source, version or run', () => {
    for (const invalid of [
      { ...receipt(), head: 'other' },
      { ...receipt(), version: '0.5.3' },
      { ...receipt(), runId: '43' },
    ]) {
      expect(() =>
        validateStageReceipt(invalid, { version: '0.5.4', head, runId: '42' }),
      ).toThrow();
    }
  });
});

describe('release source selection', () => {
  const env = { GITHUB_SHA: head };
  const run = {
    head_sha: 'b'.repeat(40),
    head_branch: 'master',
    event: 'workflow_dispatch',
    path: '.github/workflows/release.yml',
    repository: { full_name: 'rpamis/comet' },
  };

  it('uses the current commit for staging without querying or waiting for master CI', async () => {
    const request = vi.fn();
    expect(await resolveReleaseSource({ action: 'stage', env }, { request })).toBe(head);
    expect(request).not.toHaveBeenCalled();
  });

  it('pins finalization to the original release run after master advances', async () => {
    const request = vi.fn().mockResolvedValue(run);
    expect(
      await resolveReleaseSource({ action: 'finalize', sourceRunId: '42', env }, { request }),
    ).toBe(run.head_sha);
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/actions/runs/42'));
  });

  it.each([
    { ...run, head_branch: '054' },
    { ...run, event: 'pull_request' },
    { ...run, path: '.github/workflows/ci.yml' },
    { ...run, repository: { full_name: 'other/comet' } },
  ])('rejects an unrelated source run', async (result) => {
    await expect(
      resolveReleaseSource(
        { action: 'finalize', sourceRunId: '42', env },
        { request: async () => result },
      ),
    ).rejects.toThrow('source run');
  });
});
