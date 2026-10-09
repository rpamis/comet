import { describe, expect, it } from 'vitest';
import {
  isNativePhaseRunning,
  nativeChangeStatusPresentation,
  nativePhaseIconStatuses,
  nativePhaseStatuses,
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
    ['shape', 'shape', '需求澄清', 'info', false],
    ['build', 'building', '构建中', 'info', false],
    ['build', 'repairing', '修复中', 'danger', false],
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
    expect(
      isNativePhaseRunning(
        nativeChange({ localExecution: { status: 'interrupted', stage: 'building' } }),
      ),
    ).toBe(false);
    expect(
      isNativePhaseRunning(
        nativeChange({
          status: 'archived',
          localExecution: { status: 'running', stage: 'building' },
        }),
      ),
    ).toBe(false);
  });

  it.each([
    [{ loop: { stage: 'await-user' } }, '等待用户', 'warn', 'process'],
    [{ lifecycleStatus: 'await-user' }, '等待用户', 'warn', 'process'],
    [{ loop: { stage: 'blocked' } }, '已阻塞', 'danger', 'error'],
    [{ lifecycleStatus: 'blocked' }, '已阻塞', 'danger', 'error'],
  ])(
    'keeps waiting or blocking state %j ahead of running telemetry',
    (overrides, label, tone, status) => {
      const change = nativeChange({
        phase: 'verify',
        localExecution: { status: 'running', stage: 'verifying' },
        ...overrides,
      });

      expect(nativeChangeStatusPresentation(change)).toEqual({ label, tone });
      expect(isNativePhaseRunning(change)).toBe(false);
      expect(nativePhaseStatuses(change).verify).toBe(status);
    },
  );

  it.each([
    ['build', 'verifying'],
    ['verify', 'building'],
    ['verify', 'unknown'],
    ['unknown', 'verifying'],
  ])('does not animate phase %s for local stage %s', (phase, stage) => {
    expect(
      isNativePhaseRunning(nativeChange({ phase, localExecution: { status: 'running', stage } })),
    ).toBe(false);
  });

  it('ignores a running label when the local stage does not match the current phase', () => {
    expect(
      nativeChangeStatusPresentation(
        nativeChange({ localExecution: { status: 'running', stage: 'verifying' } }),
      ),
    ).toEqual({ label: '构建中', tone: 'info' });
  });
});

describe('Native stage icon states', () => {
  it.each([
    ['shape', 'shape'],
    ['build', 'building'],
    ['build', 'repairing'],
  ])('keeps %s / %s idle without local execution', (phase, stage) => {
    expect(nativePhaseIconStatuses(nativeChange({ phase, loop: { stage } }))[phase]).toBe('idle');
  });

  it.each([
    ['build', 'building'],
    ['verify', 'checking'],
    ['verify', 'verifying'],
    ['archive', 'archiving'],
  ])('animates only the matching live phase %s / %s', (phase, stage) => {
    expect(
      nativePhaseIconStatuses(
        nativeChange({
          phase,
          localExecution: { status: 'running', stage },
        }),
      )[phase],
    ).toBe('running');
    expect(
      nativePhaseIconStatuses(
        nativeChange({
          phase,
          localExecution: { status: 'running', stage: 'unknown' },
        }),
      )[phase],
    ).not.toBe('running');
  });

  it.each([
    ['verify', 'verify-ready'],
    ['verify', 'await-user'],
    ['archive', 'archive-ready'],
  ])('keeps phase %s / %s explicitly waiting', (phase, stage) => {
    expect(nativePhaseIconStatuses(nativeChange({ phase, loop: { stage } }))[phase]).toBe(
      'waiting',
    );
  });

  it('keeps passed Verify waiting for user confirmation without a success mark', () => {
    expect(
      nativePhaseIconStatuses(
        nativeChange({
          phase: 'verify',
          lifecycleStatus: 'await-user',
          loop: { stage: 'await-user' },
          verificationResult: 'pass',
          localExecution: { status: 'running', stage: 'verifying' },
        }),
      ).verify,
    ).toBe('waiting');
  });

  it.each([
    [{ lifecycleStatus: 'blocked' }, 'blocked'],
    [{ loop: { stage: 'blocked' } }, 'blocked'],
    [{ localExecution: { status: 'interrupted', stage: 'verifying' } }, 'blocked'],
    [{ verificationResult: 'blocked' }, 'blocked'],
    [{ verificationResult: 'fail' }, 'error'],
    [{ verificationResult: 'pass', loop: null }, 'success'],
  ])('distinguishes the icon state for %j', (overrides, status) => {
    expect(nativePhaseIconStatuses(nativeChange({ phase: 'verify', ...overrides })).verify).toBe(
      status,
    );
  });

  it.each(['fail', 'blocked'])(
    'lets new live Verify replace the old %s result',
    (verificationResult) => {
      const change = nativeChange({ phase: 'verify', verificationResult });
      expect(nativePhaseIconStatuses(change).verify).toBe(
        verificationResult === 'fail' ? 'error' : 'blocked',
      );
      change.localExecution = { status: 'running', stage: 'verifying' };
      expect(nativePhaseIconStatuses(change).verify).toBe('running');
      change.localExecution = { status: 'absent', stage: null };
      change.verificationResult = 'pass';
      change.phase = 'build';
      expect(nativePhaseIconStatuses(change).verify).toBe('idle');
    },
  );

  it('requires an explicit pass for Verify success even on archived or completed changes', () => {
    for (const overrides of [
      { status: 'archived', phase: 'unknown' },
      { phase: 'archive', lifecycleStatus: 'done', loop: { stage: 'done' } },
    ]) {
      expect(nativePhaseIconStatuses(nativeChange(overrides)).verify).toBe('idle');
      expect(
        nativePhaseIconStatuses(nativeChange({ ...overrides, verificationResult: 'pass' })).verify,
      ).toBe('success');
    }
  });
});

