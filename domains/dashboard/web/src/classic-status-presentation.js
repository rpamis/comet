const PHASE_PRESENTATIONS = {
  open: { label: '已启动', tone: 'neutral', running: false },
  // Classic 当前投影没有实时执行信号，阶段和任务进度不能证明正在执行。
  design: { label: '设计阶段', tone: 'info', running: false },
  build: { label: '构建阶段', tone: 'info', running: false },
  archive: { label: '归档阶段', tone: 'neutral', running: false },
};

const VERIFY_PRESENTATIONS = {
  pass: { label: '验收通过', tone: 'ok', running: false },
  fail: { label: '验证失败', tone: 'danger', running: false },
  pending: { label: '等待验证', tone: 'warn', running: false },
  unknown: { label: '验证状态未知', tone: 'neutral', running: false },
};

export function classicChangeStatusPresentation(change, phaseProgress) {
  if (change.status === 'archived') {
    return { label: '已归档', tone: 'neutral', running: false };
  }

  if (phaseProgress?.currentPhase === change.phase) {
    return {
      label: phaseProgress.currentPhaseLabel,
      tone: phaseProgress.tone,
      running:
        phaseProgress.currentPhaseRunning === true &&
        phaseProgress.phaseStatuses[change.phase] === 'process',
    };
  }

  if (change.phase === 'verify') {
    return (
      VERIFY_PRESENTATIONS[change.verify?.result] ?? {
        label: '验证状态未知',
        tone: 'neutral',
        running: false,
      }
    );
  }

  if (change.phase === 'archive' && change.verify?.result === 'pass') {
    return { label: '可归档', tone: 'ok', running: false };
  }

  return (
    PHASE_PRESENTATIONS[change.phase] ?? {
      label: '状态未知',
      tone: 'neutral',
      running: false,
    }
  );
}

export function isClassicPhaseRunning(change, phaseProgress) {
  return classicChangeStatusPresentation(change, phaseProgress).running;
}

export function classicPhaseStatuses(change, phaseProgress) {
  const statuses = { open: 'wait', design: 'wait', build: 'wait', verify: 'wait', archive: 'wait' };
  if (phaseProgress?.currentPhase === change.phase) {
    return { ...statuses, ...phaseProgress.phaseStatuses };
  }
  if (change.status === 'archived') {
    statuses.archive = 'finish';
    if (change.verify?.result === 'pass') statuses.verify = 'finish';
    return statuses;
  }
  if (!Object.hasOwn(statuses, change.phase)) return statuses;
  statuses[change.phase] = 'process';
  if (['verify', 'archive'].includes(change.phase) && change.verify?.result === 'pass')
    statuses.verify = 'finish';
  if (change.verify?.result === 'fail') statuses.verify = 'error';
  return statuses;
}

export function classicPhaseIconStatuses(change, phaseProgress) {
  const statuses = Object.fromEntries(
    Object.entries(classicPhaseStatuses(change, phaseProgress)).map(([phase, status]) => [
      phase,
      status === 'finish' ? 'success' : status === 'error' ? 'error' : 'idle',
    ]),
  );
  const verified =
    change.verify?.result === 'pass' &&
    (change.status === 'archived' || ['verify', 'archive'].includes(change.phase));
  if (verified) statuses.verify = 'success';
  else if (statuses.verify === 'success') statuses.verify = 'idle';

  if (change.status === 'archived' || !Object.hasOwn(statuses, change.phase)) return statuses;
  if (change.phase === 'verify' && change.verify?.result === 'pending') statuses.verify = 'waiting';
  if (phaseProgress?.currentPhase === change.phase) {
    const current = phaseProgress.currentPhaseStatus;
    if (['idle', 'waiting', 'success', 'error', 'blocked'].includes(current))
      statuses[change.phase] = current;
    else if (isClassicPhaseRunning(change, phaseProgress)) statuses[change.phase] = 'running';
  }
  if (statuses.verify === 'success' && !verified) statuses.verify = 'idle';
  return statuses;
}
