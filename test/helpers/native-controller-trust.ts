import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildNativeControllerTrustStore,
  nativeControllerProjectRootHash,
  NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV,
} from '../../domains/comet-native/native-controller-trust.js';
import type { NativeReviewKeyPair } from '../../domains/comet-native/native-review-identity.js';
import { registerTrustedReadonlyFileForTest } from '../../platform/fs/trusted-readonly-file.js';

export async function installNativeControllerTrust(options: {
  projectRoot: string;
  controller: NativeReviewKeyPair;
}): Promise<() => Promise<void>> {
  const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-controller-trust-'));
  const storePath = path.join(storeRoot, 'controller-trust.json');
  const projectRootHash = await nativeControllerProjectRootHash(options.projectRoot);
  const store = buildNativeControllerTrustStore([
    {
      projectRootHash,
      controllerIdentity: options.controller.identity,
    },
  ]);
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
  const unregisterIsolation = registerTrustedReadonlyFileForTest(storePath);
  const previous = process.env[NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV];
  process.env[NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV] = storePath;
  return async () => {
    unregisterIsolation();
    if (previous === undefined) {
      delete process.env[NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV];
    } else {
      process.env[NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV] = previous;
    }
    await fs.rm(storeRoot, { recursive: true, force: true });
  };
}
