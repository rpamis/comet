import { createHash } from 'node:crypto';
import { promises as fs, type PathLike } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileRuntimeStore } from '../../../domains/engine/runtime-store.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime-json.js';
import { atomicWriteContainedText } from '../../../domains/workflow-contract/contained-atomic-write.js';
import { requireFileSymlink } from '../../helpers/file-symlink.js';

interface RecordValue {
  runId: string;
  revision: number;
  state: { message: string };
}
const runId = 'legacy/run';
const hash = createHash('sha256').update(JSON.stringify(runId)).digest('hex');
const record = (revision: number, message = 'ready'): RecordValue => ({
  runId,
  revision,
  state: { message },
});
const revisionName = (revision: number) => `${String(revision).padStart(16, '0')}.json`;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('file RuntimeStore compaction and migration', () => {
  let rootDir: string;
  let original: string;
  let compact: string;
  let staged: string;
  let checkpoint: string;
  beforeEach(async () => {
    rootDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-store-compact-')));
    original = path.join(rootDir, hash);
    compact = path.join(rootDir, '.runtime-store-v2', hash);
    staged = path.join(compact, 'legacy');
    checkpoint = path.join(compact, 'checkpoint.json');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const store = () => createFileRuntimeStore<RecordValue>({ rootDir });
  async function legacy(count: number, message = 'ready') {
    await fs.mkdir(original);
    for (let revision = 1; revision <= count; revision += 1) {
      await fs.writeFile(
        path.join(original, revisionName(revision)),
        JSON.stringify(record(revision, message)),
      );
    }
  }

  it('reads legacy history without creating locks, fencing paths or modifying its files', async () => {
    await legacy(5);
    const before = await fs.readdir(original);
    expect(await store().read(runId)).toEqual(record(5));
    expect(await fs.readdir(rootDir)).toEqual([hash]);
    expect(await fs.readdir(original)).toEqual(before);
  });

  it('bounds committed files and disk use while retaining the complete latest aggregate', async () => {
    const message = 'x'.repeat(64 * 1024);
    await legacy(128, message);
    const legacyBytes = (
      await Promise.all(
        (await fs.readdir(original)).map(
          async (name) => (await fs.stat(path.join(original, name))).size,
        ),
      )
    ).reduce((a, b) => a + b, 0);
    const current = store();
    for (let revision = 129; revision <= 200; revision += 1) {
      expect(await current.compareAndSwap(runId, revision - 1, record(revision, message))).toBe(
        true,
      );
    }
    expect(await store().read(runId)).toEqual(record(200, message));
    expect((await fs.lstat(original)).isFile()).toBe(true);
    expect(JSON.parse(await fs.readFile(original, 'utf8'))).toEqual({
      schema: 'comet.runtime-store-format.v2',
      runId,
      state: 'ready',
    });
    expect((await fs.readdir(compact)).sort()).toEqual([
      '.write.lock.contenders',
      'checkpoint.json',
    ]);
    expect(await fs.readdir(path.join(compact, '.write.lock.contenders'))).toEqual([]);
    const compactBytes = (await fs.stat(checkpoint)).size + (await fs.stat(original)).size;
    expect(compactBytes).toBeLessThan(legacyBytes / 100);
    expect(await current.compareAndSwap(runId, 1, record(2, 'stale'))).toBe(false);
    await expect(fs.mkdir(original, { recursive: true })).rejects.toThrow();
  }, 30_000);

  it.each(['gap', 'json', 'runId', 'revision'])(
    'validates all legacy snapshots before moving or deleting %s corruption',
    async (damage) => {
      await legacy(4);
      const damaged = path.join(original, revisionName(2));
      if (damage === 'gap') await fs.unlink(damaged);
      else
        await fs.writeFile(
          damaged,
          damage === 'json'
            ? '{broken'
            : JSON.stringify({ ...record(2), [damage]: damage === 'runId' ? 'wrong' : 50 }),
        );
      const before = await fs.readdir(original);
      await expect(store().compareAndSwap(runId, 4, record(5))).rejects.toThrow(/STORE_/u);
      expect((await fs.lstat(original)).isDirectory()).toBe(true);
      expect(await fs.readdir(original)).toEqual(before);
      await expect(fs.stat(checkpoint)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each([1, 2])(
    'migrates a legacy restored baseline in slot %s with mirrored revisions',
    async (slot) => {
      await fs.mkdir(original);
      const saved = { ...record(40), run: { revision: 40 } };
      if (slot === 2)
        await fs.writeFile(
          path.join(original, revisionName(1)),
          JSON.stringify({ ...saved, revision: 1, run: { revision: 1 } }),
        );
      await fs.writeFile(
        path.join(original, revisionName(slot)),
        JSON.stringify({
          schema: 'comet.runtime-store-checkpoint.v1',
          record: saved,
          hash: hashRuntimeValue(saved),
        }),
      );
      const current = createFileRuntimeStore<typeof saved>({
        rootDir,
        mirroredRevisionPaths: ['run.revision'],
      });
      expect(await current.read(runId)).toEqual(saved);
      const next = { ...saved, revision: 41, run: { revision: 41 } };
      expect(await current.compareAndSwap(runId, 40, next)).toBe(true);
      expect(await current.read(runId)).toEqual(next);
      expect(JSON.parse(await fs.readFile(checkpoint, 'utf8')).legacyRevision).toBe(40);
    },
  );

  it('has one CAS winner when multiple instances migrate the same legacy run', async () => {
    await legacy(3);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        store().compareAndSwap(runId, 3, record(4, String(index))),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store().read(runId))?.revision).toBe(4);
    expect((await fs.lstat(original)).isFile()).toBe(true);
  });

  it.each(['before-legacy-inspection', 'before-stage-inspection'])(
    'does not return null when migration starts %s',
    async (when) => {
      await legacy(1);
      const lstat = fs.lstat.bind(fs);
      let originalReads = 0;
      let moved = false;
      const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
        if (String(args[0]) === original) originalReads += 1;
        const boundary =
          when === 'before-legacy-inspection'
            ? String(args[0]) === original && originalReads === 2
            : String(args[0]) === path.join(rootDir, '.runtime-store-v2');
        if (!moved && boundary) {
          moved = true;
          await fs.mkdir(compact, { recursive: true });
          await fs.rename(original, staged);
        }
        return lstat(...args);
      });
      expect(await store().read(runId)).toEqual(record(1));
      spy.mockRestore();
      expect(moved).toBe(true);
      expect(await store().compareAndSwap(runId, 1, record(2))).toBe(true);
    },
  );

  it('resumes a crash after moving the legacy directory but before publishing its fence', async () => {
    await legacy(3);
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      await rename(...args);
      if (String(args[0]) === original) throw new Error('migration interrupted');
    });
    await expect(store().compareAndSwap(runId, 3, record(4))).rejects.toThrow(/interrupted/u);
    spy.mockRestore();
    expect(await store().read(runId)).toEqual(record(3));
    expect(await store().compareAndSwap(runId, 3, record(4))).toBe(true);
    expect(await store().read(runId)).toEqual(record(4));
  });

  it.each([
    ['fence', 'before'],
    ['fence', 'after'],
    ['checkpoint', 'before'],
    ['checkpoint', 'after'],
    ['ready', 'before'],
    ['ready', 'after'],
  ])('recovers migration interrupted %s %s publication', async (stage, when) => {
    await legacy(3);
    const link = fs.link.bind(fs);
    const rename = fs.rename.bind(fs);
    let interrupted = false;
    async function inject(
      kind: string,
      args: [PathLike, PathLike],
      operation: () => Promise<void>,
    ) {
      const target = String(args[1]);
      const matches =
        !interrupted &&
        ((stage === 'fence' && kind === 'link' && target === original) ||
          (stage === 'checkpoint' && kind === 'link' && target === checkpoint) ||
          (stage === 'ready' && kind === 'rename' && target === original));
      if (matches) {
        interrupted = true;
        if (when === 'after') await operation();
        throw new Error('migration publication interrupted');
      }
      return operation();
    }
    const linkSpy = vi
      .spyOn(fs, 'link')
      .mockImplementation((...args) => inject('link', args, () => link(...args)));
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockImplementation((...args) => inject('rename', args, () => rename(...args)));
    await expect(store().compareAndSwap(runId, 3, record(4))).rejects.toThrow(/interrupted/u);
    linkSpy.mockRestore();
    renameSpy.mockRestore();
    expect(interrupted).toBe(true);
    expect(await store().read(runId)).toEqual(record(3));
    expect(await store().compareAndSwap(runId, 3, record(4))).toBe(true);
    expect(await store().read(runId)).toEqual(record(4));
  });

  it('fails closed if an old writer recreates the directory before its fence is published', async () => {
    await legacy(1);
    const link = fs.link.bind(fs);
    const spy = vi.spyOn(fs, 'link').mockImplementation(async (...args) => {
      if (String(args[1]) === original) {
        await fs.mkdir(original);
        await fs.writeFile(
          path.join(original, revisionName(2)),
          JSON.stringify(record(2, 'old writer')),
        );
      }
      return link(...args);
    });
    await expect(store().compareAndSwap(runId, 1, record(2))).rejects.toThrow(
      /STORE_MIGRATION_CONFLICT/u,
    );
    spy.mockRestore();
    expect(JSON.parse(await fs.readFile(path.join(staged, revisionName(1)), 'utf8'))).toEqual(
      record(1),
    );
    expect(JSON.parse(await fs.readFile(path.join(original, revisionName(2)), 'utf8'))).toEqual(
      record(2, 'old writer'),
    );
    await expect(store().read(runId)).rejects.toThrow(/STORE_MIGRATION_CONFLICT/u);
    await expect(fs.stat(checkpoint)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fences an old writer paused immediately before exclusive revision publication', async () => {
    await legacy(1);
    const reached = barrier();
    const resume = barrier();
    const link = fs.link.bind(fs);
    const oldTarget = path.join(original, revisionName(2));
    const spy = vi.spyOn(fs, 'link').mockImplementation(async (...args) => {
      if (String(args[1]) === oldTarget) {
        reached.release();
        await resume.promise;
      }
      return link(...args);
    });
    const oldWrite = atomicWriteContainedText(oldTarget, JSON.stringify(record(2, 'old writer')), {
      containedRoot: rootDir,
      exclusive: true,
      requireAtomicPublication: true,
    });
    const rejected = expect(oldWrite).rejects.toThrow();
    await reached.promise;
    expect(await store().compareAndSwap(runId, 1, record(2, 'new writer'))).toBe(true);
    resume.release();
    await rejected;
    spy.mockRestore();
    expect(await store().read(runId)).toEqual(record(2, 'new writer'));
    expect((await fs.lstat(original)).isFile()).toBe(true);
    expect(JSON.parse(await fs.readFile(original, 'utf8'))).toEqual({
      schema: 'comet.runtime-store-format.v2',
      runId,
      state: 'ready',
    });
    await expect(fs.stat(oldTarget)).rejects.toMatchObject({
      code: expect.stringMatching(/^(?:ENOENT|ENOTDIR)$/u),
    });
  });

  it('includes an old writer that commits after validation but before the directory move', async () => {
    await legacy(1);
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (String(args[0]) === original) {
        await atomicWriteContainedText(
          path.join(original, revisionName(2)),
          JSON.stringify(record(2, 'old winner')),
          {
            containedRoot: rootDir,
            exclusive: true,
            requireAtomicPublication: true,
          },
        );
      }
      return rename(...args);
    });
    expect(await store().compareAndSwap(runId, 1, record(2, 'new contender'))).toBe(false);
    spy.mockRestore();
    expect(await store().read(runId)).toEqual(record(2, 'old winner'));
    expect(await store().compareAndSwap(runId, 2, record(3))).toBe(true);
  });

  it('keeps committed authority readable after cleanup fails and resumes cleanup on the next write', async () => {
    await legacy(3);
    const unlink = fs.unlink.bind(fs);
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (...args) => {
      if (String(args[0]) === path.join(staged, revisionName(2)))
        throw new Error('cleanup interrupted');
      return unlink(...args);
    });
    expect(await store().compareAndSwap(runId, 3, record(4))).toBe(true);
    spy.mockRestore();
    expect(warn).toHaveBeenCalled();
    expect(await store().read(runId)).toEqual(record(4));
    expect(await store().compareAndSwap(runId, 4, record(5))).toBe(true);
    await expect(fs.stat(staged)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks authority instead of reporting a gap while a staged legacy history is being cleaned', async () => {
    await legacy(3);
    await fs.mkdir(compact, { recursive: true });
    await fs.rename(original, staged);
    await fs.writeFile(
      original,
      JSON.stringify({ schema: 'comet.runtime-store-format.v2', runId, state: 'pending' }),
    );
    const readdir = fs.readdir.bind(fs);
    let advance = true;
    const spy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      const entries = await readdir(...args);
      if (String(args[0]) === compact && advance) {
        advance = false;
        const latest = record(3);
        const payload = { record: latest, legacyRevision: 3 };
        await fs.writeFile(
          checkpoint,
          JSON.stringify({
            schema: 'comet.runtime-store-snapshot.v2',
            ...payload,
            hash: hashRuntimeValue(payload),
          }),
        );
        await fs.writeFile(
          original,
          JSON.stringify({ schema: 'comet.runtime-store-format.v2', runId, state: 'ready' }),
        );
        await fs.unlink(path.join(staged, revisionName(1)));
      }
      return entries;
    });
    expect(await store().read(runId)).toEqual(record(3));
    spy.mockRestore();
    expect(advance).toBe(false);
  });

  it('retries a reader overlapping an atomic checkpoint replacement', async () => {
    await store().compareAndSwap(runId, null, record(1));
    // 不同大小保证触发变更检查，不依赖 Windows 文件标识和时间戳是否区分两次发布。
    const replacement = record(2, 'replacement checkpoint with a different size');
    const open = fs.open.bind(fs);
    let replacing = false;
    let readerOpens = 0;
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === checkpoint && !replacing) {
        readerOpens += 1;
        if (readerOpens === 1) {
          // Replace after lstat but before open, without holding a Windows checkpoint handle.
          replacing = true;
          try {
            expect(await store().compareAndSwap(runId, 1, replacement)).toBe(true);
          } finally {
            replacing = false;
          }
        }
      }
      return open(...args);
    });
    try {
      expect(await store().read(runId)).toEqual(replacement);
      expect(readerOpens).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('never takes over a paused live writer and lets readers observe the prior complete snapshot', async () => {
    await store().compareAndSwap(runId, null, record(1));
    const reached = barrier();
    const resume = barrier();
    const rename = fs.rename.bind(fs);
    let pause = true;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (String(args[1]) === checkpoint && pause) {
        pause = false;
        reached.release();
        await resume.promise;
      }
      return rename(...args);
    });
    const first = store().compareAndSwap(runId, 1, record(2, 'first'));
    await reached.promise;
    let finished = false;
    const second = store()
      .compareAndSwap(runId, 1, record(2, 'second'))
      .then((result) => {
        finished = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(finished).toBe(false);
    expect(await store().read(runId)).toEqual(record(1));
    resume.release();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    spy.mockRestore();
    expect(await store().read(runId)).toEqual(record(2, 'first'));
  });

  it.each(['missing', 'corrupt', 'directory'])(
    'fails closed on a %s format fence without restoring legacy access',
    async (damage) => {
      await store().compareAndSwap(runId, null, record(1));
      await fs.unlink(original);
      if (damage === 'corrupt') await fs.writeFile(original, '{}');
      else if (damage === 'directory') {
        await fs.mkdir(original);
        await fs.writeFile(
          path.join(original, revisionName(1)),
          JSON.stringify(record(1, 'stale')),
        );
      }
      await expect(store().read(runId)).rejects.toThrow(/STORE_CORRUPT_RECORD/u);
      await expect(store().compareAndSwap(runId, 1, record(2))).rejects.toThrow(
        /STORE_CORRUPT_RECORD/u,
      );
      expect(JSON.parse(await fs.readFile(checkpoint, 'utf8')).record).toEqual(record(1));
    },
  );

  it.for(['namespace', 'run', 'checkpoint', 'fence', 'staged'])(
    'rejects a symlink replacing the compact %s path without touching its target',
    async (target, context) => {
      if (target === 'checkpoint' || target === 'fence') await requireFileSymlink(context);
      await store().compareAndSwap(runId, null, record(1));
      const outside = path.join(rootDir, 'outside');
      await fs.mkdir(outside);
      const sentinel = path.join(outside, 'sentinel');
      await fs.writeFile(sentinel, 'unchanged');
      const targets = {
        namespace: path.join(rootDir, '.runtime-store-v2'),
        run: compact,
        checkpoint,
        fence: original,
        staged,
      };
      const selected = targets[target as keyof typeof targets];
      if (target !== 'staged') await fs.rename(selected, path.join(rootDir, 'held'));
      const directory = target === 'namespace' || target === 'run' || target === 'staged';
      await fs.symlink(
        directory ? outside : sentinel,
        selected,
        directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file',
      );
      await expect(store().read(runId)).rejects.toThrow();
      await expect(store().compareAndSwap(runId, 1, record(2))).rejects.toThrow();
      expect(await fs.readFile(sentinel, 'utf8')).toBe('unchanged');
      expect(await fs.readdir(outside)).toEqual(['sentinel']);
    },
  );

  it('rejects mirrored revision corruption even with a recomputed checksum', async () => {
    const value = { ...record(1), run: { revision: 1 } };
    const current = createFileRuntimeStore<typeof value>({
      rootDir,
      mirroredRevisionPaths: ['run.revision'],
    });
    await current.compareAndSwap(runId, null, value);
    const saved = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
    saved.record.run.revision = 9;
    saved.hash = hashRuntimeValue({ record: saved.record, legacyRevision: saved.legacyRevision });
    await fs.writeFile(checkpoint, JSON.stringify(saved));
    await expect(current.read(runId)).rejects.toThrow(/镜像 revision/u);
    await expect(
      current.restoreCheckpoint!(runId, 1, { ...value, revision: 9, run: { revision: 9 } }),
    ).rejects.toThrow(/镜像 revision/u);
  });
});
