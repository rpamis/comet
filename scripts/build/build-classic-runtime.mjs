#!/usr/bin/env node

import { buildRuntimeBundles } from '../lib/runtime-bundle-build.mjs';

await buildRuntimeBundles('classicRuntime', {
  label: 'Classic',
  script: 'scripts/build/build-classic-runtime.mjs',
});
