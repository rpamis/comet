#!/usr/bin/env node

import { buildRuntimeBundles } from '../lib/runtime-bundle-build.mjs';
import { excludeClassicRuntimeSchemas } from '../lib/runtime-schema-build.mjs';

await buildRuntimeBundles('nativeRuntime', {
  label: 'Native',
  script: 'scripts/build/build-native-runtime.mjs',
  plugins: () => [excludeClassicRuntimeSchemas()],
});
