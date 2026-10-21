// 仅现有 ?demo 展示模式使用；真实工作区始终请求只读 API。
// SHA-256 从固定示例身份预计算，保持版本及关联记录一致，不代表真实包验收。
import { localizedDemo, demoText } from './demo-locale.js';
const locatorHashes = [
  'f1b2ddfe2ed6828c90cfd1580574fa83346b002685fbc6e9947a1acb5c0dd867',
  '44a7f2927bf7a939be02ad773b3a53e2edcb975c3117a1d73eda34aabeaf11bf',
  '8a91e0423d788667a4981080a11a74cfe8ad3b9672ba596134ee6d14bebccb4f',
  '0277b305b27517a34e9507079dddcf65eca4c790592f1cef7174d31f80efcd6b',
  '9d8c3e533a62e32ace91aa9669e1bd69e0229059215945fa74bfd353c7a2e660',
  'bcada955ec1497464e4dc67ec93cac314ae184f553fc1f9d798ace425eafbf40',
];
const locator = (kind, n) => `${kind}:${locatorHashes[n - 1]}`;
const applicationHashes = {
  '1.1.0': {
    contentHash: '4956377f6229a579058625f57bc30e4de20c626e084a4f7783cca52ca04771cd',
    packageHash: '7c08c31332a63cf0731ef8e35d63efecd96c40e4310a6476104d9b3ce0416142',
  },
  '1.2.0': {
    contentHash: '6d71f72fda1ec233d9f8795b919dffcee4cb1b6700edb6a5d38654f094075df2',
    packageHash: 'fe6ca7ea18f8af1ea823aa9436c306b67c7bfdee4f6bdc17388ced964cee6010',
  },
};
const identity = (version) => ({
  id: 'grill-suite',
  version,
  base: 'standalone',
  ...applicationHashes[version],
});
const record = (id, title, phase, status, kind = 'action', sequence = 1, data = {}) => ({
  id,
  stepId: id,
  title,
  phase,
  status,
  kind,
  sequence,
  attempt: kind === 'action' ? 1 : null,
  type: kind === 'decision' ? 'user_decision' : kind === 'evidence' ? 'host-proof' : 'handoff',
  active: ['running', 'waiting', 'evidence', 'child', 'pending'].includes(status),
  data,
  childLocator: null,
  childRunId: null,
});
const proof = (version) =>
  [
    { kind: 'local', status: 'passed', summary: '本地应用、固定依赖与 Runtime 契约校验已完成' },
    { kind: 'model', status: 'not-recorded', summary: '当前固定内容没有模型评估记录' },
    {
      kind: 'host',
      status: 'not-recorded',
      summary: '没有独立宿主验证记录；本地校验和模型评估不能替代宿主验收',
    },
  ].map((e) => ({
    ...e,
    version,
    contentHash: applicationHashes[version]?.contentHash ?? null,
    sourceLocator: null,
    sourceRunId: null,
    report: null,
    evalRunId: null,
    details: null,
  }));
