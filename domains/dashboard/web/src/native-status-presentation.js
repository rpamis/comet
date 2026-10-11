const LOCAL_EXECUTION_PRESENTATIONS = {
  building: { label: '构建中', tone: 'info', phase: 'build' },
  checking: { label: '检查中', tone: 'info', phase: 'verify' },
  verifying: { label: '验证中', tone: 'info', phase: 'verify' },
  archiving: { label: '归档中', tone: 'ok', phase: 'archive' },
};

const LOOP_PRESENTATIONS = {
  shape: { label: '需求澄清', tone: 'info', phase: 'shape', running: true },
  building: { label: '构建中', tone: 'info', phase: 'build', running: true },
  repairing: { label: '修复中', tone: 'danger', phase: 'build', running: true },
  'verify-ready': { label: '等待验证', tone: 'warn', phase: 'verify', running: false },
  'archive-ready': { label: '可归档', tone: 'ok', phase: 'archive', running: false },
  'await-user': { label: '等待用户', tone: 'warn', phase: null, running: false },
  blocked: { label: '已阻塞', tone: 'danger', phase: null, running: false },
  done: { label: '已完成', tone: 'ok', phase: 'archive', running: false },
};

const VERIFICATION_PRESENTATIONS = {
  pending: { label: '待验证', tone: 'neutral' },
  pass: { label: '验收通过', tone: 'ok' },
  fail: { label: '验证失败', tone: 'danger' },
  blocked: { label: '验证阻塞', tone: 'warn' },
};

export function nativeChangeStatusPresentation(change) {
  if (change.status === 'archived') return { label: '已归档', tone: 'neutral' };
  if (change.lifecycleStatus === 'await-user' || change.loop?.stage === 'await-user') {
    return { label: '等待用户', tone: 'warn' };
  }
  if (change.lifecycleStatus === 'blocked' || change.loop?.stage === 'blocked') {
    return { label: '已阻塞', tone: 'danger' };
  }

  if (change.localExecution?.status === 'interrupted') {
    return { label: '执行中断', tone: 'warn' };
  }

  if (isNativePhaseRunning(change)) {
    const local = LOCAL_EXECUTION_PRESENTATIONS[change.localExecution.stage];
    if (local) return { label: local.label, tone: local.tone };
  }

  const loop = LOOP_PRESENTATIONS[change.loop?.stage];
  if (loop) return { label: loop.label, tone: loop.tone };

  return (
    VERIFICATION_PRESENTATIONS[change.verificationResult] ?? {
      label: '状态未知',
      tone: 'neutral',
    }
  );
}

export function isNativePhaseRunning(change) {
  if (
    change.status === 'archived' ||
    ['await-user', 'blocked', 'done'].includes(change.lifecycleStatus) ||
    ['await-user', 'blocked', 'done'].includes(change.loop?.stage) ||
    change.localExecution?.status !== 'running'
  )
    return false;
  return LOCAL_EXECUTION_PRESENTATIONS[change.localExecution.stage]?.phase === change.phase;
}

export function nativePhaseStatuses(change) {
  const statuses = { shape: 'wait', build: 'wait', verify: 'wait', archive: 'wait' };
  if (change.status === 'archived') {
    return { shape: 'finish', build: 'finish', verify: 'finish', archive: 'finish' };
  }
  if (!Object.hasOwn(statuses, change.phase)) return statuses;
  if (change.lifecycleStatus === 'done' && change.loop?.stage === 'done') {
    return { shape: 'finish', build: 'finish', verify: 'finish', archive: 'finish' };
  }

  // 到达既有阶段边界才显示完成；回退 Build 后必须重新完成构建与验证。
  if (['build', 'verify', 'archive'].includes(change.phase)) statuses.shape = 'finish';
  if (['verify', 'archive'].includes(change.phase)) statuses.build = 'finish';
  if (change.phase === 'archive' && change.verificationResult === 'pass')
    statuses.verify = 'finish';
  if (['fail', 'blocked'].includes(change.verificationResult)) statuses.verify = 'error';
  statuses[change.phase] = 'process';
  if (
    change.lifecycleStatus === 'blocked' ||
    change.loop?.stage === 'blocked' ||
    change.localExecution?.status === 'interrupted' ||
    (change.phase === 'verify' &&
      ['fail', 'blocked'].includes(change.verificationResult) &&
      !isNativePhaseRunning(change))
  )
    statuses[change.phase] = 'error';
  return statuses;
}

export function nativePhaseIconStatuses(change) {
  const statuses = Object.fromEntries(
    Object.entries(nativePhaseStatuses(change)).map(([phase, status]) => [
      phase,
      status === 'finish' ? 'success' : status === 'error' ? 'error' : 'idle',
    ]),
  );
  const settled =
    change.status === 'archived' ||
    change.lifecycleStatus === 'done' ||
    change.loop?.stage === 'done';
  const verified =
    change.verificationResult === 'pass' &&
    (settled || ['verify', 'archive'].includes(change.phase));
  statuses.verify =
    change.verificationResult === 'blocked'
      ? 'blocked'
      : change.verificationResult === 'fail'
        ? 'error'
        : verified
          ? 'success'
          : 'idle';
  if (settled || !Object.hasOwn(statuses, change.phase)) return statuses;

  if (change.lifecycleStatus === 'blocked' || change.loop?.stage === 'blocked')
    statuses[change.phase] = 'blocked';
  else if (change.lifecycleStatus === 'await-user' || change.loop?.stage === 'await-user')
    statuses[change.phase] = 'waiting';
  else if (change.localExecution?.status === 'interrupted') statuses[change.phase] = 'blocked';
  else if (isNativePhaseRunning(change)) statuses[change.phase] = 'running';
  else if (change.phase === 'verify' && ['fail', 'blocked'].includes(change.verificationResult))
    return statuses;
  else if (
    (change.phase === 'verify' && change.loop?.stage === 'verify-ready') ||
    (change.phase === 'archive' && change.loop?.stage === 'archive-ready')
  )
    statuses[change.phase] = 'waiting';
  return statuses;
}
