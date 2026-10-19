import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  previewWorkflowApplicationEval,
  runWorkflowApplicationEval,
} from '../../../domains/eval/application-eval.js';
import { evalProjectIdentity } from '../../../domains/eval/eval-run-cleanup.js';
import { runManagedEvalWorker } from '../../../domains/eval/eval-run-entry.js';
import {
  finishCliEvalTracking,
  registerCliEvalRun,
  requestStopEvalRun,
} from '../../../domains/eval/eval-run-manager.js';
import { evalRunPath, readEvalRun, writeEvalJson } from '../../../domains/eval/eval-run-store.js';
import { prepareWorkflowApplicationExample } from '../../../domains/workflow-generation/index.js';
import {
  ExternalCommandError,
  runExternalCommandAsync,
} from '../../../platform/process/external-command.js';

let packageRoot: string;
vi.mock('../../../domains/eval/eval-run-preview.js', () => ({
  get evalPackageRoot() {
    return packageRoot;
  },
  previewEvalRun: vi.fn(async (_project: string, config: unknown) => ({
    config,
    target: { name: 'sleep-only-fixture' },
    confirmationHash: 'preview',
    taskSource: 'authored',
    blockedReasons: [],
  })),
}));

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const enabled = process.env.COMET_EVAL_DOCKER_INTEGRATION === '1';
const image = process.env.COMET_EVAL_DOCKER_IMAGE || 'alpine:3.21';

