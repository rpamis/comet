#!/usr/bin/env node

import { tryRunFastRuntime } from './fast-runtime-router.js';

if (!(await tryRunFastRuntime())) {
  await import('../dist/app/cli/index.js');
}
