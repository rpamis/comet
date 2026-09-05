import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultCometPluginBridge } from '../../dist/domains/comet-plugin/integration.js';
import { seedCometReferences } from './seed-project-knowledge.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
if (!output) throw new Error('Pass --output=<empty experiment directory>');
const root = path.resolve(output);
const repetitions = Number(
  process.argv.find((arg) => arg.startsWith('--repetitions='))?.slice(14) ?? 2,
);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5)
  throw new Error('Repetitions must be 1..5');
const model = process.argv.find((arg) => arg.startsWith('--model='))?.slice(8);
if (!model) throw new Error('Pass --model=<host model> to keep all runs comparable');
const codexEntry =
  process.env.COMET_EVAL_CODEX_ENTRY ??
  path.join(path.dirname(process.execPath), 'node_modules/@openai/codex/bin/codex.js');
const tasks = [
  {
    id: 'feedback-extension',
    task: '为上下文采用反馈增加可选 sourceNote 说明，CLI 提交后，进程重启和日志投递失败重试也要保留，Dashboard 能看到。请调查当前实现，给出最小修改方案和验证方法，特别检查重复反馈是否会重复计数。只做方案，不修改代码。',
    groups: [
      ['domains/agent-learning/context-director.ts'],
      ['domains/comet-plugin/integration.ts'],
      ['app/commands/comet-task.ts'],
      ['domains/dashboard/web/src/main.jsx'],
      [
        'test/domains/comet-plugin/plugin-integration.test.ts',
        'test/domains/agent-learning/agent-learning.test.ts',
      ],
    ],
  },
  {
    id: 'worktree-freshness',
    task: '调查 Project Knowledge 在两个 worktree 切换时出现旧来源状态的可能链路，设计最小修复与回归方案。要求同一仓库身份仍可关联，但工作树 B 的索引和源码来源状态不能覆盖 A；同大小同修改时间的内容变化也必须识别。只做方案，不修改代码。',
    groups: [
      ['platform/paths/project-knowledge-storage.ts'],
      ['domains/project-knowledge/index-store.ts'],
      ['domains/project-knowledge/local-store.ts'],
      ['domains/project-knowledge/readiness.ts'],
      ['test/domains/project-knowledge/project-knowledge-store.test.ts'],
    ],
  },
  {
    id: 'classic-state-extension',
    task: '计划给 Classic change 的 .comet.yaml 增加可选字段 retry_reason（字符串），支持通过现有 state set 写入并被 validate 识别，升级后安装的命令也要支持。请给出具体改动位置和最小验证方案；不改变 Native 状态机。只做方案，不修改代码。',
    groups: [
      ['domains/comet-classic/classic-state-command.ts'],
      ['domains/comet-classic/classic-validate-command.ts'],
      ['test/domains/comet-classic/comet-scripts.test.ts'],
      ['build:classic-runtime', 'scripts/build/build-classic-runtime.mjs'],
      ['check:generated', 'comet-state.mjs', 'comet-yaml-validate.mjs'],
    ],
  },
];

