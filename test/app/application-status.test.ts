import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand } from '../../app/commands/doctor.js';
import { statusCommand } from '../../app/commands/status.js';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { createDiskApplication } from '../helpers/workflow-application.js';

describe('selected Application discovery in shared CLI diagnostics', () => {
  let root: string;
  let home: string;
  let app: Awaited<ReturnType<typeof createDiskApplication>>;
  let exitCode: typeof process.exitCode;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-application-status-'));
    home = path.join(root, 'home');
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    exitCode = process.exitCode;
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
    await writeProjectConfig(root, defaultProjectConfig('.'));
    app = await createDiskApplication(root);
    const request = path.join(root, 'request.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        operation: 'start',
        runId: 'report',
        workflow: { id: 'editorial', version: '1' },
        input: { topic: 'A local report' },
      }),
    );
    expect(
      (await runtimeDispatchCommand({ request, projectRoot: root, applicationFile: app.file }))
        .exitCode,
    ).toBe(0);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = exitCode;
    await fs.rm(root, { recursive: true, force: true });
  });
  async function diagnostic() {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await doctorCommand(root, { json: true, scope: 'project', homeDir: home });
      return JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
    } finally {
      log.mockRestore();
    }
  }
  it('reports the selected Run in text and Doctor, then reports fixed package drift', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await statusCommand(root);
      const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('editorial:report [running]');
      expect(output).toContain('"operation":"inspect","runId":"report"');
      expect(output).toContain('--application editorial');
    } finally {
      log.mockRestore();
    }
    const healthy = await diagnostic();
    expect(healthy.results).toContainEqual({
      check: 'current selection',
      status: 'pass',
      message: 'application:editorial/report (running, revision 1)',
    });
    await fs.appendFile(path.join(app.packageRoot, 'SKILL.md'), '\nChanged fixed package.\n');
    const changed = await diagnostic();
    expect(changed.healthy).toBe(false);
    expect(changed.results).toContainEqual({
      check: 'current selection',
      status: 'fail',
      message: expect.stringContaining('WORKFLOW_CHANGED'),
    });
    expect(
      JSON.stringify(
        changed.results.find((result: { check: string }) => result.check === 'current selection'),
      ),
    ).not.toContain('no active Comet change');
  });
});
