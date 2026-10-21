import { t } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
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
  useDashboardLanguage();
  return (
    <span
      className="dashboard-phase-origin-wave"
      role="status"
      aria-label={t('{0} 正在进行', [label])}
    >
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
  phaseStates,
  onPhaseSelect,
}) {
  useDashboardLanguage();
  return (
    <div className="dashboard-phase-track" role="list" aria-label={ariaLabel}>
      {phases.map(([key, label], index) => {
        const explicit = phaseStates?.[index];
        const state =
          explicit?.state ??
          (archived || index < currentIndex
            ? 'done'
            : index === currentIndex
              ? 'current'
              : 'pending');
        const running = explicit?.running ?? currentPhaseRunning;
        const stateLabel =
          explicit?.label ??
          (state === 'done'
            ? t('已完成')
            : state === 'current' && running
              ? t('正在进行')
              : state === 'current'
                ? t('当前阶段')
                : t('待进行'));
        const content = (
          <>
            <span
              className="dashboard-phase-node"
              {...(state === 'current' && running
                ? {}
                : { 'aria-label': `${label} ${stateLabel}` })}
            >
              {state === 'done' ? (
                '✓'
              ) : state === 'current' && running ? (
                <PhaseOriginWave label={label} />
              ) : (
                index + 1
              )}
            </span>
            <span className="dashboard-phase-label">{label}</span>
            {explicit && <span className="dashboard-phase-status">{stateLabel}</span>}
          </>
        );
        return (
          <div
            key={key}
            className={`dashboard-phase-item is-${state}${state === 'current' && running ? ' is-active' : ''}`}
            role="listitem"
          >
            {index > 0 && <span className="dashboard-phase-rail is-leading" aria-hidden="true" />}
            {index < phases.length - 1 && (
              <span className="dashboard-phase-rail is-trailing" aria-hidden="true" />
            )}
            {onPhaseSelect ? (
              <button
                type="button"
                className="dashboard-phase-select"
                aria-label={`${label} ${stateLabel}`}
                onClick={() => onPhaseSelect(key, index)}
              >
                {content}
              </button>
            ) : (
              content
            )}
          </div>
        );
      })}
    </div>
  );
}