// 先准备 dist 和本地镜像；测试不执行 build、pull、模型请求或真实用户配置读取。
// COMET_EVAL_DOCKER_INTEGRATION=1 pnpm exec vitest run test/domains/eval/eval-container-cleanup.integration.test.ts
describe.skipIf(!enabled)(
  'real Docker Eval cleanup (opt in with COMET_EVAL_DOCKER_INTEGRATION=1)',
  () => {
    let project: string;
    let identity: string;
    let runId: string;
    let sentinelId: string;
    let dockerReady: boolean;
    let worker: Promise<void> | undefined;
    let application: Promise<unknown> | undefined;

    async function docker(args: string[]): Promise<string> {
      return (
        await runExternalCommandAsync('docker', args, {
          cwd: project,
          env: process.env,
          timeoutMs: 15_000,
        })
      ).trim();
    }

    async function workloadContainers(all = false): Promise<string[]> {
      const ids = await docker([
        'ps',
        ...(all ? ['--all'] : []),
        '--quiet',
        '--filter',
        `label=comet.eval.integration.workload=${identity}`,
      ]);
      return ids.split(/\s+/u).filter(Boolean);
    }

    async function expectRunningWorkload(): Promise<void> {
      await expect.poll(() => workloadContainers(), { timeout: 15_000 }).toHaveLength(1);
      const [id] = await workloadContainers();
      expect(
        await docker([
          'inspect',
          '--format',
          '{{index .Config.Labels "comet.eval.experiment"}}',
          id,
        ]),
      ).toBe(runId);
    }

    async function expectScopedCleanup(): Promise<void> {
      await expect.poll(() => workloadContainers(true), { timeout: 10_000 }).toEqual([]);
      expect(await docker(['inspect', '--format', '{{.State.Running}}', sentinelId])).toBe('true');
    }

    beforeEach(async () => {
      project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-real-docker-'));
      identity = randomUUID();
      runId = `integration-${identity}`;
      sentinelId = '';
      dockerReady = false;
      worker = undefined;
      application = undefined;
      const home = path.join(project, 'home');
      const dockerConfig = path.join(home, '.docker');
      await fs.mkdir(dockerConfig, { recursive: true });
      vi.spyOn(os, 'homedir').mockReturnValue(home);
      for (const [name, value] of Object.entries({
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        DOCKER_CONFIG: dockerConfig,
        COMET_DATA_DIR: path.join(home, '.comet'),
      }))
        vi.stubEnv(name, value);
      for (const name of [
        'DOCKER_CONTEXT',
        'DOCKER_AUTH_CONFIG',
        'DOCKER_CERT_PATH',
        'DOCKER_TLS',
        'DOCKER_TLS_VERIFY',
        'COMET_APPLICATION_EVAL_CONTEXT',
        'COMET_EVAL_MANAGED',
        'COMET_EVAL_MANAGED_JUDGE',
        'COMET_EVAL_CASE_SELECTION',
        'COMET_EVAL_EXPERIMENT_ID',
      ])
        vi.stubEnv(name, undefined);

      await docker(['info', '--format', '{{.ServerVersion}}']).catch((error) => {
        throw new Error(
          'COMET_EVAL_DOCKER_INTEGRATION=1 requires Docker and a running daemon reachable without user configuration (set DOCKER_HOST when necessary).',
          { cause: error },
        );
      });
      dockerReady = true;
      const imageId = await docker(['image', 'inspect', '--format', '{{.Id}}', image]).catch(
        (error) => {
          throw new Error(
            `Docker integration image ${image} must already be present locally; this test never pulls images.`,
            { cause: error },
          );
        },
      );
      expect(imageId).toMatch(/^sha256:[a-f0-9]{64}$/u);

      const workspace = path.join(project, 'workspace');
      packageRoot = path.join(project, 'cli-fixture');
      await fs.mkdir(workspace);
      await fs.mkdir(path.join(packageRoot, 'bin'), { recursive: true });
      const sleepScript = path.join(project, 'sleep-only.sh');
      // 忽略客户端转发的信号，确认由实验容器清理结束，而非宿主子进程退出顺带结束。
      await fs.writeFile(
        sleepScript,
        "#!/bin/sh\ntrap '' TERM INT HUP\nwhile :; do sleep 300; done\n",
        {
          mode: 0o755,
        },
      );
      const launchScript = path.join(project, 'launch.sh');
      await fs.writeFile(
        launchScript,
        `source "$1"
resolve_runtime_image() { printf '%s' ${JSON.stringify(imageId)}; }
prepare_agent_workspace_owner() { :; }
build_env_args() { ENV_ARGS=(--label "comet.eval.integration=${identity}" --label "comet.eval.integration.workload=${identity}"); }
build_agent_runtime_mount_args() { RUNTIME_CONFIG_MOUNT_ARGS=(); RUNTIME_CONFIG_TMPFS_ARGS=(); }
build_plugin_args() { PLUGIN_MOUNT_ARGS=(); PLUGIN_CLI_ARGS=(); }
build_langfuse_plugin_args() { LANGFUSE_PLUGIN_MOUNT_ARGS=(); LANGFUSE_PLUGIN_CLI_ARGS=(); }
build_trusted_oracle_mount_args() { TRUSTED_ORACLE_MOUNT_ARGS=(); }
SLEEP_SCRIPT="$3"
prepare_eval_runtime_data() {
  COMET_RUNTIME_MOUNT_ARGS=(--pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint //usr/local/bin/sleep-only -v "$SLEEP_SCRIPT://usr/local/bin/sleep-only:ro")
}
docker_run_agent_loop "$2" 'Sleep-only integration fixture' --agent codex --max-turns 1
`,
      );
      await fs.writeFile(
        path.join(packageRoot, 'bin/comet.js'),
        `const { spawnSync } = require('node:child_process');
const result = spawnSync('bash', ${JSON.stringify([
          launchScript,
          path.join(repositoryRoot, 'eval/scaffold/shell/docker.sh'),
          workspace,
          sleepScript,
        ])}, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`,
      );
      // 另一项目复用实验 ID，清理仍必须以项目归属隔离。
      const otherProject = path.join(project, 'other-project');
      await fs.mkdir(otherProject);
      sentinelId = await docker([
        'run',
        '--detach',
        '--rm',
        '--pull',
        'never',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--label',
        `comet.eval.integration=${identity}`,
        '--label',
        `comet.eval.experiment=${runId}`,
        '--label',
        `comet.eval.project=${await evalProjectIdentity(otherProject)}`,
        '--entrypoint',
        '/bin/sh',
        imageId,
        '-c',
        'exec sleep 300',
      ]);
    });

    afterEach(async () => {
      try {
        if (worker) {
          await requestStopEvalRun(project, runId).catch(() => {});
          await worker.catch(() => {});
        }
        await application?.catch(() => {});
        if (dockerReady) {
          const ids = (
            await docker([
              'ps',
              '--all',
              '--quiet',
              '--filter',
              `label=comet.eval.integration=${identity}`,
            ])
          )
            .split(/\s+/u)
            .filter(Boolean);
          if (ids.length) await docker(['rm', '--force', ...ids]);
        }
      } finally {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        await fs.rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
      }
    });

    it('stops a real managed Skill worker and removes only its experiment container', async () => {
      const at = new Date().toISOString();
      await writeEvalJson(await evalRunPath(project, runId, 'dashboard-run.json'), {
        schema: 'comet.eval.managed-run.v1',
        id: runId,
        origin: 'dashboard',
        createdAt: at,
        updatedAt: at,
        status: 'queued',
        config: {
          target: 'sleep-only-fixture',
          targetType: 'skill',
          agent: 'codex',
          model: 'fixture-model',
          timeoutSeconds: 30,
          maxTurns: 1,
        },
        targetId: 'sleep-only-fixture',
        contentHash: 'content',
        previewHash: 'preview',
      });
      worker = runManagedEvalWorker(project, runId);
      void worker.catch(() => {});
      await expectRunningWorkload();
      await requestStopEvalRun(project, runId);
      await worker;
      expect((await readEvalRun(project, runId)).executionStatus).toBe('stopped');
      await expectScopedCleanup();
    }, 60_000);

    it('cleans the application container after the outer command timeout and preserves another experiment', async () => {
      await fs
        .access(path.join(repositoryRoot, 'dist/domains/workflow-application/index.js'))
        .catch((error) => {
          throw new Error(
            'Compile the application exports with pnpm exec tsc before enabling this integration test.',
            { cause: error },
          );
        });
      await fs.mkdir(path.join(project, 'node_modules/@rpamis'), { recursive: true });
      await fs.symlink(
        repositoryRoot,
        path.join(project, 'node_modules/@rpamis/comet'),
        'junction',
      );
      const file = await prepareWorkflowApplicationExample({
        projectRoot: project,
        packageRoot: path.join(project, 'application'),
        base: 'standalone',
      });
      const options = {
        file,
        projectRoot: project,
        settings: { agent: 'codex', model: 'fixture-model', timeoutSeconds: 30, maxTurns: 1 },
      };
      const preview = await previewWorkflowApplicationEval(options);
      await registerCliEvalRun(project, {
        id: runId,
        status: 'generating',
        targetId: preview.application.id,
        contentHash: preview.application.contentHash,
        previewHash: preview.confirmationHash,
        config: { target: file, targetType: 'application', ...preview.settings, suite: 'local' },
      });
      let timedOut = false;
      const pending = runWorkflowApplicationEval({
        ...options,
        experimentId: runId,
        confirmationHash: preview.confirmationHash,
        executeCommand: (_command, _args, commandOptions) =>
          runExternalCommandAsync(process.execPath, [path.join(packageRoot, 'bin/comet.js')], {
            ...commandOptions,
            timeoutMs: 8000,
          }).catch((error) => {
            timedOut = error instanceof ExternalCommandError && error.timedOut;
            throw error;
          }),
      });
      application = pending;
      void pending.catch(() => {});
      await expectRunningWorkload();
      const result = await pending;
      await finishCliEvalTracking(project, runId);
      expect(timedOut).toBe(true);
      expect(result.status).toBe('incomplete');
      expect((await readEvalRun(project, runId)).executionStatus).toBe('interrupted');
      await expectScopedCleanup();
    }, 60_000);
  },
);
