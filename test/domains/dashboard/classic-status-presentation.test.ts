import { describe, expect, it } from 'vitest';
import {
  classicChangeStatusPresentation,
  classicPhaseIconStatuses,
  classicPhaseStatuses,
  isClassicPhaseRunning,
} from '../../../domains/dashboard/web/src/classic-status-presentation.js';

function classicChange(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    phase: 'build',
    verify: { result: 'pending' },
    ...overrides,
  };
}

describe('Classic Dashboard status presentation', () => {
  it.each([
    ['open', '已启动', 'neutral', false],
    ['design', '设计阶段', 'info', false],
    ['build', '构建阶段', 'info', false],
    ['archive', '归档阶段', 'neutral', false],
  ])('presents phase %s as %s', (phase, label, tone, running) => {
    const change = classicChange({ phase });

    expect(classicChangeStatusPresentation(change)).toEqual({ label, tone, running });
    expect(isClassicPhaseRunning(change)).toBe(running);
  });

  it.each([
    ['pending', '等待验证', 'warn'],
    ['pass', '验收通过', 'ok'],
    ['fail', '验证失败', 'danger'],
    ['unknown', '验证状态未知', 'neutral'],
  ])('keeps Verify result %s distinct from active execution', (result, label, tone) => {
    const change = classicChange({ phase: 'verify', verify: { result } });

    expect(classicChangeStatusPresentation(change)).toEqual({
      label,
      tone,
      running: false,
    });
    expect(isClassicPhaseRunning(change)).toBe(false);
  });

  it('does not animate an archived change', () => {
    const change = classicChange({ status: 'archived', phase: 'build' });

    expect(classicChangeStatusPresentation(change)).toEqual({
      label: '已归档',
      tone: 'neutral',
      running: false,
    });
    expect(isClassicPhaseRunning(change)).toBe(false);
  });

  it('does not treat a persisted run or a task checklist as live execution', () => {
    const change = classicChange({
      run: { status: 'running' },
      tasks: { completed: 8, total: 12 },
    });

    expect(classicChangeStatusPresentation(change).label).toBe('构建阶段');
    expect(isClassicPhaseRunning(change)).toBe(false);
  });

  it('reports archive readiness only with a passed verification', () => {
    expect(
      classicChangeStatusPresentation(
        classicChange({ phase: 'archive', verify: { result: 'pass' } }),
      ),
    ).toEqual({ label: '可归档', tone: 'ok', running: false });
  });

  it('discards the entire explicit presentation after a phase rollback', () => {
    const progress = {
      currentPhase: 'build',
      phaseStatuses: {
        open: 'finish',
        design: 'finish',
        build: 'process',
        verify: 'wait',
        archive: 'wait',
      },
      currentPhaseRunning: true,
      currentPhaseLabel: '构建中',
      tone: 'info',
    };
    const change = classicChange();
    expect(isClassicPhaseRunning(change, progress)).toBe(true);
    change.phase = 'open';
    expect(classicChangeStatusPresentation(change, progress)).toEqual({
      label: '已启动',
      tone: 'neutral',
      running: false,
    });
    expect(classicPhaseStatuses(change, progress)).toEqual({
      open: 'process',
      design: 'wait',
      build: 'wait',
      verify: 'wait',
      archive: 'wait',
    });
  });

  it.each(['error', 'finish'])('does not animate explicit current status %s', (status) => {
    expect(
      isClassicPhaseRunning(classicChange(), {
        currentPhase: 'build',
        phaseStatuses: { build: status },
        currentPhaseRunning: true,
        currentPhaseLabel: status === 'error' ? '构建失败' : '已完成',
        tone: 'info',
      }),
    ).toBe(false);
  });
});

