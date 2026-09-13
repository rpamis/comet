import { describe, expect, it } from 'vitest';
import {
  classicChangeStatusPresentation,
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
    ['design', '设计中', 'info', true],
    ['build', '构建中', 'info', true],
    ['archive', '可归档', 'ok', false],
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
});
