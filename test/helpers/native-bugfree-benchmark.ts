import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkFrozenProjectAtBoundary } from './native-bugfree-oracle.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export interface FrozenBugfreeCase {
  id: string;
  requirements: string;
  expectedVerdict: string;
  boundary?: 'browser' | 'supervisor';
  bootstrap?: string;
  baselineFiles?: Record<string, string>;
  baselineFileHashes?: Record<string, string>;
  files: Record<string, string>;
  fileHashes: Record<string, string>;
  oracle: string;
  oracleSha256: string;
}

export interface FrozenBugfreeFlow {
  bootstrap?: string;
  id: string;
  kind: string;
  requirements: string;
  initialFiles: Record<string, string>;
  initialFileHashes: Record<string, string>;
  referenceFiles: Record<string, string>;
  referenceFileHashes: Record<string, string>;
  oracle: string;
  oracleSha256: string;
}

export interface FrozenBugfreeDataset {
  cases: FrozenBugfreeCase[];
  flows: FrozenBugfreeFlow[];
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export function assertFrozenBugfreeFiles(
  files: Record<string, string>,
  hashes: Record<string, string>,
) {
  assert.deepEqual(Object.keys(files).sort(), Object.keys(hashes).sort());
  for (const [file, text] of Object.entries(files)) assert.equal(digest(text), hashes[file], file);
}

/** 只运行仓库内冻结的判定代码；不调用 Agent、模型、容器或外部依赖。 */
export async function checkFrozenBugfreeProject(
  files: Record<string, string>,
  oracle: string,
  boundary?: 'browser' | 'supervisor',
  requirements = '',
  baselineFiles?: Record<string, string>,
) {
  return checkFrozenProjectAtBoundary(files, oracle, boundary, requirements, baselineFiles);
}

/** 隐藏标签、判定代码和参考修复均不写入参与评估的工作区。 */
export async function assembleFrozenBugfreeTasks(root: string, dataset: FrozenBugfreeDataset) {
  const skill = path.join(root, 'skill');
  await fs.mkdir(path.join(skill, 'comet'), { recursive: true });
  await fs.cp('assets/skills/comet-native', path.join(skill, 'comet-native'), { recursive: true });
  await fs.mkdir(path.join(skill, 'comet'), { recursive: true });
  await fs.cp('assets/skills/comet/reference', path.join(skill, 'comet/reference'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: comet-native\ndescription: Native workflow comparison fixture using the unchanged packaged Native Skill.\n---\n# Native comparison\nRead and follow [the packaged Native workflow](comet-native/SKILL.md). Its original references and Runtime assets are included. Use the assigned mode and the current Runtime task package.\n',
  );
  const tasks = [];
  const inputs = [
    ...dataset.cases.map((entry) => ({
      id: entry.id,
      requirements: entry.requirements,
      files: entry.files,
      fixed: true,
      bootstrap: entry.bootstrap,
    })),
    ...dataset.flows.map((entry) => ({
      id: entry.id,
      requirements: entry.requirements,
      files: entry.initialFiles,
      fixed: false,
      bootstrap: entry.bootstrap,
    })),
  ];
  for (const input of inputs) {
    const workspace = `cases/${input.id}`;
    await fs.mkdir(path.join(skill, workspace), { recursive: true });
    for (const [file, text] of Object.entries(input.files))
      await fs.writeFile(path.join(skill, workspace, file), text);
    tasks.push({
      name: input.id,
      workspace,
      prompt: `${input.requirements}\n${input.fixed ? 'Review the fixed candidate without changing its implementation.' : 'Implement the requirement through the complete Native workflow.'}\n${input.bootstrap ? `Controller preparation: invoke ${input.bootstrap} in the selected worker before assigning the model task, retaining the returned control project and integration workspace. Never copy a different machine's Run or fabricate Child receipts.\n` : ''}Use the assigned standard or bugfree mode. Write result.json with schema comet.bugfree-result.v1, caseId, verdict, runId, candidateId and the actual verification report reference. User decisions in this benchmark are simulated and must be labelled as such.`,
      expect: {
        files: ['result.json'],
        json: [{ file: 'result.json', path: '$.schema', equals: 'comet.bugfree-result.v1' }],
      },
    });
  }
  const manifest = path.join(skill, 'comet', 'eval.yaml');
  await fs.writeFile(
    manifest,
    JSON.stringify(
      {
        apiVersion: 'comet.eval/v1alpha1',
        kind: 'SkillEvalManifest',
        metadata: { name: 'native-bugfree-frozen-052' },
        skill: { name: 'comet-native', source: '..' },
        evaluation: { tasks },
      },
      null,
      2,
    ),
  );
  return { skill, manifest, tasks };
}

/** 字段沿用 Eval 的真实事件统计；缺失值保留 null，不估算 token。 */
export function frozenBugfreeMetrics(
  events: Record<string, unknown>,
  timing: { verifyActiveMs?: number; allIterationVerifyMs?: number; baselineCaptureMs?: number },
) {
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    verifyActiveMs: number(timing.verifyActiveMs),
    allIterationVerifyMs: number(timing.allIterationVerifyMs),
    baselineCaptureMs: number(timing.baselineCaptureMs),
    inputTokens: number(events.input_tokens),
    outputTokens: number(events.output_tokens),
    totalTokens: number(events.total_tokens),
    reasoningTokens: number(events.reasoning_tokens),
    cachedReadTokens: number(events.cache_read_input_tokens),
    cachedWriteTokens: number(events.cache_creation_input_tokens),
    cost: number(events.total_cost_usd),
  };
}

export function scoreFrozenBugfreeVerdict(
  expected: string,
  result: { verdict: string; completed: boolean },
) {
  return {
    correct: result.completed && result.verdict === expected,
    falseNegative: result.completed && expected === 'fail' && result.verdict === 'pass',
    falsePositive: result.completed && expected === 'pass' && result.verdict === 'fail',
  };
}
