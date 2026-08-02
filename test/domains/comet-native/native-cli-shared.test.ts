import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertNoArguments,
  errorResult,
  languageOption,
  NativeUsageError,
  readBoundedEvidenceFile,
  readBoundedEvidenceStdin,
  render,
  requiredPositional,
  revisionOption,
  success,
  takeFlag,
  takeMany,
  takeOption,
} from '../../../domains/comet-native/native-cli-shared.js';
import {
  NativeArchivePreflightError,
  NativeSpecConflictError,
} from '../../../domains/comet-native/native-archive.js';
import {
  NativeBaselineIncompleteError,
  NativeChangeRevisionConflictError,
} from '../../../domains/comet-native/native-change.js';
import { NativeVerificationReceiptBindingError } from '../../../domains/comet-native/native-verification-runtime.js';

describe('Native CLI shared helpers', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  it('consumes flags, options, and repeated values without leaving arguments behind', () => {
    const args = ['prefix', '--flag', '--value', 'one', '--value', 'two'];
    expect(takeFlag(args, '--flag')).toBe(true);
    expect(takeMany(args, '--value')).toEqual(['one', 'two']);
    expect(args).toEqual(['prefix']);
    expect(takeFlag(args, '--missing')).toBe(false);
    expect(takeOption(args, '--missing')).toBeUndefined();
  });

  it('rejects duplicate or missing parser values', () => {
    expect(() => takeFlag(['--flag', '--flag'], '--flag')).toThrow('may only be provided once');
    expect(() => takeOption(['--value', '--other'], '--value')).toThrow('requires a value');
    expect(() => takeOption(['--value', 'one', '--value', 'two'], '--value')).toThrow(
      'may only be provided once',
    );
    expect(() => takeMany(['--value'], '--value')).toThrow('requires a value');
    expect(() => assertNoArguments(['unexpected'])).toThrow('Unexpected argument: unexpected');
    expect(() => requiredPositional(['--flag'], 'change name')).toThrow('change name is required');
    expect(() => requiredPositional([], 'change name')).toThrow('change name is required');
  });

  it('validates language and revision options', () => {
    expect(languageOption([])).toBe('en');
    expect(languageOption(['--language', 'zh-CN'])).toBe('zh-CN');
    expect(() => languageOption(['--language', 'fr'])).toThrow('--language must be en or zh-CN');
    expect(revisionOption([])).toBeUndefined();
    expect(revisionOption(['--expect-revision', '12'])).toBe(12);
    expect(() => revisionOption(['--expect-revision', '0'])).toThrow(
      '--expect-revision must be a positive integer',
    );
  });

  it('reads bounded evidence files and reports non-regular and oversized inputs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-cli-shared-'));
    temporaryRoots.push(root);
    const file = path.join(root, 'entries.json');
    await fs.writeFile(file, '[1,2]');
    await expect(readBoundedEvidenceFile(file, 10)).resolves.toBe('[1,2]');
    await expect(readBoundedEvidenceFile(root, 10)).rejects.toThrow('not a regular file');
    await expect(readBoundedEvidenceFile(file, 2)).rejects.toThrow('exceeds 2 bytes');
  });

  it('reads stdin in chunks and enforces the same byte limit', async () => {
    const stdin = Readable.from(['hello', Buffer.from(' world')]);
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as NodeJS.ReadStream);
    await expect(readBoundedEvidenceStdin(20)).resolves.toBe('hello world');

    vi.spyOn(process, 'stdin', 'get').mockReturnValue(
      Readable.from(['12345']) as NodeJS.ReadStream,
    );
    await expect(readBoundedEvidenceStdin(4)).rejects.toThrow('exceed 4 bytes');
  });

  it('maps domain errors to stable envelopes and renders JSON or text output', () => {
    const preflight = {
      ready: false,
      findingCodes: ['verification-stale'],
    } as never;
    const cases = [
      errorResult('cmd', new NativeUsageError('bad usage')),
      errorResult(
        'cmd',
        new NativeSpecConflictError('capability', 'expected', 'actual', 'spec.md'),
      ),
      errorResult('cmd', new NativeArchivePreflightError(preflight)),
      errorResult('cmd', new NativeChangeRevisionConflictError('change', 1, 2)),
      errorResult(
        'cmd',
        new NativeBaselineIncompleteError('change', 1, { 'file-size': 1 }, ['a'], false),
      ),
      errorResult(
        'cmd',
        new NativeVerificationReceiptBindingError([
          { ref: 'receipt.json', role: 'acceptance-evidence', mismatches: ['sourceRevision: 2'] },
        ]),
      ),
    ];

    expect(cases.map((result) => result.exitCode)).toEqual([64, 73, 73, 73, 65, 65]);
    expect(
      errorResult('cmd', Object.assign(new Error('disk failure'), { code: 'EIO' })),
    ).toMatchObject({
      exitCode: 70,
      error: { code: 'internal' },
    });
    expect(errorResult('cmd', new Error('transaction is locked'))).toMatchObject({
      exitCode: 73,
      error: { code: 'conflict' },
    });
    expect(errorResult('cmd', new Error('invalid input'))).toMatchObject({
      exitCode: 65,
      error: { code: 'invalid-data' },
    });
    expect(errorResult('cmd', 'unexpected')).toMatchObject({
      exitCode: 70,
      error: { code: 'internal', message: 'unexpected' },
    });

    expect(success('ok', { value: 1 })).toMatchObject({ text: '{\n  "value": 1\n}\n' });
    expect(success('ok', { value: 1 }, 'done\n')).toMatchObject({ text: 'done\n' });
    expect(render({ command: 'ok', exitCode: 0, data: { value: 1 } }, true)).toMatchObject({
      exitCode: 0,
      stdout: '{"command":"ok","exitCode":0,"data":{"value":1}}\n',
    });
    expect(
      render(
        { command: 'bad', exitCode: 65, error: { code: 'invalid-data', message: 'bad' } },
        false,
      ),
    ).toEqual({
      exitCode: 65,
      stderr: 'bad',
    });
    expect(render({ command: 'ok', exitCode: 0, text: 'done\n' }, false)).toEqual({
      exitCode: 0,
      stdout: 'done\n',
    });
  });
});
