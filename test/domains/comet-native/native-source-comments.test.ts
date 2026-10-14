import { describe, expect, it } from 'vitest';
import { isNativeOrdinaryCommentEdit } from '../../../domains/comet-native/native-source-comments.js';

describe('Native ordinary source comments', () => {
  it.each([
    'main.js',
    'main.ts',
    'main.jsx',
    'main.tsx',
    'main.mjs',
    'main.cjs',
    'main.mts',
    'main.cts',
  ])('recognizes ordinary comments in %s', (file) => {
    const source =
      file === 'main.cjs'
        ? 'module.exports.value = "// this is a string";\n'
        : 'export const value = "// this is a string";\n';
    expect(
      isNativeOrdinaryCommentEdit(file, source, '// 中文说明\n' + source + '/* More detail. */\n'),
    ).toBe(true);
  });
  it.each([
    ['export const value = 1;', 'export const value = 2;'],
    ['export const value = "// old";', 'export const value = "// new";'],
    ['const value = `// old`;', 'const value = `// new`;'],
    ['function f() { return 1; }', 'function f() { return /*\n*/ 1; }'],
    ['const a = 1;', '// @ts-nocheck\nconst a = 1;'],
    ['const a = 1;', '// eslint-disable-next-line\nconst a = 1;'],
    ['const a = f();', 'const a = /* #__PURE__ */ f();'],
    ['const a = f();', '/* istanbul ignore next */ const a = f();'],
    ['const a = 1;', 'const a = 1;\n//# sourceURL=a.js'],
    ['const a = 1;', '/*:: type A = number */\nconst a = 1;'],
    ['const a = 1;', 'const a = ;'],
    ['const a = /hello/;', 'const a = /world/;'],
  ])('keeps executable syntax and tool directives bound (%s)', (before, after) => {
    expect(isNativeOrdinaryCommentEdit('main.ts', before, after)).toBe(false);
  });
  it('fails closed for unsupported languages and mixed changes', () => {
    expect(isNativeOrdinaryCommentEdit('main.py', 'value = 1\n', '# detail\nvalue = 1\n')).toBe(
      false,
    );
    expect(isNativeOrdinaryCommentEdit('main.ts', 'const a = 1;', '// detail\nconst a = 2;')).toBe(
      false,
    );
  });
  it('keeps JSX text and TypeScript types bound', () => {
    expect(
      isNativeOrdinaryCommentEdit(
        'main.tsx',
        'const a = <div>one</div>;',
        'const a = <div>two</div>;',
      ),
    ).toBe(false);
    expect(
      isNativeOrdinaryCommentEdit('main.ts', 'const a: number = 1;', 'const a: any = 1;'),
    ).toBe(false);
  });
});
