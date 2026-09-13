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

  if (change.localExecution?.status === 'interrupted') {
    return { label: '执行中断', tone: 'warn' };
  }

  if (change.localExecution?.status === 'running') {
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
  if (change.status === 'archived') return false;

  if (change.localExecution?.status === 'running') {
    const local = LOCAL_EXECUTION_PRESENTATIONS[change.localExecution.stage];
    return local?.phase === change.phase;
  }

  const loop = LOOP_PRESENTATIONS[change.loop?.stage];
  return Boolean(loop?.running && loop.phase === change.phase);
}
