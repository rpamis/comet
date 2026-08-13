import { describe, expect, it } from 'vitest';

import { nativeSensitiveRelativePathReason } from '../../../domains/comet-native/native-sensitive-paths.js';

describe('Native sensitive path classification', () => {
  it('classifies Comet runtime configuration and selection files', () => {
    expect(nativeSensitiveRelativePathReason('.comet/config.yaml')).toBe('comet-config');
    expect(nativeSensitiveRelativePathReason('.comet/current-change.json')).toBe('comet-selection');
  });
});