describe('Native Dashboard phase statuses', () => {
  it.each([
    ['shape', 'process', 'wait', 'wait', 'wait'],
    ['build', 'finish', 'process', 'wait', 'wait'],
    ['verify', 'finish', 'finish', 'process', 'wait'],
    ['archive', 'finish', 'finish', 'wait', 'process'],
    ['unknown', 'wait', 'wait', 'wait', 'wait'],
  ])(
    'binds valid source phase %s to each step explicitly',
    (phase, shape, build, verify, archive) => {
      expect(nativePhaseStatuses(nativeChange({ phase }))).toEqual({
        shape,
        build,
        verify,
        archive,
      });
    },
  );

  it.each(['fail', 'blocked'])(
    'keeps Verify %s visible after returning to Build',
    (verificationResult) => {
      expect(nativePhaseStatuses(nativeChange({ verificationResult }))).toEqual({
        shape: 'finish',
        build: 'process',
        verify: 'error',
        archive: 'wait',
      });
    },
  );

  it('shows the current Verify failure without animating it', () => {
    const change = nativeChange({ phase: 'verify', verificationResult: 'fail' });

    expect(nativePhaseStatuses(change).verify).toBe('error');
    expect(isNativePhaseRunning(change)).toBe(false);
  });

  it('shows a new real Verify execution over the previous failure', () => {
    const change = nativeChange({
      phase: 'verify',
      verificationResult: 'fail',
      localExecution: { status: 'running', stage: 'verifying' },
    });

    expect(nativePhaseStatuses(change).verify).toBe('process');
    expect(isNativePhaseRunning(change)).toBe(true);
  });

  it.each(['verify-ready', 'await-user'])(
    'keeps passed Verify at its confirmation boundary for %s',
    (stage) => {
      const change = nativeChange({
        phase: 'verify',
        verificationResult: 'pass',
        loop: { stage },
      });

      expect(nativePhaseStatuses(change)).toEqual({
        shape: 'finish',
        build: 'finish',
        verify: 'process',
        archive: 'wait',
      });
      expect(isNativePhaseRunning(change)).toBe(false);
    },
  );

  it('keeps an interrupted current phase in error', () => {
    expect(
      nativePhaseStatuses(
        nativeChange({ localExecution: { status: 'interrupted', stage: 'building' } }),
      ).build,
    ).toBe('error');
  });

  it('finishes Verify at Archive while Archive still awaits completion', () => {
    expect(
      nativePhaseStatuses(nativeChange({ phase: 'archive', verificationResult: 'pass' })),
    ).toEqual({ shape: 'finish', build: 'finish', verify: 'finish', archive: 'process' });
  });

  it.each([
    ['active', 'done', 'done', 'finish'],
    ['active', 'done', 'archive-ready', 'process'],
    ['active', 'active', 'done', 'process'],
  ])(
    'requires both lifecycle and loop completion for active Archive',
    (status, lifecycleStatus, stage, archive) => {
      expect(
        nativePhaseStatuses(
          nativeChange({ status, phase: 'archive', lifecycleStatus, loop: { stage } }),
        ).archive,
      ).toBe(archive);
    },
  );

  it('finishes every archived step even when the retained phase is unknown', () => {
    expect(nativePhaseStatuses(nativeChange({ status: 'archived', phase: 'unknown' }))).toEqual({
      shape: 'finish',
      build: 'finish',
      verify: 'finish',
      archive: 'finish',
    });
  });

  it('does not infer completed stages from an unknown phase and a retained result', () => {
    expect(
      nativePhaseStatuses(nativeChange({ phase: 'unknown', verificationResult: 'fail' })),
    ).toEqual({ shape: 'wait', build: 'wait', verify: 'wait', archive: 'wait' });
  });

  it('keeps an unknown active phase waiting despite completed lifecycle and loop metadata', () => {
    expect(
      nativePhaseStatuses(
        nativeChange({ phase: 'unknown', lifecycleStatus: 'done', loop: { stage: 'done' } }),
      ),
    ).toEqual({ shape: 'wait', build: 'wait', verify: 'wait', archive: 'wait' });
  });
});