describe('Classic stage icon states', () => {
  it.each(['open', 'design', 'build', 'archive'])(
    'keeps source phase %s idle without execution or waiting evidence',
    (phase) => {
      expect(classicPhaseIconStatuses(classicChange({ phase }))[phase]).toBe('idle');
    },
  );

  it.each([
    ['pending', 'waiting'],
    ['pass', 'success'],
    ['fail', 'error'],
    ['unknown', 'idle'],
  ])('maps an explicit Verify result %s to %s', (result, status) => {
    expect(
      classicPhaseIconStatuses(classicChange({ phase: 'verify', verify: { result } })).verify,
    ).toBe(status);
  });

  it.each([
    ['idle', 'process', false],
    ['running', 'process', true],
    ['waiting', 'process', false],
    ['success', 'finish', false],
    ['error', 'error', false],
    ['blocked', 'error', false],
  ])('uses structured Demo state %s without reading its label', (status, step, running) => {
    const progress = {
      currentPhase: 'build',
      phaseStatuses: { open: 'finish', build: step },
      currentPhaseStatus: status,
      currentPhaseRunning: running,
      currentPhaseLabel: '构建中 等待用户 已阻塞',
      tone: 'info',
    };
    expect(classicPhaseIconStatuses(classicChange(), progress).build).toBe(status);
    expect(classicPhaseIconStatuses(classicChange(), progress).open).toBe('success');
    expect(classicPhaseIconStatuses(classicChange({ phase: 'open' }), progress)).toEqual({
      open: 'idle',
      design: 'idle',
      build: 'idle',
      verify: 'idle',
      archive: 'idle',
    });
  });

  it('requires explicit execution even when a Demo status says running', () => {
    expect(
      classicPhaseIconStatuses(classicChange(), {
        currentPhase: 'build',
        phaseStatuses: { build: 'process' },
        currentPhaseStatus: 'running',
        currentPhaseRunning: false,
        currentPhaseLabel: '构建中',
      }).build,
    ).toBe('idle');
  });

  it('does not infer Demo waiting from a label or complete Verify after rollback', () => {
    expect(
      classicPhaseIconStatuses(classicChange(), {
        currentPhase: 'build',
        phaseStatuses: { build: 'process' },
        currentPhaseRunning: false,
        currentPhaseLabel: '等待用户',
      }).build,
    ).toBe('idle');
    expect(classicPhaseIconStatuses(classicChange({ verify: { result: 'pass' } })).verify).toBe(
      'idle',
    );
    expect(classicPhaseIconStatuses(classicChange({ status: 'archived' }))).toEqual({
      open: 'idle',
      design: 'idle',
      build: 'idle',
      verify: 'idle',
      archive: 'success',
    });
  });
});

describe('Classic Dashboard phase statuses', () => {
  it.each([
    ['open', 'process', 'wait', 'wait', 'wait', 'wait'],
    ['design', 'wait', 'process', 'wait', 'wait', 'wait'],
    ['build', 'wait', 'wait', 'process', 'wait', 'wait'],
    ['verify', 'wait', 'wait', 'wait', 'process', 'wait'],
    ['archive', 'wait', 'wait', 'wait', 'wait', 'process'],
    ['unknown', 'wait', 'wait', 'wait', 'wait', 'wait'],
  ])(
    'binds valid source phase %s to each step explicitly',
    (phase, open, design, build, verify, archive) => {
      expect(classicPhaseStatuses(classicChange({ phase }))).toEqual({
        open,
        design,
        build,
        verify,
        archive,
      });
    },
  );

  it('shows a completion check for an explicitly passed current Verify', () => {
    expect(
      classicPhaseStatuses(classicChange({ phase: 'verify', verify: { result: 'pass' } })),
    ).toEqual({
      open: 'wait',
      design: 'wait',
      build: 'wait',
      verify: 'finish',
      archive: 'wait',
    });
  });

  it.each(['build', 'verify'])('keeps Verify failure visible at source phase %s', (phase) => {
    expect(classicPhaseStatuses(classicChange({ phase, verify: { result: 'fail' } })).verify).toBe(
      'error',
    );
  });

  it('keeps the passed Verify check at Archive without assuming earlier completion', () => {
    expect(
      classicPhaseStatuses(classicChange({ phase: 'archive', verify: { result: 'pass' } })),
    ).toEqual({
      open: 'wait',
      design: 'wait',
      build: 'wait',
      verify: 'finish',
      archive: 'process',
    });
  });

  it('does not complete future stages from a retained passed result', () => {
    expect(classicPhaseStatuses(classicChange({ verify: { result: 'pass' } }))).toEqual({
      open: 'wait',
      design: 'wait',
      build: 'process',
      verify: 'wait',
      archive: 'wait',
    });
  });

  it('shows only evidenced completion on an archived change with an unknown retained phase', () => {
    expect(classicPhaseStatuses(classicChange({ status: 'archived', phase: 'unknown' }))).toEqual({
      open: 'wait',
      design: 'wait',
      build: 'wait',
      verify: 'wait',
      archive: 'finish',
    });
  });

  it('retains a passed Verify on an archived change', () => {
    expect(
      classicPhaseStatuses(classicChange({ status: 'archived', verify: { result: 'pass' } })),
    ).toEqual({ open: 'wait', design: 'wait', build: 'wait', verify: 'finish', archive: 'finish' });
  });

  it('clears the verification error when retrying and does not retain completion after rollback', () => {
    const change = classicChange({ phase: 'verify', verify: { result: 'fail' } });
    expect(classicPhaseStatuses(change).verify).toBe('error');
    change.verify.result = 'pending';
    expect(classicPhaseStatuses(change).verify).toBe('process');
    change.verify.result = 'pass';
    expect(classicPhaseStatuses(change).verify).toBe('finish');
    change.phase = 'build';
    expect(classicPhaseStatuses(change)).toEqual({
      open: 'wait',
      design: 'wait',
      build: 'process',
      verify: 'wait',
      archive: 'wait',
    });
  });

  it('does not infer completed stages from an unknown phase and a retained result', () => {
    expect(
      classicPhaseStatuses(classicChange({ phase: 'unknown', verify: { result: 'fail' } })),
    ).toEqual({ open: 'wait', design: 'wait', build: 'wait', verify: 'wait', archive: 'wait' });
  });
});
