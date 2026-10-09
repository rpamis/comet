import React from 'react';
import { Steps } from 'antd';
import { StageIcon } from './stage-icons';

const ICON_STAGES = {
  open: 'launch',
  shape: 'design',
  design: 'design',
  build: 'build',
  verify: 'verify',
  archive: 'archive',
};

export function WorkflowPhaseTrack({
  phases,
  phaseStatuses,
  phaseIconStatuses = {},
  currentPhase,
  currentPhaseRunning = false,
  currentPhaseLabel,
  errorLabels = {},
  ariaLabel,
  children,
}) {
  const currentIndex = phases.findIndex(([key]) => key === currentPhase);
  return (
    <div className="dashboard-phase-progress">
      <Steps
        className="dashboard-phase-track"
        role="list"
        aria-label={ariaLabel}
        current={currentIndex}
        orientation="horizontal"
        titlePlacement="vertical"
        responsive={false}
        classNames={{ itemIcon: 'dashboard-phase-icon', itemRail: 'dashboard-phase-rail' }}
        items={phases.map(([key, label], index) => {
          const status = phaseStatuses[key] ?? 'wait';
          const current = key === currentPhase && status !== 'finish';
          const running = current && status === 'process' && currentPhaseRunning;
          const suppliedIconStatus =
            phaseIconStatuses[key] ??
            (status === 'finish'
              ? 'success'
              : status === 'error'
                ? 'error'
                : running
                  ? 'running'
                  : 'idle');
          const iconStatus =
            suppliedIconStatus === 'running' && !running ? 'idle' : suppliedIconStatus;
          const stateLabel = current
            ? currentPhaseLabel
            : status === 'finish'
              ? '已完成'
              : status === 'error'
                ? (errorLabels[key] ?? '执行失败')
                : index < currentIndex
                  ? '未确认完成'
                  : '后续阶段';
          return {
            key,
            status,
            role: 'listitem',
            'aria-label': `${label} ${stateLabel}`,
            'aria-current': current ? 'step' : undefined,
            className: `dashboard-phase-item is-${status === 'finish' ? 'done' : status === 'error' ? 'error' : current ? 'current' : 'pending'}${current && status === 'error' ? ' is-current' : ''}${running ? ' is-active' : ''}`,
            icon: (
              <StageIcon
                key={key}
                stage={ICON_STAGES[key]}
                status={iconStatus}
                size={72}
                className="dashboard-stage-icon"
                surfaceColor="var(--color-surface)"
                decorative
              />
            ),
            title: <span className="dashboard-phase-label">{label}</span>,
            content: (
              <>
                {current && <span className="dashboard-phase-current-caption">当前所在</span>}
                <span className="dashboard-phase-state">{stateLabel}</span>
              </>
            ),
          };
        })}
      />
      {children}
    </div>
  );
}
