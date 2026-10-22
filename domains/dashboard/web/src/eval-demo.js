// 仅用于 Dashboard 展示，不连接真实评估服务或保存运行。
import { localizedDemo, demoText } from './demo-locale.js';
const run = {
  id: 'demo-eval-report',
  origin: 'cli',
  executionStatus: 'completed',
  conclusion: 'failed',
  createdAt: '2026-10-13T08:00:00Z',
  target: {
    id: 'report-workflow',
    name: '报告工作流 · 示例',
    type: 'application',
    version: '1.1.0',
    path: 'weekly-report/application.json',
    // SHA-256("report-workflow@1.1.0:content")，用于演示固定内容身份。
    contentHash: 'bf2ea408688d087fd31ad3f4b4ab8389276263721fe2b61e2f7e05e2bf2e955a',
  },
  config: {
    target: 'weekly-report/application.json',
    targetType: 'application',
    agent: 'codex',
    model: 'demo-model',
    task: 'report-review',
  },
  passed: 1,
  total: 2,
  expectedTotal: 2,
  baselineEligible: false,
  baselineDisabledReason: '示例数据',
  isBaseline: false,
  baselineRunId: null,
  availableActions: { stop: false, rerun: false, setBaseline: false, compare: false },
  metrics: { tokens: 2400, durationSeconds: 32, knownCostUsd: null, costStatus: 'unavailable' },
  cases: [
    {
      id: 'approved-report',
      task: 'report-review',
      prompt: '检查报告来源，批准后发布。',
      finalResponse: '已展示草稿，用户批准后完成本地发布。',
      passed: true,
      quality: 'included',
      checksPassed: ['当前草稿已批准', '发布文件与已批准内容一致'],
      checksFailed: [],
      scores: {},
      scoreSources: {},
      artifacts: [],
    },
    {
      id: 'missing-source',
      task: 'missing-source',
      prompt: '生成没有来源清单的报告。',
      finalResponse: '报告缺少来源，输出验收未通过。',
      passed: false,
      quality: 'included',
      checksPassed: [],
      checksFailed: ['报告必须包含可核对的来源'],
      scores: {},
      scoreSources: {},
      artifacts: [],
    },
  ],
  coverage: {
    executedSteps: ['draft', 'approve', 'publish'],
    coveredSteps: ['draft', 'approve', 'publish'],
    uncoveredSteps: ['reconcile'],
    coveredChoices: ['approved'],
    uncoveredChoices: ['rejected'],
    recoveredActions: [],
    actualModels: ['demo-model'],
  },
  limitations: ['仅为交互示例，不代表真实模型评估结果。', '恢复路径与真实 Agent 平台尚未验证。'],
  failures: [],
  diagnostics: [],
  artifacts: [{ id: 'summary.md', label: 'summary.md', format: 'markdown' }],
};

export async function readEvalDemo(suffix, { body } = {}) {
  if (body !== undefined) throw new Error(demoText('示例数据只支持读取'));
  const url = new URL(suffix, 'https://demo.invalid');
  const example = localizedDemo(structuredClone(run));
  if (url.pathname === '/runs') {
    const query = url.searchParams.get('q')?.toLowerCase() ?? '';
    return {
      items: `${example.target.name} ${example.id}`.toLowerCase().includes(query) ? [example] : [],
    };
  }
  if (url.pathname === `/runs/${run.id}`) return example;
  if (url.pathname === `/runs/${run.id}/artifact` && url.searchParams.get('ref') === 'summary.md')
    return localizedDemo({
      format: 'markdown',
      content:
        '# 报告工作流评估示例\n\n两项示例用例中，一项通过，一项未通过来源检查。\n\n此记录仅展示界面交互，不证明真实模型或 Agent 平台已通过验收。',
    });
  throw new Error(demoText('示例记录不存在'));
}

export function readEvalDemoSettings() {
  return {
    revision: 'demo-settings',
    path: '~/.comet/eval/.env',
    defaults: {
      suite: 'local',
      langsmithEndpoint: '',
      langsmithProject: '',
      langsmithTracing: true,
      langfuseBaseUrl: '',
      langfuseEnvironment: '',
      agent: 'codex',
      model: 'demo-model',
      baseUrl: 'https://provider.example/v1',
      judgeEnabled: true,
      judgeAgent: 'claude-code',
      judgeModel: 'demo-judge',
      judgeBaseUrl: 'https://judge.example/v1',
      skillTimeoutSeconds: 600,
      skillMaxTurns: 40,
      applicationTimeoutSeconds: 180,
      applicationMaxTurns: 12,
    },
    credentials: {
      main: { configured: false, saved: false, source: null, kind: 'api-key' },
      judge: { configured: false, saved: false, source: null, kind: 'api-key' },
      langsmith: { configured: false, saved: false, source: 'none', kind: 'api-key' },
      langfusePublic: { configured: false, saved: false, source: 'none', kind: 'api-key' },
      langfuseSecret: { configured: false, saved: false, source: 'none', kind: 'api-key' },
    },
    overrides: [],
    warnings: [],
  };
}
