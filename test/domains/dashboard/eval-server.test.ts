import { evalMatrix } from '../../helpers/eval-matrix.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startDashboardServer } from '../../../domains/dashboard/server.js';

vi.mock('../../../platform/process/external-command.js', () => ({
  runExternalCommandAsync: vi.fn(async () => 'available'),
}));

describe('Dashboard Eval routes', () => {
  let project: string;
  let server: Awaited<ReturnType<typeof startDashboardServer>>;
  let endpoint: string;
  const request = (suffix: string, method = 'GET', body?: unknown, origin?: string) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.port,
          path: suffix.startsWith('/api/') ? suffix : endpoint + suffix,
          method,
          headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(origin ? { origin } : {}),
          },
        },
        (response) => {
          let text = '';
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () => {
            let data: unknown;
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
            resolve({ status: response.statusCode!, body: data });
          });
        },
      );
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-server-'));
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(project, 'home'));
    const root = path.join(project, '.comet/eval/runs/cli-history');
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'expected-case-matrix.json'),
      JSON.stringify(evalMatrix([{ task: 'case', treatment: 'BASE', rep: 1 }])),
    );
    await fs.writeFile(
      path.join(root, 'metadata.json'),
      JSON.stringify({
        experiment_id: 'cli-history',
        completed_at: '2026-10-10T12:00:00Z',
        expected_case_matrix: { case_count: 1 },
      }),
    );
    await fs.writeFile(
      path.join(root, 'reports/task_report.json'),
      JSON.stringify({
        name: 'case-BASE',
        rep: 1,
        passed: false,
        checks_passed: [],
        checks_failed: ['missing input'],
        sample_quality: { status: 'included' },
        events_summary: {
          treatment: 'BASE',
          sample: 1,
          task: 'case',
          skill_sources: [{ name: 'writer', path: 'writer' }],
          case_manifest: { task_hash: 'task', validator_hash: 'validator' },
        },
      }),
    );
    await fs.writeFile(path.join(root, 'summary.md'), '# Report');
    server = await startDashboardServer({ projectPath: project, port: 0 });
    const directory = await new Promise<any>((resolve, reject) => {
      http
        .get(`${server.url}/api/dashboard/projects`, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => resolve(JSON.parse(data)));
        })
        .on('error', reject);
    });
    endpoint = `/api/dashboard/projects/${directory.currentProjectId}/eval`;
  });
  afterEach(async () => {
    await server?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(project, { recursive: true, force: true });
  });
  it('exposes real CLI history and result artifacts in the selected project', async () => {
    const list = await request('/runs');
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ id: 'cli-history', conclusion: 'failed' });
    const detail = await request('/runs/cli-history');
    expect(detail.body.cases[0].checksFailed).toEqual(['missing input']);
    const artifact = await request('/runs/cli-history/artifact?ref=summary.md');
    expect(artifact.body.content).toBe('# Report');
  });
  it('serves bounded case pages and validates case identities and filters', async () => {
    const detail = await request('/runs/cli-history');
    expect(detail.body.caseContentOmitted).toBe(true);
    const page = await request('/runs/cli-history/cases?limit=1&offset=0&status=failed&q=case');
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(1);
    expect(page.body.items[0].id).toBe('task_report.json');
    expect((await request('/runs/cli-history/case?id=task_report.json')).body.checksFailed).toEqual(
      ['missing input'],
    );
    expect((await request('/runs/cli-history/case?id=../metadata.json')).status).toBe(400);
    expect((await request('/runs/cli-history/cases?limit=0')).status).toBe(400);
    expect((await request('/runs/cli-history/cases?status=other')).status).toBe(400);
    expect(
      (
        await request(
          '/runs/cli-history/repair-managed-record',
          'POST',
          {},
          'https://untrusted.example',
        )
      ).status,
    ).toBe(403);
  });
  it('manages user-level Eval settings without exposing credentials or accepting cross-origin writes', async () => {
    for (const key of [
      'BENCH_API_KEY',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'BENCH_CC_MODEL',
      'BENCH_MODEL',
      'COMET_EVAL_SUITE',
      'LANGFUSE_PUBLIC_KEY',
      'LANGFUSE_SECRET_KEY',
    ])
      vi.stubEnv(key, undefined);
    const api = '/api/dashboard/eval/settings';
    const old = await request(api);
    expect(old.status).toBe(200);
    const update = {
      expectedRevision: old.body.revision,
      defaults: {
        ...old.body.defaults,
        agent: 'claude-code',
        model: 'settings-model',
        suite: 'langfuse',
      },
      credentials: {
        main: { value: 'http-test-secret', kind: 'api-key' },
        langfusePublic: { value: 'http-fuse-public', kind: 'api-key' },
        langfuseSecret: { value: 'http-fuse-secret', kind: 'api-key' },
      },
    };
    expect((await request(api, 'POST', update, 'https://untrusted.example')).status).toBe(403);
    const saved = await request(api, 'POST', update);
    expect(saved.status).toBe(200);
    expect(saved.body.credentials.main.configured).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain('http-test-secret');
    expect(JSON.stringify((await request(api)).body)).not.toContain('http-test-secret');
    expect((await request(api, 'POST', update)).status).toBe(409);
    const check = await request(api + '/check', 'POST', {});
    expect(check.body.noModelsStarted).toBe(true);
    expect(check.body.environment.find((item: any) => item.id === 'subject').status).toBe(
      'available',
    );
    expect(JSON.stringify(check.body)).not.toContain('http-test-secret');
    expect(check.body.environment.find((item: any) => item.id === 'tracking').status).toBe(
      'available',
    );
    for (const secret of ['http-fuse-public', 'http-fuse-secret']) {
      expect(JSON.stringify(saved.body)).not.toContain(secret);
      expect(JSON.stringify(check.body)).not.toContain(secret);
    }
  });
  it('previews targets using the selected project even when the Dashboard process works elsewhere', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-launch-'));
    const changedCwd = vi.spyOn(process, 'cwd').mockReturnValue(other);
    try {
      await fs.mkdir(path.join(project, 'skill'));
      await fs.writeFile(path.join(project, 'skill/SKILL.md'), '# Selected project Skill');
      await fs.writeFile(path.join(other, 'SKILL.md'), '# External Skill');
      const relative = await request('/preview', 'POST', {
        target: 'skill/SKILL.md',
        agent: 'codex',
        model: 'fixture-model',
        judgeEnabled: false,
      });
      expect(relative.status).toBe(200);
      expect(relative.body.target.path).toBe(path.join(project, 'skill/SKILL.md'));
      expect(relative.body.target.type).toBe('skill');
      const absolute = await request('/preview', 'POST', {
        target: path.join(other, 'SKILL.md'),
        agent: 'codex',
        model: 'fixture-model',
        judgeEnabled: false,
      });
      expect(absolute.status).toBe(200);
      expect(absolute.body.target.path).toBe(path.join(other, 'SKILL.md'));
      expect(absolute.body.noModelsStarted).toBe(true);
    } finally {
      changedCwd.mockRestore();
      await fs.rm(other, { recursive: true, force: true });
    }
  });
  it('sets a baseline through same-origin JSON only', async () => {
    expect(
      (await request('/runs/cli-history/baseline', 'POST', {}, 'https://example.com')).status,
    ).toBe(403);
    const baseline = await request('/runs/cli-history/baseline', 'POST', {});
    expect(baseline.status).toBe(200);
    expect(baseline.body.isBaseline).toBe(true);
  });
  it('rejects traversal in artifact references', async () => {
    expect((await request('/runs/cli-history/artifact?ref=../metadata.json')).status).toBe(400);
  });
  it('clears a baseline through same-origin JSON while retaining the run', async () => {
    await request('/runs/cli-history/baseline', 'POST', {});
    expect(
      (await request('/runs/cli-history/baseline/clear', 'POST', {}, 'https://example.com')).status,
    ).toBe(403);
    const cleared = await request('/runs/cli-history/baseline/clear', 'POST', {
      scope: (await request('/runs/cli-history')).body.baselineScope,
      expectedRun: 'cli-history',
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ isBaseline: false, baselineRunId: null, passed: 0 });
    expect((await request('/runs/cli-history')).body.cases).toHaveLength(1);
  });
  it('persists project presets and rejects stale deletes through the real server', async () => {
    const saved = await request('/presets', 'POST', {
      name: '日常',
      config: { target: 'skill', agent: 'codex', model: 'fixture' },
    });
    expect(saved.status).toBe(200);
    expect((await request('/presets')).body.items).toHaveLength(1);
    expect(
      (await request(`/presets/${saved.body.id}/delete`, 'POST', { expectedUpdatedAt: 'stale' }))
        .status,
    ).toBe(409);
    expect(
      (
        await request(`/presets/${saved.body.id}/delete`, 'POST', {
          expectedUpdatedAt: saved.body.updatedAt,
        })
      ).status,
    ).toBe(200);
    expect((await request('/presets')).body.items).toEqual([]);
  });
});
