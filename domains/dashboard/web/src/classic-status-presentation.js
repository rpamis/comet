const PHASE_PRESENTATIONS = {
  open: { label: '已启动', tone: 'neutral', running: false },
  design: { label: '设计中', tone: 'info', running: true },
  build: { label: '构建中', tone: 'info', running: true },
  archive: { label: '可归档', tone: 'ok', running: false },
};

const VERIFY_PRESENTATIONS = {
  pass: { label: '验收通过', tone: 'ok', running: false },
  fail: { label: '验证失败', tone: 'danger', running: false },
  pending: { label: '等待验证', tone: 'warn', running: false },
  unknown: { label: '验证状态未知', tone: 'neutral', running: false },
};

export function classicChangeStatusPresentation(change) {
  if (change.status === 'archived') {
    return { label: '已归档', tone: 'neutral', running: false };
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

  return (
    PHASE_PRESENTATIONS[change.phase] ?? {
      label: '状态未知',
      tone: 'neutral',
      running: false,
    }
  );
}

export function isClassicPhaseRunning(change) {
  return classicChangeStatusPresentation(change).running;
}
