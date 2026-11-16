#!/usr/bin/env node

import { buildRuntimeBundles } from '../lib/runtime-bundle-build.mjs';

// Keep the guard out of the router's fast path; load its sibling bundle only when needed.
const hookRouterGuardExternal = {
  name: 'comet-hook-router-guard-external',
  setup(build) {
    build.onResolve({ filter: /hook-router-guard-entry[.]js$/ }, () => ({
      path: './comet-hook-router-guard.mjs',
      external: true,
    }));
  },
};

await buildRuntimeBundles('entryRuntime', {
  label: 'Entry',
  script: 'scripts/build/build-entry-runtime.mjs',
  plugins: (name) => (name === 'hookRouter' ? [hookRouterGuardExternal] : []),
});