// Freeze one source snapshot before any model runs. The grading rubric and seed
// catalog stay outside each workload; no task patch or hidden test is supplied.
const files = execFileSync(
  'git',
  [
    'ls-files',
    '-z',
    '--',
    'AGENTS.md',
    'package.json',
    'config',
    'app',
    'domains',
    'platform',
    'scripts/build',
    'test/domains',
    'test/repository',
    'assets/manifest.json',
  ],
  { cwd: repository, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
// Include currently untracked product files, because the experiment validates the working tree.
files.push(
  ...execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z', '--', 'app', 'domains', 'platform'],
    { cwd: repository, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean),
);
const frozen = [];
const snapshotHash = createHash('sha256');
for (const file of [...new Set(files)].sort()) {
  const content = await readFile(path.join(repository, file));
  snapshotHash.update(file).update('\0').update(content);
  frozen.push([file, content]);
}
const snapshotId = snapshotHash.digest('hex');
await mkdir(root, { recursive: false });
const sourceRoot = path.join(root, 'snapshot');
for (const [file, content] of frozen) {
  const target = path.join(sourceRoot, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
const runs = [];
for (const task of tasks) {
  for (let replication = 1; replication <= repetitions; replication++) {
    // Counterbalance order to reduce a fixed first-run effect.
    for (const mode of replication % 2 ? ['none', 'knowledge'] : ['knowledge', 'none']) {
      const runId = `${task.id}-${replication}-${mode}`;
      const worktree = path.join(root, runId);
      await mkdir(worktree);
      // Stop Git discovery at the frozen workload instead of its parent checkout.
      execFileSync('git', ['init', '--quiet'], { cwd: worktree, stdio: 'ignore' });
      for (const [file] of frozen) {
        const target = path.join(worktree, file);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(sourceRoot, file), target);
      }
      let context = '';
      let candidateIds = [];
      if (mode === 'knowledge') {
        const cacheRoot = path.join(root, `${runId}-cache`);
        const { projectId } = await seedCometReferences(worktree, cacheRoot);
        const bridge = await createDefaultCometPluginBridge({
          projectRoot: worktree,
          projectId,
          knowledgeCacheRoot: cacheRoot,
          stateRoot: path.join(cacheRoot, 'state'),
          memoryRoot: path.join(cacheRoot, 'memory'),
          language: 'zh-CN',
        });
        const contributions = await bridge.collectContext({ task: task.task, charBudget: 4500 });
        const manifest = contributions.flatMap((entry) => entry.manifest ?? []);
        candidateIds = manifest.map((entry) => entry.expansionId);
        await mkdir(path.join(worktree, '.knowledge'));
        for (let index = 0; index < manifest.length; index++) {
          const item = manifest[index];
          const expansion = await bridge.expandContext(item.expansionId, { task: task.task });
          await writeFile(
            path.join(worktree, '.knowledge', `${index}.json`),
            JSON.stringify(expansion, null, 2),
          );
        }
        context = `\n以下是实际 Comet 任务检索返回的参考候选，按需读取对应 .knowledge/<序号>.json 查看完整内容并复核源码：\n${manifest.map((item, index) => `${index}. ${item.title}: ${item.summary}`).join('\n')}`;
      }
      const prompt = `${task.task}\n仅在当前目录调查，不访问父目录、其他实验或用户记忆。最多使用 6 次 shell 工具调用；允许在一次调用内读取多份相关文件。最终用中文给出不超过 800 字的方案，列出精确仓库相对路径和验证命令。不可联网，不可修改文件，不运行测试。本轮只评价变更方案。${context}`;
      const answerPath = path.join(root, `${runId}.answer.md`);
      const args = [
        codexEntry,
        'exec',
        '--ignore-user-config',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--model',
        model,
        '-c',
        'model_reasoning_effort="low"',
        '-C',
        worktree,
        '--json',
        '-o',
        answerPath,
        '-',
      ];
      const started = Date.now();
      console.log(`START ${runId}`);
      const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
          cwd: worktree,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, 180_000);
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('error', (error) => {
          clearTimeout(timer);
          resolve({ exitCode: null, error: error.message, timedOut, stdout, stderr });
        });
        child.on('close', (exitCode) => {
          clearTimeout(timer);
          resolve({ exitCode, timedOut, stdout, stderr });
        });
        child.stdin.on('error', () => {});
        child.stdin.end(prompt);
      });
      const answer = await readFile(answerPath, 'utf8').catch(() => '');
      const events = result.stdout.split(/\r?\n/u).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      const toolCalls = events.filter(
        (event) => event.type === 'item.completed' && event.item?.type === 'command_execution',
      ).length;
      const usage = events.findLast((event) => event.type === 'turn.completed')?.usage;
      const covered = task.groups.map((group) => group.some((term) => answer.includes(term)));
      const run = {
        runId,
        taskId: task.id,
        replication,
        mode,
        model,
        snapshotId,
        candidateIds,
        toolCalls,
        usage,
        latencyMs: Date.now() - started,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        error: result.error,
        coverage: answer ? covered.filter(Boolean).length / covered.length : null,
        missingGroups: task.groups.filter((_, index) => !covered[index]),
        answerFile: path.basename(answerPath),
      };
      runs.push(run);
      // Persist evidence after each workload. Do not save stderr/config/auth or raw logs.
      await writeFile(
        path.join(root, 'report.json'),
        JSON.stringify(
          {
            schema: 'comet.project-knowledge.planning-ab.v1',
            limitation:
              'Read-only planning probe. Path coverage is a checklist, not proof of implemented behavior or causal improvement. Failed and timed-out runs are retained.',
            runs,
          },
          null,
          2,
        ),
      );
      console.log(
        `END ${runId}: exit=${run.exitCode}, coverage=${run.coverage}, tools=${toolCalls}`,
      );
      if (result.exitCode !== 0 && runs.every((entry) => entry.exitCode !== 0))
        throw new Error(
          'Host model workload unavailable; see retained report. No successful model evaluation is claimed.',
        );
    }
  }
}
