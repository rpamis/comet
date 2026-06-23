// Display constants shared by multiple components.

export const PHASE_ORDER = ['open', 'design', 'build', 'verify', 'archive'];

export const PHASE_LABELS = {
  open: 'Open',
  design: 'Design',
  build: 'Build',
  verify: 'Verify',
  archive: 'Archive',
};

export const PHASE_INDEX = Object.fromEntries(PHASE_ORDER.map((name, idx) => [name, idx]));

export const STATE_TEXT = {
  done: '完成',
  current: '当前阶段',
  pending: '待处理',
  failed: '失败',
  unknown: '未知',
};

export const STATE_GLYPH = {
  done: '✓',
  current: '↻',
  pending: '□',
  failed: '×',
  unknown: '?',
};

export const VERIFY_LABEL = {
  pass: '通过',
  fail: '失败',
  pending: '待验证',
  unknown: '未知',
};

export const VERIFY_CLASS = {
  pass: 'status-ok',
  fail: 'status-danger',
  pending: 'status-warn',
  unknown: 'status-muted',
};

export const SECTION_STATUS_CLASS = {
  done: 'status-ok',
  active: 'status-current',
  pending: 'status-muted',
  failed: 'status-danger',
};

export const ARTIFACT_ROWS = [
  ['proposal.md', 'proposal'],
  ['design.md', 'design'],
  ['tasks.md', 'tasks'],
  ['plan.md', 'plan'],
  ['verify-result.md', 'verifyReport'],
  ['.comet.yaml', 'cometYaml'],
];
