import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../../domains/engine/runtime.js';
import { inspectApplicationSkill } from '../../domains/workflow-application/index.js';

/** 使用实际 npm 包和独立 CLI 进程；只借用当前安装的依赖，不接触用户配置。 */
describe('packed standalone report application through public CLI', () => {
  const repository = path.resolve('.');
  let temporary: string;
  let consumer: string;
  let packageRoot: string;
  let applicationFile: string;
  let requestSequence = 0;
  beforeAll(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-report-consumer-'));
    consumer = path.join(temporary, 'consumer');
    const unpack = path.join(temporary, 'unpack');
    await fs.mkdir(unpack);
    const packOutput = execFileSync(
      'npm',
      ['pack', '--ignore-scripts=true', '--json', '--pack-destination', temporary],
      {
        cwd: repository,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 60000,
        env: { ...process.env, npm_config_ignore_scripts: 'true' },
      },
    );
    // 此环境的 npm 仍会打印 prepare 输出；只解析 npm 返回的最后一个 JSON 数组。
    const metadata = JSON.parse(
      packOutput.slice([...packOutput.matchAll(/^\[/gmu)].at(-1)?.index ?? 0),
    );
    execFileSync('tar', ['-xf', path.join(temporary, metadata[0].filename), '-C', unpack], {
      timeout: 30000,
    });
    packageRoot = path.join(consumer, 'node_modules/@rpamis/comet');
    await fs.mkdir(path.dirname(packageRoot), { recursive: true });
    await fs.rename(path.join(unpack, 'package'), packageRoot);
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const modulesRoot = createRequire(import.meta.url)
      .resolve.paths('ajv')!
      .find((directory) => existsSync(path.join(directory, 'ajv')))!;
    for (const dependency of Object.keys(manifest.dependencies)) {
      const modules = path.join(modulesRoot, dependency);
      const target = path.join(consumer, 'node_modules', dependency);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.symlink(
        await fs.realpath(modules),
        target,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    const applicationRoot = path.join(consumer, 'report-package');
    await fs.mkdir(applicationRoot);
    await fs.writeFile(
      path.join(applicationRoot, 'ENTRY.md'),
      '# 报告入口\n通过公开 Runtime 启动与继续同一 Run。\n',
    );
    await fs.writeFile(
      path.join(applicationRoot, 'application.mjs'),
      "export { createReportApplication as createApplication } from '@rpamis/comet/applications';\n",
    );
    applicationFile = path.join(applicationRoot, 'application.json');
    const guideRoot = path.join(applicationRoot, 'approval-guide');
    await fs.mkdir(guideRoot);
    await fs.writeFile(
      path.join(guideRoot, 'SKILL.md'),
      '---\nname: actual-report-review\n---\n\n# Approval guidance\nRead the actual report before approval. No publishing or approvals.\n',
    );
    const guide = await inspectApplicationSkill(guideRoot);
    await fs.writeFile(
      applicationFile,
      JSON.stringify({
        schema: 'comet.workflow.application.v1',
        id: 'local-report',
        version: '1',
        base: 'standalone',
        runtimeVersion: manifest.version,
        entrySkill: 'ENTRY.md',
        module: 'application.mjs',
        skills: [
          {
            id: 'logical-review-guide',
            root: 'approval-guide',
            contentHash: guide.contentHash,
            adapter: {
              kind: 'guidance',
              inputSchema: { type: 'object' },
              outputSchema: { type: 'object' },
              scope: ['reports'],
              requiredCapabilities: [],
              interaction: 'none',
              sideEffect: 'read',
              controlsApproval: false,
              completion: 'self-report',
              failure: 'stop',
              recovery: 'manual',
              review: {
                status: 'accepted',
                reviewedBy: 'fixture-review',
                contentHash: guide.contentHash,
                capabilities: [
                  { id: 'report-review', file: 'SKILL.md', excerpt: 'Read the actual report' },
                ],
                effects: [{ file: 'SKILL.md', excerpt: 'No publishing or approvals.' }],
              },
            },
          },
        ],
        bindings: ['approve', 'approve-revision'].map((stepId) => ({
          workflowId: 'report-publishing',
          stepId,
          skillId: 'logical-review-guide',
          capability: 'report-review',
          usage: 'guidance',
        })),
      }),
    );
  }, 120000);
  afterAll(async () => {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  });

  async function dispatch(
    projectRoot: string,
    request: Record<string, unknown>,
    application: 'file' | 'selected' = 'selected',
  ) {
    const file = path.join(temporary, `request-${++requestSequence}.json`);
    await fs.writeFile(file, JSON.stringify(request));
    const raw = execFileSync(
      process.execPath,
      [
        path.join(packageRoot, 'bin/comet.js'),
        'runtime',
        'dispatch',
        '--details',
        ...(application === 'file'
          ? ['--application-file', applicationFile]
          : ['--application', 'local-report']),
        '--project-root',
        projectRoot,
        '--request',
        file,
        '--json',
      ],
      {
        cwd: consumer,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, COMET_DAEMON: 'off', COMET_DISABLE_UPDATE_CHECK: '1' },
      },
    );
    const response = JSON.parse(raw);
    expect(response.status).toBe('succeeded');
    expect(response.application.base).toBe('standalone');
    if (process.env.COMET_REPORT_EVIDENCE_DIR) {
      await fs.mkdir(process.env.COMET_REPORT_EVIDENCE_DIR, { recursive: true });
      await fs.appendFile(
        path.join(process.env.COMET_REPORT_EVIDENCE_DIR, 'packed-cli-transcript.jsonl'),
        JSON.stringify({ requestSequence, request, response }) + '\n',
      );
    }
    return response.data as WorkflowRun;
  }
  async function executePending(project: string, run: WorkflowRun) {
    while (run.actions.some(({ status }) => status === 'pending')) {
      const action = run.actions.find(({ status }) => status === 'pending')!;
      run = await dispatch(project, {
        operation: 'execute',
        runId: run.runId,
        actionId: action.id,
        executorId: 'report-local',
      });
    }
    return run;
  }
  async function prepare(project: string) {
    await fs.mkdir(project);
    let run = await dispatch(
      project,
      {
        operation: 'start',
        runId: 'same-report',
        workflow: { id: 'report-publishing', version: '1' },
        input: {
          title: 'Consumer report',
          body: 'Actual packed consumer output.',
          sources: ['Isolated local source'],
        },
      },
      'file',
    );
    run = await dispatch(project, { operation: 'next', runId: run.runId });
    const childRunId = run.children[0].runId;
    await executePending(
      project,
      await dispatch(project, { operation: 'inspect', runId: childRunId }),
    );
    run = await dispatch(project, { operation: 'next', runId: run.runId });
    expect(run.status).toBe('waiting');
    expect(run.actions.some(({ stepId }) => stepId === 'publish')).toBe(false);
    await expect(
      fs.access(path.join(project, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
    return run;
  }
  async function decide(project: string, run: WorkflowRun, choice: string) {
    const wait = run.waits.at(-1)!;
    return dispatch(project, {
      operation: 'resolve-wait',
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: `${wait.id}-${choice}`,
      choice,
    });
  }
  it('loads the public factory from the npm package and completes generation, edited approval, and local publication across processes', async () => {
    const project = path.join(temporary, 'approved-project');
    let run = await prepare(project);
    const report = (
      run.waits[0].proposal as { outputs: { generate: { compose: { ref: string } } } }
    ).outputs.generate.compose;
    const edited = '# Consumer report\n\nActual edit approved in a later process.\n';
    await fs.writeFile(path.join(project, report.ref), edited);
    run = await decide(project, run, 'revise');
    run = await executePending(project, run);
    expect(run.waits.at(-1)!.stepId).toBe('approve-revision');
    run = await decide(
      project,
      await dispatch(project, { operation: 'inspect', runId: run.runId }),
      'approved',
    );
    run = await executePending(project, run);
    expect(run.status).toBe('completed');
    const published = run.outputs.publish.value as { ref: string };
    expect(await fs.readFile(path.join(project, published.ref), 'utf8')).toBe(edited);
    expect((await dispatch(project, { operation: 'inspect', runId: run.runId })).runId).toBe(
      'same-report',
    );
    if (process.env.COMET_REPORT_EVIDENCE_DIR)
      await fs.cp(
        path.join(project, '.comet'),
        path.join(process.env.COMET_REPORT_EVIDENCE_DIR, 'packed-approved-project/.comet'),
        { recursive: true },
      );
  }, 120000);
  it('discloses approval guidance from the real packed public inspect without changing the Wait or inventing an Action', async () => {
    const project = path.join(temporary, 'waiting-guidance-project');
    const waiting = await prepare(project);
    const request = path.join(temporary, 'waiting-guidance-inspect.json');
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: waiting.runId }));
    const raw = execFileSync(
      process.execPath,
      [
        path.join(packageRoot, 'bin/comet.js'),
        'runtime',
        'dispatch',
        '--application',
        'local-report',
        '--project-root',
        project,
        '--request',
        request,
        '--json',
      ],
      { cwd: consumer, encoding: 'utf8', timeout: 30000 },
    );
    const response = JSON.parse(raw);
    expect(response.status).toBe('succeeded');
    expect(response.skillWork).toEqual([]);
    expect(response.waitSkillWork).toHaveLength(1);
    expect(response.waitSkillWork[0]).toMatchObject({
      waitId: waiting.waits[0].id,
      proposalHash: waiting.waits[0].proposalHash,
      binding: { workflowId: 'report-publishing', stepId: 'approve', usage: 'guidance' },
      skill: { id: 'logical-review-guide', name: 'actual-report-review' },
    });
    expect(response.waitSkillWork[0].skill.files['SKILL.md']).toContain('Read the actual report');
    expect(response.waitSkillWork[0]).not.toHaveProperty('actionId');
    expect(response.data.revision).toBe(waiting.revision);
    expect(response.data.waits[0].status).toBe('pending');
    expect(response.data.waits[0].decision).toBeUndefined();
    if (process.env.COMET_REPORT_EVIDENCE_DIR)
      await fs.writeFile(
        path.join(process.env.COMET_REPORT_EVIDENCE_DIR, 'packed-waiting-guidance.json'),
        JSON.stringify(response, null, 2),
      );
  }, 120000);
  it('keeps a same-named Run in another project isolated and rejects without publication', async () => {
    const project = path.join(temporary, 'rejected-project');
    let run = await prepare(project);
    run = await decide(project, run, 'rejected');
    run = await executePending(project, run);
    expect(run.status).toBe('completed');
    expect(run.outputs.rejected.value).toEqual({ status: 'rejected' });
    expect(run.outputs.publish).toBeUndefined();
    if (process.env.COMET_REPORT_EVIDENCE_DIR)
      await fs.cp(
        path.join(project, '.comet'),
        path.join(process.env.COMET_REPORT_EVIDENCE_DIR, 'packed-rejected-project/.comet'),
        { recursive: true },
      );
    await expect(
      fs.access(path.join(project, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
  }, 120000);
});
