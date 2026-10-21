import { evalMatrix } from '../../helpers/eval-matrix.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runManagedEvalWorker } from '../../../domains/eval/eval-run-entry.js';
import { requestStopEvalRun } from '../../../domains/eval/eval-run-manager.js';
import { previewEvalRun, type EvalRunPreview } from '../../../domains/eval/eval-run-preview.js';
import { readEvalRun, writeEvalJson, evalRunPath } from '../../../domains/eval/eval-run-store.js';
let packageRoot: string;
vi.mock('../../../domains/eval/eval-run-preview.js', () => ({
  get evalPackageRoot() {
    return packageRoot;
  },
  previewEvalRun: vi.fn(async (_project: string, config: unknown) => ({
    config,
    target: { name: 'writer' },
    confirmationHash: 'preview',
    taskSource: 'authored',
    blockedReasons: [],
  })),
}));
vi.mock('../../../platform/process/external-command.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../platform/process/external-command.js')>();
  return {
    ...actual,
    runExternalCommandAsync: vi.fn(async (command, args, options) =>
      command === 'docker' ? '' : actual.runExternalCommandAsync(command, args, options),
    ),
  };
});
describe('managed Eval worker process', () => {
  let project: string;
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-worker-'));
    packageRoot = path.join(project, 'package');
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(project, 'home'));
    vi.stubEnv('COMET_EVAL_MANAGED', process.env.COMET_EVAL_MANAGED);
    vi.stubEnv('COMET_EVAL_MANAGED_JUDGE', process.env.COMET_EVAL_MANAGED_JUDGE);
    vi.stubEnv('COMET_EVAL_CASE_SELECTION', process.env.COMET_EVAL_CASE_SELECTION);
    await fs.mkdir(path.join(packageRoot, 'bin'), { recursive: true });
    await writeEvalJson(await evalRunPath(project, 'worker-run', 'dashboard-run.json'), {
      schema: 'comet.eval.managed-run.v1',
      id: 'worker-run',
      origin: 'dashboard',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued',
      config: {
        target: 'skill',
        targetType: 'skill',
        agent: 'codex',
        model: 'fixture-model',
        timeoutSeconds: 30,
        maxTurns: 5,
      },
      targetId: 'writer',
      contentHash: 'content',
      previewHash: 'preview',
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  it('rejects a pending launch before registering or running a worker', async () => {
    const file = await evalRunPath(project, 'worker-run', 'dashboard-run.json');
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    record.launchPhase = 'pending';
    await writeEvalJson(file, record);
    await expect(runManagedEvalWorker(project, 'worker-run')).rejects.toThrow('尚未持久化');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).owner).toBeUndefined();
    await expect(
      fs.stat(await evalRunPath(project, 'worker-run', 'container-ownership.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('runs a real harmless child process and indexes its result under the original identity', async () => {
    await fs.writeFile(
      path.join(packageRoot, 'bin/comet.js'),
      `
      const fs=require('node:fs'),path=require('node:path');
      const project=process.argv[process.argv.indexOf('--project')+1];
      const root=path.join(project,'.comet/eval/runs',process.env.COMET_EVAL_EXPERIMENT_ID);
      fs.mkdirSync(path.join(root,'reports'),{recursive:true});
      fs.writeFileSync(path.join(root,'metadata.json'),JSON.stringify({experiment_id:process.env.COMET_EVAL_EXPERIMENT_ID,completed_at:'2026-10-11T00:00:00Z',expected_case_matrix:{case_count:1}}));
      fs.writeFileSync(path.join(root,'reports/task_report.json'),JSON.stringify({name:'task-BASE',rep:1,passed:true,checks_passed:[],checks_failed:[],sample_quality:{status:'included'},events_summary:{task:'task',treatment:'BASE',sample:1,case_manifest:{task_hash:'task',validator_hash:'rule'}}}));
      fs.writeFileSync(path.join(root,'expected-case-matrix.json'), ${JSON.stringify(JSON.stringify(evalMatrix([{ task: 'task', treatment: 'BASE', rep: 1 }])))});
      console.log('scripted evaluation finished');
      const text=Buffer.from('真实评估完成');process.stdout.write(text.subarray(0,1));setTimeout(()=>process.stdout.write(text.subarray(1)),50);
    `,
    );
    await runManagedEvalWorker(project, 'worker-run');
    const run = await readEvalRun(project, 'worker-run');
    expect(run.executionStatus).toBe('completed');
    expect(run.conclusion).toBe('passed');
    expect(
      await fs.readFile(await evalRunPath(project, 'worker-run', 'execution.log'), 'utf8'),
    ).toContain('scripted evaluation finished');
    expect(
      await fs.readFile(await evalRunPath(project, 'worker-run', 'execution.log'), 'utf8'),
    ).toContain('真实评估完成');
  }, 30000);
  it('stops an owned child through its run request and preserves incomplete evidence', async () => {
    await fs.writeFile(
      path.join(packageRoot, 'bin/comet.js'),
      `console.log('waiting for stop');setInterval(()=>{},1000);`,
    );
    const worker = runManagedEvalWorker(project, 'worker-run');
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const record = JSON.parse(
        await fs.readFile(await evalRunPath(project, 'worker-run', 'dashboard-run.json'), 'utf8'),
      );
      if (record.child) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(ready).toBe(true);
    await requestStopEvalRun(project, 'worker-run');
    await worker;
    const run = await readEvalRun(project, 'worker-run');
    expect(run.executionStatus).toBe('stopped');
    expect(run.conclusion).toBe('incomplete');
  }, 30000);
  it('records live activity before the child exits and redacts activity messages', async () => {
    vi.stubEnv('BENCH_API_KEY', 'fake-private-progress-key');
    await fs.writeFile(
      path.join(packageRoot, 'bin/comet.js'),
      `
      const fs=require('node:fs'),path=require('node:path');
      const project=process.argv[process.argv.indexOf('--project')+1];
      const root=path.join(project,'.comet/eval/runs',process.env.COMET_EVAL_EXPERIMENT_ID);
      fs.writeFileSync(path.join(root,'progress.json'),JSON.stringify({schema:'comet.eval.progress.v1',runId:'worker-run',phase:'running',updatedAt:new Date().toISOString(),activities:[{id:'event-1',at:new Date().toISOString(),kind:'tool',message:'Read '+process.env.BENCH_API_KEY}]}));
      setTimeout(()=>{fs.writeFileSync(path.join(root,'metadata.json'),JSON.stringify({completed_at:new Date().toISOString()}));},2500);
    `,
    );
    const pending = runManagedEvalWorker(project, 'worker-run');
    let log = '';
    for (let attempt = 0; attempt < 50; attempt++) {
      log = await fs
        .readFile(await evalRunPath(project, 'worker-run', 'execution.log'), 'utf8')
        .catch(() => '');
      if (log.includes('[进度')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(log).toContain('[进度');
    expect(log).toContain('[redacted]');
    expect(log).not.toContain('fake-private-progress-key');
    await pending;
  }, 30000);
  it('passes an owned selection file to a real child and keeps retry results out of full baselines', async () => {
    const file = await evalRunPath(project, 'worker-run', 'dashboard-run.json');
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    record.config.retrySourceRunId = 'original';
    await writeEvalJson(file, record);
    vi.mocked(previewEvalRun).mockResolvedValueOnce({
      config: record.config,
      target: { name: 'writer' },
      confirmationHash: 'preview',
      taskSource: 'failed-retry',
      blockedReasons: [],
      retry: {
        sourceRunId: 'original',
        cases: [
          {
            task: 'failed',
            treatment: 'DYNAMIC_SKILL',
            repetition: 2,
            caseHash: 'fixed',
            validatorHash: 'rule',
          },
        ],
      },
    } as EvalRunPreview);
    await fs.writeFile(
      path.join(packageRoot, 'bin/comet.js'),
      `
      const fs=require('node:fs'),path=require('node:path');
      const marker=process.env.COMET_EVAL_CASE_SELECTION;
      if(!marker.startsWith('@')) throw new Error('selection file missing');
      const selected=JSON.parse(fs.readFileSync(marker.slice(1),'utf8'));
      if(selected.cases.length!==1||selected.cases[0].task!=='failed'||selected.cases[0].repetition!==2) throw new Error('wrong selection');
      const root=path.dirname(marker.slice(1));fs.mkdirSync(path.join(root,'reports'),{recursive:true});
      fs.writeFileSync(path.join(root,'metadata.json'),JSON.stringify({experiment_id:process.env.COMET_EVAL_EXPERIMENT_ID,completed_at:'2026-10-11',expected_case_matrix:{case_count:1}}));
      fs.writeFileSync(path.join(root,'expected-case-matrix.json'), ${JSON.stringify(JSON.stringify(evalMatrix([{ task: 'failed', treatment: 'DYNAMIC_SKILL', rep: 2 }])))});
      fs.writeFileSync(path.join(root,'reports/failed_report.json'),JSON.stringify({name:'failed-DYNAMIC_SKILL-r2',passed:true,rep:2,sample_quality:{status:'included'},events_summary:{task:'failed',treatment:'DYNAMIC_SKILL',sample:2,case_manifest:{task_hash:'fixed',validator_hash:'rule'}}}));
    `,
    );
    await runManagedEvalWorker(project, 'worker-run');
    const run = await readEvalRun(project, 'worker-run');
    expect(run.conclusion).toBe('incomplete');
    expect(run.subsetConclusion).toBe('passed');
    expect(run.baselineEligible).toBe(false);
    expect(run.cases[0].repetition).toBe(2);
  }, 30000);
});