const summary = (kind, n, runId, goal, status, app = null) => ({
  locator: locator(kind, n),
  kind,
  isChild: n === 6,
  parentRunId: n === 6 ? 'run-128' : null,
  parentLocator: n === 6 ? locator('application', 4) : null,
  runId,
  title: app?.id ?? goal,
  goal,
  status,
  revision: 24,
  application: app,
  applicationId: app?.id ?? null,
  error: null,
  activity: {
    pending: 0,
    running: n === 4 ? 2 : status === 'running' ? 1 : 0,
    unknown: 0,
    decisions: n === 4 ? 1 : status === 'waiting' ? 1 : 0,
    evidence: 0,
    children: 0,
  },
});
const summaries = [
  summary('creator', 1, 'creator-041', '增加独立审查与恢复路径。', 'waiting', identity('1.2.0')),
  summary('creator', 2, 'creator-draft', '让发布说明自动附带证据', 'running'),
  summary('creator', 3, 'creator-040', '创建可安装的开发工作流。', 'delivered', identity('1.1.0')),
  summary(
    'application',
    4,
    'run-128',
    '给发布流程增加产物校验与独立审查。',
    'running',
    identity('1.1.0'),
  ),
  summary('application', 5, 'run-127', '完善输入校验。', 'completed', identity('1.1.0')),
  summary(
    'application',
    6,
    'review-022',
    '核对父运行的实现与验收证据。',
    'waiting',
    identity('1.1.0'),
  ),
];
function detail(summary) {
  let records =
    summary.kind === 'creator'
      ? [
          record('analyze', '理解需求与调查 Skills', '需求与调查', 'succeeded'),
          record('prepare', '整理创作方案', '方案与确认', 'succeeded'),
          record('confirm-plan', '确认创作方案', '方案与确认', 'waiting', 'decision', 3, {
            proposal: { version: '1.2.0', summary: '增加独立审查与恢复路径。' },
            choices: ['approved', 'revise', 'rejected'],
          }),
        ]
      : [
          record('interview', '追问与记录决定', '准备方案', 'succeeded', 'action', 3, {
            outcome: {
              attempt: 1,
              status: 'succeeded',
              summary: '方案已确认',
              output: { scope: 'current' },
            },
          }),
          record('implement', '实现工作流步骤', '构建与校验', 'running', 'action', 9, {
            attempt: 2,
            reconciliations: [
              { attempt: 1, resolution: 'not-executed', evidence: '核对原宿主后确认未执行' },
            ],
          }),
          record('regression', '执行回归检查', '构建与校验', 'running', 'action', 10),
          record('approve', '确认文档发布范围', '确认与审查', 'waiting', 'decision', 11, {
            proposal: { scope: 'documentation' },
            choices: ['approved', 'rejected'],
          }),
          {
            ...record('review', '独立审查子流程', '确认与审查', 'child', 'action', 12),
            childLocator: locator('application', 6),
            childRunId: 'review-022',
          },
        ];
  if (!summary.application)
    records = [record('analyze', '理解目标与调查 Skills', '准备方案', 'running')];
  if (summary.runId === 'review-022')
    records = [
      record('evidence', '收集宿主验收证据', '执行步骤', 'evidence', 'evidence', 3, {
        kind: 'host-proof',
      }),
    ];
  if (summary.status === 'completed' && !summary.isChild)
    records.push(record('deliver', '安装与交付', '交付', 'succeeded', 'action', 15));
  if (summary.status === 'delivered')
    records = [
      ...records.map((r) => ({ ...r, status: 'succeeded', active: false })),
      ...[
        ['compile', '编译应用', '构建与校验'],
        ['verify', '校验应用与依赖', '构建与校验'],
        ['eval-preview', '准备模型评估', '模型评估'],
        ['confirm-eval', '确认是否评估', '模型评估'],
        ['preview', '预览安装影响', '安装预览'],
        ['confirm-install', '确认安装', '交付与分发'],
        ['install', '安装与交付', '交付与分发'],
      ].map(([id, title, phase], index) =>
        record(id, title, phase, 'succeeded', 'action', index + 4),
      ),
    ];
  if (['delivered', 'completed'].includes(summary.status))
    records = records.map((r) => ({
      ...r,
      status: 'succeeded',
      active: false,
      childLocator: null,
    }));
  const definition =
    summary.kind === 'application' && !summary.isChild ? demoDefinition(records) : null;
  return {
    ...summary,
    readAt: new Date().toISOString(),
    sequence: 15,
    workflow: { id: summary.kind === 'creator' ? 'comet-creator' : 'demo', version: '1' },
    records,
    currentIds: records.filter((r) => r.active).map((r) => r.id),
    artifacts: [
      {
        id: 'demo-output',
        label: 'observed-output.json',
        recordId: records[0]?.id,
        uri: null,
        sha256: null,
        value: { example: true },
      },
    ],
    evidence: proof(summary.application?.version ?? null).map((e) =>
      summary.kind === 'creator' && summary.status !== 'delivered'
        ? { ...e, status: 'not-recorded', summary: '当前候选尚无验证记录' }
        : summary.kind === 'creator' && summary.status === 'delivered' && e.kind === 'model'
          ? { ...e, status: 'skipped' }
          : e,
    ),
    otherEvidence: [],
    definitionStatus: definition ? 'available' : 'observed',
    ...(definition ? { definition } : {}),
    material: { status: summary.application ? 'matched' : 'not-generated' },
    fixedIdentity: null,
    sourceCreators:
      summary.kind === 'application'
        ? [{ locator: locator('creator', 3), runId: 'creator-040', version: '1.1.0' }]
        : [],
    children: [],
    inspection: {
      commandArgs: ['comet', 'creator', 'status', summary.runId, '--json'],
      request: null,
    },
    relatedChange: null,
  };
}

