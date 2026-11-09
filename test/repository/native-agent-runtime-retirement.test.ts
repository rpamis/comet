import { expect, it } from 'vitest';
import * as native from '../../domains/comet-native/index.js';

it('keeps project snapshot creation and scope proof APIs out of the Native entry point', () => {
  expect(native).not.toHaveProperty('createNativeChange');
  expect(native).not.toHaveProperty('createNativeContentSnapshot');
  expect(native).not.toHaveProperty('createNativeCurrentContentSnapshot');
  expect(native).not.toHaveProperty('NativeBaselineIncompleteError');
});
