import { describe, expect, it } from 'vitest';
import {
  isNativePhaseRunning,
  nativeChangeStatusPresentation,
} from '../../../domains/dashboard/web/src/native-status-presentation.js';

function nativeChange(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    phase: 'build',
    loop: { stage: 'building' },
    verificationResult: 'pending',
    localExecution: { status: 'absent', stage: null },
    ...overrides,
  };
}

describe('Native Dashboard status presentation', () => {
  it.each([
    ['shape', 'shape', '需求澄清', 'info', true],
    ['build', 'building', '构建中', 'info', true],
    ['build', 'repairing', '修复中', 'danger', true],
    ['verify', 'verify-ready', '等待验证', 'warn', false],
    ['archive', 'archive-ready', '可归档', 'ok', false],
    ['verify', 'await-user', '等待用户', 'warn', false],
    ['verify', 'blocked', '已阻塞', 'danger', false],
  ])('presents phase %s / loop %s as %s', (phase, stage, label, tone, running) => {
    const change = nativeChange({ phase, loop: { stage } });

    expect(nativeChangeStatusPresentation(change)).toEqual({ label, tone });
    expect(isNativePhaseRunning(change)).toBe(running);
  });

  it.each([
    ['building', 'build', '构建中'],
    ['checking', 'verify', '检查中'],
    ['verifying', 'verify', '验证中'],
    ['archiving', 'archive', '归档中'],
  ])('prefers running local stage %s over a pending result', (stage, phase, label) => {
    const change = nativeChange({
      phase,
      loop: { stage: 'verify-ready' },
      localExecution: { status: 'running', stage },
    });

    expect(nativeChangeStatusPresentation(change)).toEqual({
      label,
      tone: stage === 'archiving' ? 'ok' : 'info',
    });
    expect(isNativePhaseRunning(change)).toBe(true);
  });

  it('keeps interrupted and archived changes distinct from active work', () => {
    expect(
      nativeChangeStatusPresentation(
        nativeChange({ localExecution: { status: 'interrupted', stage: 'verifying' } }),
      ),
    ).toEqual({ label: '执行中断', tone: 'warn' });
    expect(nativeChangeStatusPresentation(nativeChange({ status: 'archived' }))).toEqual({
      label: '已归档',
      tone: 'neutral',
    });
  });
});
