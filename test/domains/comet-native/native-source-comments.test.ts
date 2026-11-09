import { describe, expect, it } from 'vitest';
import { isNativeOrdinaryCommentEdit } from '../../../domains/comet-native/native-source-comments.js';

describe('Native ordinary source comments', () => {
  it('fails closed for unsupported languages and mixed changes', () => {
    expect(isNativeOrdinaryCommentEdit('main.py', 'value = 1\n', '# detail\nvalue = 1\n')).toBe(
      false,
    );
    expect(isNativeOrdinaryCommentEdit('main.ts', 'const a = 1;', '// detail\nconst a = 2;')).toBe(
      false,
    );
  });
});
