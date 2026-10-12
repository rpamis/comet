import React from 'react';
import { Collapse } from 'antd';
import { CheckCircleFilled, RightOutlined } from '@ant-design/icons';
import { t } from './dashboard-i18n.js';
import {
  ApplicationStatus,
  ApplicationStateIcon,
  formatApplicationRecordType,
} from './application-record-inspector.jsx';
export function ApplicationStepList({
  steps: originalSteps,
  locator,
  recordId,
  expanded,
  setExpanded,
  selectRecord,
}) {
  const steps = originalSteps.map((s) => ({
    ...s,
    latestStatus: s.current.status,
    current: s.records.find((r) => r.id === recordId) ?? s.current,
  }));
  const phases = [...new Set(steps.map((s) => s.phase))];
  return (
    <div className="any-step-list">
      {phases.map((phase) => {
        const phaseSteps = steps.filter((s) => s.phase === phase);
        const done = phaseSteps.every((s) =>
          ['succeeded', 'cancelled', 'resolved'].includes(s.latestStatus),
        );
        const key = `${locator}:${phase}`;
        const open = expanded[key] ?? !done;
        return (
          <Collapse
            key={phase}
            ghost
            activeKey={open ? [phase] : []}
            onChange={(keys) => setExpanded((v) => ({ ...v, [key]: keys.includes(phase) }))}
            items={[
              {
                key: phase,
                label: (
                  <span className="any-phase-title">
                    <span>
                      {done ? (
                        <CheckCircleFilled className="any-ok" />
                      ) : (
                        <span className="any-empty-dot" />
                      )}
                      {phase === '执行步骤' ? t(phase) : t(phase)}
                    </span>
                    <small>{t('{0} 个已发生步骤', [phaseSteps.length])}</small>
                  </span>
                ),
                children: phaseSteps.map((s) => (
                  <div key={s.stepId}>
                    <button
                      id={`any-record-${s.current.id}`}
                      data-record-id={s.current.id}
                      className={'any-step-row ' + (recordId === s.current.id ? 'selected' : '')}
                      onClick={() => selectRecord(s.current)}
                    >
                      <ApplicationStateIcon status={s.current.status} />
                      <span className="any-step-copy">
                        <b>
                          {s.title === s.stepId ? s.title : t(s.title)}
                          {s.records.length > 1 && <em>{t('{0} 轮', [s.records.length])}</em>}
                          {s.current.attempt > 1 && <em>{t('尝试 {0}', [s.current.attempt])}</em>}
                        </b>
                        <small>
                          {s.current.sequence === null
                            ? t('已准备就绪')
                            : t('顺序 {0}', [s.current.sequence])}{' '}
                          · {formatApplicationRecordType(s.current.type)}
                        </small>
                      </span>
                      <ApplicationStatus value={s.current.status} />
                      <RightOutlined />
                    </button>
                    {s.records.length > 1 && (
                      <Collapse
                        className="any-step-history"
                        ghost
                        items={[
                          {
                            key: 'rounds',
                            label: t('展开各轮记录'),
                            children: s.records.map((r, i) => (
                              <button
                                key={r.id}
                                id={`any-record-${r.id}-round`}
                                className={'any-round-row ' + (recordId === r.id ? 'selected' : '')}
                                onClick={() => selectRecord(r)}
                              >
                                <span>
                                  {t('第 {0} 轮', [i + 1])} ·{' '}
                                  {r.sequence === null ? '—' : `#${r.sequence}`}
                                </span>
                                <ApplicationStatus value={r.status} />
                              </button>
                            )),
                          },
                        ]}
                      />
                    )}
                  </div>
                )),
              },
            ]}
          />
        );
      })}
      <p className="any-footnote">
        {t('只显示已发生的步骤与就绪工作，不推测后续路径、耗时或完成百分比。')}
      </p>
    </div>
  );
}
