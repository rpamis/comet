import { describe, expect, it, vi } from 'vitest';
import * as yaml from 'yaml';

import {
  NATIVE_MANAGED_RUN_MARKER,
  parseNativeStateDocument,
} from '../../../domains/comet-native/native-state-document.js';

vi.mock('yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yaml')>();
  return { ...actual, parseDocument: vi.fn(actual.parseDocument) };
});

const prefix = `${NATIVE_MANAGED_RUN_MARKER}schema: comet.native.v4\nname: sample\n`;
const read = (source: string) => parseNativeStateDocument(source, 'Native state');

describe('Native checkpoint YAML compatibility and parser budget', () => {
  it.each([2, 10, 100])(
    'keeps the entire %s-item checkpoint while passing only ordinary state to the YAML parser',
    (count) => {
      const checkpoint = {
        schema: 'comet.workflow-run-checkpoint.v1',
        run: { evidence: Array.from({ length: count }, (_, id) => ({ id, value: `case ${id}` })) },
      };
      const source = `${prefix}run_checkpoint: ${JSON.stringify(checkpoint)}\n`;
      const parse = vi.mocked(yaml.parseDocument);
      parse.mockClear();
      expect(read(source)).toEqual({
        schema: 'comet.native.v4',
        name: 'sample',
        run_checkpoint: checkpoint,
      });
      expect(parse.mock.calls.map(([text]) => text)).toEqual([prefix]);
      // 既有 YAML 读者无需格式升级即可读取完整 checkpoint。
      expect(yaml.parse(source)).toEqual(read(source));
    },
  );

  it.each([
    `${prefix}# user comment\nrun_checkpoint:\n  hash: value\n  run: {status: waiting}\n`,
    `${prefix}run_checkpoint: {"hash":"value"} # user comment\n`,
    `${prefix}run_checkpoint: { "hash": "value" }\n`,
    `${prefix}source: &saved {hash: value}\nrun_checkpoint: *saved\n`,
    `${prefix}source: &saved {hash: value}\nrun_checkpoint: {hash: *saved}\n`,
    `${prefix}run_checkpoint: {"hash":"value"}\n# trailing comment\n`,
    `${prefix}run_checkpoint: {"hash":"value"}`,
  ])('preserves edited YAML, comments and anchors: %s', (source) => {
    expect(read(source)).toEqual(yaml.parse(source));
  });

  it.each([
    `${prefix}name: other\nrun_checkpoint: {"hash":"value"}\n`,
    `${prefix}run_checkpoint: {}\nrun_checkpoint: {"hash":"value"}\n`,
    `${prefix}"run_checkpoint": {}\nrun_checkpoint: {"hash":"value"}\n`,
    `${prefix}run_checkpoint: {"hash":"value","hash":"value"}\n`,
    `${prefix}run_checkpoint: {"run":{"state":1,"state":2}}\n`,
    `${prefix}run_checkpoint: {"run":{"state":1,"\\u0073tate":1}}\n`,
  ])('rejects duplicate keys on the generated and fallback paths: %s', (source) => {
    expect(() => read(source)).toThrow(/invalid YAML/);
  });

  it.each([
    `${prefix}...\nrun_checkpoint: {"hash":"value"}\n`,
    `${prefix}---\nrun_checkpoint: {"hash":"value"}\n`,
    `${prefix}...\n---\nrun_checkpoint: {"hash":"value"}\n`,
    `${prefix}%YAML 1.2\nrun_checkpoint: {"hash":"value"}\n`,
  ])(
    'rejects full-document grammar violations instead of parsing a truncated prefix: %s',
    (source) => {
      expect(() => yaml.parse(source)).toThrow();
      expect(() => read(source)).toThrow(/invalid YAML/);
    },
  );

  it.each(['\r\n', '\u0085', '\u2028', '\u2029', '\\', '\t', '\u0000', '你好 🛰️'])(
    'matches full YAML decoding for JSON string content %j',
    (value) => {
      const source = `${prefix}run_checkpoint: ${JSON.stringify({ value })}\n`;
      expect(read(source)).toEqual(yaml.parse(source));
    },
  );

  it('preserves unusual JSON keys and escaped string content without prototype changes', () => {
    const checkpoint = JSON.parse(
      '{"__proto__":{"safe":true},"values":["\\nrun_checkpoint: {}","\\ud800","#comment",0,1e+100]}',
    );
    const source = `${prefix}run_checkpoint: ${JSON.stringify(checkpoint)}\n`;
    expect(read(source)).toEqual(yaml.parse(source));
    expect(Object.getPrototypeOf((read(source) as { run_checkpoint: object }).run_checkpoint)).toBe(
      Object.prototype,
    );
  });
});
