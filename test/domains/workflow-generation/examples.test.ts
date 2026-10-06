import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { prepareWorkflowApplicationExample } from '../../../domains/workflow-generation/index.js';
import {
  loadWorkflowApplication,
  exportWorkflowApplication,
  previewWorkflowApplicationInstall,
  installWorkflowApplication,
} from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-examples-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it.each(['native', 'classic-full', 'classic-hotfix', 'classic-tweak', 'standalone'] as const)(
  'builds, exports and installs a complete runnable %s sample',
  async (base) => {
    const file = await prepareWorkflowApplicationExample({
      base,
      projectRoot: root,
      packageRoot: path.join(root, 'sample'),
    });
    const loaded = await loadWorkflowApplication({ file, projectRoot: root });
    expect(loaded.manifest.base).toBe(base);
    expect(loaded.implementation.workflows.length).toBeGreaterThan(0);
    const exported = await exportWorkflowApplication({
      file,
      projectRoot: root,
      destination: path.join(root, 'export'),
    });
    const options = {
      file: exported.file,
      projectRoot: root,
      scope: 'project' as const,
      host: 'claude-code' as const,
    };
    const preview = await previewWorkflowApplicationInstall(options);
    const installed = await installWorkflowApplication({
      ...options,
      confirmationHash: preview.confirmationHash,
    });
    const cold = await loadWorkflowApplication({ file: installed.file, projectRoot: root });
    expect(cold.implementation.workflows).toEqual(loaded.implementation.workflows);
    expect((await fs.readdir(root)).some((file) => file.startsWith('.comet-example-'))).toBe(false);
  },
);
