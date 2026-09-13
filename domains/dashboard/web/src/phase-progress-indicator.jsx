import React from 'react';

const ORIGIN_WAVE_DOTS = Array.from({ length: 25 }, (_, index) => {
  const row = Math.floor(index / 5);
  const column = index % 5;
  const ring = Math.abs(row - 1) + Math.abs(column - 1);
  return {
    index,
    restOpacity: 0.2 + (1 - ring / 6) * 0.75,
    ring,
  };
});

function PhaseOriginWave({ label }) {
  return (
    <span className="dashboard-phase-origin-wave" role="status" aria-label={`${label} 正在进行`}>
      {ORIGIN_WAVE_DOTS.map((dot) => (
        <span
          key={dot.index}
          className="dashboard-phase-origin-wave-dot"
          aria-hidden="true"
          style={{
            '--phase-origin-wave-rest': dot.restOpacity,
            '--phase-origin-wave-ring': dot.ring,
          }}
        />
      ))}
    </span>
  );
}

export function WorkflowPhaseTrack({
  phases,
  currentIndex,
  archived = false,
  currentPhaseRunning = true,
  ariaLabel,
}) {
  return (
    <div className="dashboard-phase-track" role="list" aria-label={ariaLabel}>
      {phases.map(([key, label], index) => {
        const state =
          archived || index < currentIndex
            ? 'done'
            : index === currentIndex
              ? 'current'
              : 'pending';
        const stateLabel =
          state === 'done'
            ? '已完成'
            : state === 'current' && currentPhaseRunning
              ? '正在进行'
              : state === 'current'
                ? '当前阶段'
                : '待进行';
        return (
          <div
            key={key}
            className={`dashboard-phase-item is-${state}${state === 'current' && currentPhaseRunning ? ' is-active' : ''}`}
            role="listitem"
          >
            {index > 0 && <span className="dashboard-phase-rail is-leading" aria-hidden="true" />}
            {index < phases.length - 1 && (
              <span className="dashboard-phase-rail is-trailing" aria-hidden="true" />
            )}
            <span
              className="dashboard-phase-node"
              {...(state === 'current' && currentPhaseRunning
                ? {}
                : { 'aria-label': `${label} ${stateLabel}` })}
            >
              {state === 'done' ? (
                '✓'
              ) : state === 'current' && currentPhaseRunning ? (
                <PhaseOriginWave label={label} />
              ) : (
                index + 1
              )}
            </span>
            <span className="dashboard-phase-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
