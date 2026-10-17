const demoOrigin = Date.now() - 120000;
const date = (offset) => new Date(demoOrigin + offset).toISOString();

function example(workflow, change, delay) {
  const traceId = `workflow:${workflow}:${change}`;
  const base = {
    traceId,
    workflow,
    change,
    runId: change,
    updatedAt: date(delay + 96000),
    revision: 12,
  };
  const node = (spanId, parentSpanId, kind, name, start, end, status, extra = {}) => ({
    ...base,
    spanId,
    parentSpanId,
    kind,
    name,
    startedAt: start === null ? null : date(delay + start),
    endedAt: end === null ? null : date(delay + end),
    status,
    timing: 'measured',
    ...extra,
  });
  const nodes = [
    node('root', null, 'workflow', `comet-${workflow}`, 0, 96000, 'succeeded', {
      attributes: { workflowVersion: '1', childRunIds: [] },
    }),
    node('build', 'root', 'workflow', 'build', 0, 47000, 'succeeded', { timing: 'range' }),
    node('context', 'build', 'retrieval', '任务上下文检索', 0, 800, 'succeeded'),
    node('memory', 'context', 'retrieval', 'comet.personal-memory', 40, 340, 'succeeded'),
    node('knowledge', 'context', 'retrieval', 'comet.project-knowledge', 60, 720, 'succeeded'),
    node('implement', 'build', 'action', 'build.implement', 1000, 39000, 'succeeded', {
      attempt: 1,
      attributes: {
        actionId: 'implement',
        phase: 'build',
        actionType: 'invoke_skill',
        executor: 'host',
        inputFields: ['task', 'scope'],
        outputFields: ['summary', 'artifacts'],
        artifacts: ['src/auth/session.ts'],
      },
      summary: '完成会话校验，并补充对应的验证。',
    }),
    node('test1', 'build', 'action', 'build.checks', 40000, 42000, 'failed', {
      attempt: 1,
      attributes: { actionId: 'checks', phase: 'build', outputFields: ['result'] },
      summary: '会话到期边界用例未通过。',
    }),
    node('test2', 'build', 'action', 'build.checks', 44000, 47000, 'succeeded', {
      attempt: 2,
      attributes: { actionId: 'checks', phase: 'build', outputFields: ['result'] },
      summary: '修复到期边界后，相关检查通过。',
    }),
    node('verify', 'root', 'workflow', 'verify', 48000, 96000, 'succeeded', { timing: 'range' }),
    node('approve', 'verify', 'wait', 'verify.approval', 48000, 72000, 'succeeded', {
      attributes: { phase: 'verify' },
    }),
    node('review', 'verify', 'action', 'verify.verifier', 73000, 96000, 'succeeded', {
      attempt: 1,
      attributes: {
        actionId: 'verifier',
        phase: 'verify',
        actionType: 'handoff',
        inputFields: ['candidate', 'acceptance'],
        outputFields: ['result', 'evidence'],
      },
      summary: '独立验收通过，检查结果与候选内容一致。',
    }),
  ];
  return {
    ...base,
    name: `comet-${workflow}`,
    kind: 'workflow',
    status: 'succeeded',
    startedAt: date(delay),
    endedAt: date(delay + 96000),
    nodeCount: nodes.length,
    nodes,
    observedWorkMs: 66800,
    waitMs: 24000,
    firstPassRate: 2 / 3,
    retries: 1,
    failures: 1,
    unknownTiming: 0,
    snapshot: false,
    truncated: false,
    observedAt: date(delay + 97000),
    days: 7,
  };
}
const native = example('native', 'repair-session-expiry', 0);
const classic = example('classic', 'add-api-rate-limiting', -2 * 86400000);
const commandId = 'demo-native-check-command';
const command = {
  ...native,
  traceId: commandId,
  name: 'check',
  kind: 'command',
  nodeCount: 3,
  observedWorkMs: 4200,
  waitMs: 0,
  firstPassRate: null,
  retries: 0,
  failures: 0,
  startedAt: date(40000),
  endedAt: date(44200),
  nodes: [
    {
      ...native.nodes[0],
      traceId: commandId,
      spanId: 'command',
      kind: 'command',
      name: 'check',
      startedAt: date(40000),
      endedAt: date(44200),
    },
    {
      ...native.nodes[0],
      traceId: commandId,
      spanId: 'unit-check',
      parentSpanId: 'command',
      kind: 'check',
      name: '相关单元测试',
      startedAt: date(40100),
      endedAt: date(42800),
    },
    {
      ...native.nodes[0],
      traceId: commandId,
      spanId: 'type-check',
      parentSpanId: 'command',
      kind: 'check',
      name: '类型检查',
      startedAt: date(43000),
      endedAt: date(44200),
    },
  ],
};
export const DEMO_CHANGE_TRACES = Object.freeze(
  Object.fromEntries([native, command, classic].map((trace) => [trace.traceId, trace])),
);
export const DEMO_CHANGE_TRACE_INDEX = {
  traces: Object.values(DEMO_CHANGE_TRACES).map(({ nodes, ...trace }) => trace),
  truncated: false,
  unreadable: 0,
  days: 7,
  observedAt: date(97000),
};
