import { describe, expect, it } from 'vitest';
import { classifyEditImpact } from '../../../domains/workflow-contract/edit-impact.js';

describe('local edit impact', () => {
  it.each([
    ['main.ts', 'export const a = 1;', '// explanation\nexport const a = 1;'],
    ['main.ts', 'const a = 1;', 'const a=1\n'],
    [
      'main.ts',
      '// eslint-disable-next-line\nconst a = 1;',
      '// Explain the value.\n// eslint-disable-next-line\nconst a = 1;',
    ],
    [
      'main.ts',
      '// @ts-nocheck\nconst a = 1;',
      '// Explain the value.\n// @ts-nocheck\nconst a = 1;',
    ],
    ['settings.json', '{"x":1,"y":true}', '{\n "x": 1,\n "y": true\n}'],
    ['settings.yaml', 'x: 1\ny: true\n', '# explanation\nx: 1\ny: true\n'],
    ['settings.toml', 'enabled=true\n', '# explanation\nenabled = true\n'],
    ['note.md', '# Heading\n\nA long line of text.\n', '# Heading\n\nA long line\nof text.\n'],
  ])('recognizes non-behavioral %s edits', (file, before, after) => {
    expect(classifyEditImpact(file, before, after).kind).toBe('non-behavioral');
  });
  it.each([
    ['main.ts', 'const a: number = 1;', 'const a: any = 1;'],
    ['main.ts', 'const a = f();', 'const a = /* @__PURE__ */ f();'],
    ['main.ts', 'const a = 1;', '// eslint-disable-next-line\nconst a = 1;'],
    [
      'main.ts',
      '// eslint-disable-next-line\nconst a = 1;',
      '// eslint-disable-next-line\n\nconst a = 1;',
    ],
    [
      'main.ts',
      '/// <reference path="types.d.ts" />\nconst a = 1;',
      'const a = 1;\n/// <reference path="types.d.ts" />',
    ],
    ['main.ts', 'function f(){ return 1; }', 'function f(){ return\n1; }'],
    ['main.ts', 'const a = tag`\\n`;', 'const a = tag`\n`;'],
    ['settings.json', '{"enabled":true}', '{"enabled":false}'],
    ['settings.json', '{"value":0}', '{"value":-0}'],
    ['settings.yaml', 'x: .nan\n', 'x: null\n'],
    ['settings.yaml', 'x: .inf\n', 'x: -.inf\n'],
    ['settings.yaml', 'x: yes\n', 'x: true\n'],
    ['settings.yaml', 'x: 1\n', 'x: 1 # yamllint disable-line\n'],
    ['settings.toml', 'x = 2026-10-15T00:00:00Z\n', 'x = "2026-10-15T00:00:00.000Z"\n'],
    ['settings.toml', 'x = 2026-10-15\n', 'x = 2026-10-15T00:00:00Z\n'],
    ['settings.toml', 'x = 2026-10-15T00:00:00Z\n', 'x = 2026-10-15T08:00:00+08:00\n'],
    [
      'main.ts',
      'export function value() { return 1; }',
      'export function value() { const result = 1; return result; }',
    ],
  ])(
    'requires context review instead of inferring behavior from syntax in %s',
    (file, before, after) => {
      expect(classifyEditImpact(file, before, after).kind).toBe('review-required');
    },
  );
  it.each([
    ['worker.py', 'x = 1\n', '# explanation\nx = 1\n'],
    ['NOTICE', 'Ready\n', 'Ready to continue\n'],
    ['settings.json', '{"x":1}', '{"x":1,"x":2}'],
    ['main.ts', 'const a = 1;', 'const a = ;'],
    ['note.md', 'Old sentence.\n', 'New sentence.\n'],
    ['labels.csv', 'key,text\nready,Ready\n', 'key,text\nready,Ready to continue\n'],
    ['styles.css', '.ready { color: green; }', '/* Status indicator */\n.ready { color: green; }'],
  ])('requires review when local parsing cannot prove equivalence in %s', (file, before, after) => {
    expect(classifyEditImpact(file, before, after).kind).toBe('review-required');
  });
  it('retains the original approval for formal text changes', () => {
    expect(classifyEditImpact('brief.md', 'Do A.', 'Do B.', { formal: true }).kind).toBe(
      'requirements-changed',
    );
  });
  it('does not use formatting equivalence to bypass formal approval', () => {
    expect(
      classifyEditImpact('brief.md', 'A long line.\n', 'A long\nline.\n', { formal: true }).kind,
    ).toBe('requirements-changed');
  });
  it.each([
    ['AGENTS.md', 'Ask before deploying.\n', 'Deploy without asking.\n'],
    ['assets/skills/example/SKILL.md', 'Run checks.\n', 'Skip checks.\n'],
  ])('retains the execution-instruction revision protocol for %s', (file, before, after) => {
    expect(classifyEditImpact(file, before, after).kind).toBe('implementation-changed');
  });
});
