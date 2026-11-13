import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isolatedBenchmarkEnvironment,
  directorySnapshot,
  restoreSnapshot,
} from './runtime-coldstart-benchmark.mjs';

const script = fileURLToPath(import.meta.url);
const repository = path.resolve(path.dirname(script), '../..');

export function scaleCounts(value, fallback) {
  if (value === 'none') return [];
  const counts = value === undefined ? fallback : value.split(',').map(Number);
  if (
    !counts.length ||
    counts.some((count) => !Number.isSafeInteger(count) || count < 0 || count > 100_000)
  )
    throw new Error('Scale counts must be integers between 0 and 100000');
  return [...new Set(counts)].sort((a, b) => a - b);
}

/** Git 自身记录所有进程的启动，覆盖 CLI 及其后代，不能用父进程计数冒充总量。 */
export function countGitTraceStarts(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .reduce((count, line) => {
      const event = JSON.parse(line);
      return count + (event.event === 'start' ? 1 : 0);
    }, 0);
}

/** Platform task reports and SDK history; setup and restoration are not timed. */
export async function runWorkflowScaleBenchmark(options = {}) {
  const packageRoot = path.resolve(options.packageRoot ?? repository);
  const runs = options.runs ?? 3,
    warmups = options.warmups ?? 1;
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(warmups) || warmups < 0)
    throw new Error('Invalid scale benchmark sample counts');
  if (['fileCounts', 'dirtyCounts', 'snapshotMaxFiles'].some((key) => Object.hasOwn(options, key)))
    throw new Error(
      'File snapshot benchmarks have been removed; use acceptanceCounts and historyCounts.',
    );
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const base = await fs.mkdtemp(path.join(temporaryRoot, 'comet-workflow-scale-'));
  const home = path.join(base, 'home');
  await fs.mkdir(home);
  const previous = { ...process.env },
    env = isolatedBenchmarkEnvironment(home);
  Object.assign(process.env, env);
  const rows = [];
  const load = (ref) => import(pathToFileURL(path.join(packageRoot, 'dist', ref)).href);
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || 'Fixture Git failed');
    return result.stdout.trim();
  };
  const initialize = async (name) => {
    const root = path.join(base, name);
    await fs.mkdir(root);
    git(root, 'init', '-b', 'main');
    return root;
  };
  const commit = (root) => {
    git(root, 'add', '.');
    git(
      root,
      '-c',
      'user.name=Comet benchmark',
      '-c',
      'user.email=benchmark@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    );
  };
  try {
    const { withCometRuntimeMetrics } = await load('platform/process/runtime-metrics.js');
    async function measure(name, operation, prepare, metadata = {}) {
      const samples = [];
      for (let index = -warmups; index < runs; index++) {
        await prepare?.();
        const trace = path.join(base, 'git-trace.jsonl');
        await fs.writeFile(trace, '');
        env.GIT_TRACE2_EVENT = trace;
        process.env.GIT_TRACE2_EVENT = trace;
        const start = performance.now();
        const { result, metrics } = await withCometRuntimeMetrics(operation);
        const milliseconds = performance.now() - start;
        const gitCommands = countGitTraceStarts(await fs.readFile(trace, 'utf8'));
        if (gitCommands < metrics.gitCommands)
          throw new Error('Git process tracing is incomplete; do not report this sample');
        if (index < 0) continue;
        samples.push({
          milliseconds,
          gitCommands,
          parentGitCommands: metrics.gitCommands,
          responseBytes: Buffer.byteLength(JSON.stringify(result) ?? ''),
        });
      }
      const sorted = samples.map((sample) => sample.milliseconds).sort((a, b) => a - b);
      const row = {
        name,
        ...metadata,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p95ObservedMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
        samples,
      };
      rows.push(row);
      options.onResult?.(row);
      return row;
    }
    const cli = (root, args) => {
      const result = spawnSync(
        process.execPath,
        [path.join(packageRoot, 'bin/comet.js'), ...args, '--json'],
        {
          cwd: root,
          env,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      if (result.status !== 0)
        throw new Error(result.stderr || result.stdout || 'Fixture CLI failed');
      const response = JSON.parse(result.stdout);
      if (response.exitCode && response.exitCode !== 0)
        throw new Error('Runtime returned failed envelope');
      return response;
    };
    for (const count of options.acceptanceCounts ?? [10, 100]) {
      if (count < 1) throw new Error('Acceptance scale must be positive');
      const root = await initialize(`acceptance-${count}`);
      commit(root);
      cli(root, ['native', 'new', 'benchmark']);
      const change = path.join(root, 'docs/comet/changes/benchmark');
      await fs.writeFile(
        path.join(change, 'brief.md'),
        '# Outcome\nPreserve each workflow behavior.\n# Scope\nWorkflow behavior.\n# Non-goals\nPublishing.\n# Acceptance examples\n' +
          Array.from(
            { length: count },
            (_, index) => `- Behavior ${index} remains available.\n`,
          ).join(''),
      );
      await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
      await fs.writeFile(
        path.join(change, 'specs/workflow/spec.md'),
        '# Workflow\n' +
          Array.from(
            { length: count },
            (_, index) =>
              `\n## Requirement: Behavior ${index}\nBehavior ${index} remains available.\n\nScenario: Existing behavior ${index}\n- WHEN queried\n- THEN behavior ${index} remains available\n`,
          ).join(''),
      );
      const { resolveWorkspaceRuntimeRootSync } = await load(
        'domains/workflow-contract/workspace-runtime.js',
      );
      const runtime = resolveWorkspaceRuntimeRootSync(root),
        relative = path.relative(home, runtime);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep))
        throw new Error('Acceptance fixture Runtime escaped isolated home');
      const task = cli(root, ['native', 'next', 'benchmark', '--session', 'benchmark-agent']);
      const report = path.join(root, 'shape-result.json');
      await fs.writeFile(
        report,
        JSON.stringify({
          status: 'succeeded',
          output: {
            acceptance: Array.from({ length: count }, (_, index) => ({
              source: 'specs/workflow/spec.md',
              text: 'Behavior ' + index + ' remains available.',
            })),
          },
        }),
      );
      const saved = await Promise.all([directorySnapshot(root), directorySnapshot(runtime)]);
      await measure(
        `native-sdk-shape-${count}`,
        () => {
          const response = cli(root, [
            'native',
            'next',
            'benchmark',
            '--session',
            'benchmark-agent',
            '--action',
            task.data.task.actionId,
            '--result',
            report,
          ]);
          if (!response.data?.next?.askUser || response.data?.state?.acceptance?.length !== count)
            throw new Error('Shape benchmark did not create the real approval Wait');
          return response;
        },
        async () => {
          await restoreSnapshot(root, saved[0]);
          await restoreSnapshot(runtime, saved[1]);
        },
        { dimension: 'acceptance', acceptanceCount: count, runtimeFormat: 'sdk' },
      );
    }
    for (const count of options.historyCounts ?? [10, 100]) {
      if (count < 1 || count > 1000)
        throw new Error('SDK history scale must be between 1 and 1000');
      const { createRuntime, createFileRuntimeStore } = await load('domains/engine/runtime.js');
      const steps = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `step-${index}`,
          {
            type: 'call_tool',
            ref: 'benchmark',
          },
        ]),
      );
      const runtimeOptions = {
        store: createFileRuntimeStore({ rootDir: path.join(base, `history-${count}`) }),
        workflows: [
          {
            id: 'benchmark-history',
            version: '1',
            entry: 'step-0',
            steps,
            transitions: Array.from({ length: count - 1 }, (_, index) => ({
              from: `step-${index}`,
              to: `step-${index + 1}`,
            })),
          },
        ],
        executors: [
          {
            id: 'benchmark',
            supports: () => true,
            execute: async () => ({
              status: 'succeeded',
              output: { summary: 'Fixture action executed.' },
            }),
          },
        ],
      };
      const runtime = createRuntime(runtimeOptions);
      let run;
      let execution = 0;
      await measure(
        `sdk-history-execute-${count}`,
        async () => {
          let executed = 0;
          while (run.status !== 'completed') {
            const action = run.actions.find((candidate) => candidate.status === 'pending');
            if (!action) throw new Error('History fixture stopped before completion');
            run = await runtime.execute({
              runId: run.runId,
              actionId: action.id,
              executorId: 'benchmark',
            });
            executed++;
          }
          if (executed !== count || run.actions.length !== count)
            throw new Error('History fixture did not execute every Action');
        },
        async () => {
          run = await runtime.start({
            runId: `history-${execution++}`,
            workflow: { id: 'benchmark-history', version: '1' },
            input: null,
          });
        },
        {
          dimension: 'sdk-history',
          actionCount: count,
          runtimeFormat: 'sdk',
          scope: 'real per-action execution with full Run returns; start excluded',
        },
      );
      const currentRuntime = createRuntime({
        ...runtimeOptions,
        executors: runtimeOptions.executors.map((executor) => ({ ...executor, includeRun: false })),
      });
      await measure(
        `sdk-history-current-execute-${count}`,
        async () => {
          const progress = await currentRuntime.runUntilBlockedCurrent({
            runId: run.runId,
            executorId: 'benchmark',
            maxActions: count,
          });
          if (
            progress.reason !== 'completed' ||
            progress.actionsExecuted !== count ||
            progress.run.history.actions !== count
          )
            throw new Error('Current-view benchmark did not execute every Action');
          run = progress.run;
        },
        async () => {
          run = await currentRuntime.start({
            runId: `current-history-${execution++}`,
            workflow: { id: 'benchmark-history', version: '1' },
            input: null,
          });
        },
        {
          dimension: 'sdk-history',
          actionCount: count,
          runtimeFormat: 'sdk',
          scope: 'real batch execution, current view and includeRun=false; start excluded',
        },
      );
      await measure(`sdk-history-read-${count}`, () => runtime.inspect(run.runId), null, {
        dimension: 'sdk-history',
        actionCount: count,
        runtimeFormat: 'sdk',
        scope: 'shared SDK store; not Native Supervisor end-to-end',
      });
    }
    if (!rows.length) throw new Error('No scale scenarios selected');
    const gitMetadata = (args) => {
      const result = spawnSync('git', ['-C', packageRoot, ...args], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return result.status === 0 ? result.stdout.trim() : null;
    };
    return {
      schema: 'comet.workflow-scale-benchmark.v1',
      complete: true,
      createdAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      cpu: os.cpus()[0]?.model,
      packageVersion: JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'))
        .version,
      sourceHead: options.sourceHead ?? gitMetadata(['rev-parse', 'HEAD']),
      workingTreeStatus: gitMetadata(['status', '--short']),
      benchmarkSha256: createHash('sha256')
        .update(await fs.readFile(script))
        .digest('hex'),
      daemon: 'off',
      gitCounting:
        'Git Trace2 start events across the operation and CLI descendants; setup excluded',
      timing:
        'warm filesystem; API operations in one process, acceptance through fresh CLI; setup and restore excluded',
      runs,
      warmups,
      rows,
    };
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    const resolved = await fs.realpath(base);
    if (
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith('comet-workflow-scale-')
    )
      throw new Error('Refusing cleanup outside the scale fixture');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const options = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const match =
        /^--(acceptance-counts|history-counts|runs|warmups|output|package-root|source-head)=(.+)$/u.exec(
          arg,
        );
      if (!match) throw new Error('Unknown scale benchmark option: ' + arg);
      return [match[1], match[2]];
    }),
  );
  const report = await runWorkflowScaleBenchmark({
    packageRoot: options['package-root'],
    sourceHead: options['source-head'],
    runs: options.runs === undefined ? 3 : Number(options.runs),
    warmups: options.warmups === undefined ? 1 : Number(options.warmups),
    acceptanceCounts: scaleCounts(options['acceptance-counts'], [10, 100]),
    historyCounts: scaleCounts(options['history-counts'], [10, 100]),
    onResult: (row) =>
      process.stderr.write(
        `${row.name}: ${row.medianMs.toFixed(1)} ms; Git=${row.samples.at(-1).gitCommands}\n`,
      ),
  });
  const output = path.resolve(
    options.output ?? path.join(os.tmpdir(), `comet-workflow-scale-${process.pid}.json`),
  );
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(output + '\n');
}
