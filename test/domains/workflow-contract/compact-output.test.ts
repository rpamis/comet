import { describe, expect, it, vi } from 'vitest';
import {
  compactCliJson,
  compactCliStdout,
} from '../../../domains/workflow-contract/compact-output.js';

// 独立消费方按 RFC 6901 恢复，避免以投影实现本身充当测试预言机。
function expand(view: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(view);
  const metadata = result.outputView as { references: Record<string, string> };
  delete result.outputView;
  const tokens = (pointer: string) =>
    pointer
      .slice(1)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const restore = (pointer: string): unknown => {
    const target = metadata.references[pointer];
    if (target !== undefined) {
      const value = structuredClone(restore(target));
      const parts = tokens(pointer);
      const key = parts.pop()!;
      let parent: any = result;
      for (const part of parts) parent = parent[part];
      Object.defineProperty(parent, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      delete metadata.references[pointer];
    }
    let value: any = result;
    for (const part of tokens(pointer)) value = value[part];
    // 目标子树本身也可能包含更早的引用。
    for (const child of Object.keys(metadata.references)) {
      if (child.startsWith(`${pointer}/`)) restore(child);
    }
    return value;
  };
  for (const pointer of Object.keys(metadata.references)) restore(pointer);
  return result;
}

describe('compact JSON projection', () => {
  it('restores every field including escaped keys, approval identity, recovery, and repeated inputs', () => {
    const input = { task: 'task '.repeat(200), 'a/b~c': 'context '.repeat(100) };
    const request = {
      operation: 'submit-outcome',
      expectedRevision: 17,
      attempt: 2,
      inputHash: 'original-hash',
      claimToken: 'original-token',
      input,
    };
    const continuation = {
      cwd: '/repo with spaces',
      input,
      outcomeRequest: request,
      recoveryRequests: [request],
      commandArgs: ['comet', 'runtime', 'dispatch', '--request', '<request-file>'],
      instruction: 'follow '.repeat(100),
    };
    const full = {
      command: 'next',
      exitCode: 0,
      data: {
        continuation,
        pendingActions: [
          { input, attempt: 2, inputHash: 'original-hash', claim: { token: 'original-token' } },
        ],
        'a/b~c': 'follow '.repeat(100),
        proposalHash: 'approval-hash',
        revision: 17,
        blockers: ['requires approval'],
        workspace: { cwd: '/repo with spaces' },
      },
      agent: { continuation },
      summary: 'follow '.repeat(100),
    };
    const original = structuredClone(full);
    const compact = compactCliJson(full);
    expect(full).toEqual(original);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length);
    expect((compact.outputView as any).references['/data/a~1b~0c']).toBeDefined();
    expect(compact.outputView).toMatchObject({ schema: 'comet.cli.compact.v1' });
    expect((compact.data as any).continuation.outcomeRequest).toEqual(request);
    expect((compact.data as any).continuation.recoveryRequests).toEqual([request]);
    expect(expand(compact)).toEqual(full);
  });

  it('preserves differing evidence and leaves existing reference-shaped payloads untouched', () => {
    const full = {
      data: {
        first: { text: 'a'.repeat(300), inputHash: 'one' },
        second: { text: 'a'.repeat(300), inputHash: 'two' },
        schema: { $ref: '#/definitions/task' },
      },
    };
    expect(expand(compactCliJson(full))).toEqual(full);
  });

  it('does not stringify every ancestor of a large nested Run', () => {
    let nested: Record<string, unknown> = {
      history: Array.from({ length: 4000 }, (_, i) => ({
        revision: i,
        summary: 'event '.repeat(80),
      })),
    };
    for (let depth = 0; depth < 100; depth++) nested = { input: nested };
    const full = { data: { input: nested, pendingAction: { input: nested } } };
    const stringify = vi.spyOn(JSON, 'stringify');
    const compact = compactCliJson(full);
    // 两个独立候选子树；深度增长不增加全量序列化次数。
    expect(stringify.mock.calls.length).toBeLessThanOrEqual(3);
    stringify.mockRestore();
    expect(expand(compact)).toEqual(full);
  });

  it('preserves default stdout byte for byte and emits one JSON object only when opted in', () => {
    const stdout = '  { "data": {"value":1} }\n';
    expect(compactCliStdout(stdout, false)).toBe(stdout);
    expect(JSON.parse(compactCliStdout(stdout, true)!)).toMatchObject({
      data: { value: 1 },
    });
    expect(compactCliStdout(stdout, true)).toBe(stdout);
    expect(compactCliStdout(undefined, true)).toBeUndefined();
    const short = JSON.stringify({
      data: { input: { text: 'a'.repeat(180) }, current: { text: 'a'.repeat(180) } },
    });
    expect(compactCliStdout(short, true)).toBe(short);
  });
});
