import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPersonalMemoryPluginDescriptor,
  FileMemoryRepository,
  PersonalMemoryService,
} from '../../../domains/comet-memory/index.js';
import { PluginRuntime, MemoryPluginStateStore } from '../../../domains/comet-plugin/index.js';
import { DashboardPluginHost } from '../../../domains/dashboard/plugin-host.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each(['1', '0'])(
  'keeps successful sections and logs redacted failures only with COMET_DEBUG=%s',
  async (debug) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-diagnostics-'));
    vi.stubEnv('COMET_DEBUG', debug);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new PersonalMemoryService({ repository: new FileMemoryRepository(root) });
    vi.spyOn(service, 'status').mockRejectedValue(
      new Error('status unavailable Bearer super-secret-token'),
    );
    const runtime = new PluginRuntime({
      cometVersion: '0.5.2',
      store: new MemoryPluginStateStore(),
      descriptors: [createPersonalMemoryPluginDescriptor({ createService: () => service })],
    });
    try {
      await runtime.reconcileFirstParty();
      const host = new DashboardPluginHost({ runtime, projectId: 'project-1' });
      const snapshot = await host.get('comet.personal-memory');
      expect(snapshot.data).toMatchObject({
        partial: true,
        sectionErrors: [expect.objectContaining({ section: 'status' })],
        management: { records: [] },
      });
      if (debug === '1') {
        expect(log).toHaveBeenCalled();
        const output = JSON.stringify(log.mock.calls);
        expect(output).toContain('comet.personal-memory');
        expect(output).toContain('status unavailable');
        expect(output).toContain('[redacted]');
        expect(output).not.toContain('super-secret-token');
      } else expect(log).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