function demoDefinition(records) {
  const steps = {
    interview: { type: 'invoke_skill', ref: 'grilling' },
    implement: { type: 'invoke_skill', ref: 'implementation' },
    regression: { type: 'call_tool', ref: 'regression' },
    approve: { type: 'ask_user', choices: ['approved', 'rejected'] },
    review: { type: 'child_workflow', workflow: { id: 'review', version: '1' } },
    deliver: {
      type: 'call_tool',
      ref: 'deliver',
      join: ['implement', 'regression', 'approve', 'review'],
    },
  };
  return {
    status: 'available',
    title: '开发工作流',
    workflow: {
      id: 'demo',
      version: '1',
      entry: ['interview'],
      dynamicRouting: false,
      steps,
      transitions: [
        ...['implement', 'regression', 'approve', 'review'].map((to) => ({
          from: 'interview',
          to,
          on: 'succeeded',
        })),
        ...['implement', 'regression', 'review'].map((from) => ({
          from,
          to: 'deliver',
          on: 'succeeded',
        })),
        { from: 'approve', to: 'deliver', on: 'approved' },
        { from: 'regression', to: 'implement', on: 'failed' },
      ],
    },
    steps: Object.entries(steps).map(([stepId, step]) => {
      const observed = records.filter((record) => record.stepId === stepId);
      const latest = observed.at(-1);
      return {
        stepId,
        ...step,
        title: latest?.title ?? '安装与交付',
        phase: latest?.phase ?? '交付',
        skills: step.type === 'invoke_skill' ? [step.ref] : [],
        recordCount: observed.length,
        activeRecordIds: observed.filter((record) => record.active).map((record) => record.id),
        latestRecordId: latest?.id ?? null,
        latestStatus: latest?.status ?? null,
      };
    }),
  };
}
export function readApplicationDemo(endpoint, query = {}) {
  const examples = localizedDemo(summaries);
  if (endpoint === 'application-runs') {
    const search = String(query.q ?? '').toLowerCase();
    const items = examples.filter(
      (s) =>
        (!query.applicationId || s.applicationId === query.applicationId) &&
        (!query.kind || query.kind === 'all' || s.kind === query.kind) &&
        `${s.title} ${s.goal} ${s.runId}`.toLowerCase().includes(search) &&
        (query.status === 'attention'
          ? s.status === 'waiting'
          : query.status === 'active'
            ? ['running', 'waiting'].includes(s.status)
            : true),
    );
    return {
      items,
      total: items.length,
      nextCursor: null,
      fingerprint: 'demo',
      readAt: new Date().toISOString(),
      errors: [],
    };
  }
  const item = summaries.find((s) => s.locator === query.locator);
  if (!item) throw Object.assign(new Error(demoText('示例记录不存在')), { status: 404 });
  if (endpoint === 'application-run') return localizedDemo(detail(item));
  if (endpoint === 'application-run-artifact')
    return {
      key: 'demo-output',
      label: 'observed-output.json',
      path: 'observed-output.json',
      exists: true,
      content: '{\n  "example": true\n}',
      status: 'recorded',
    };
  return localizedDemo({
    items: detail(item).records,
    total: detail(item).records.length,
    nextCursor: null,
  });
}
