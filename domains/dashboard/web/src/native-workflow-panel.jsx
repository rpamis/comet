import React from 'react';

const PHASE_LABELS = {
  shape: 'Shape',
  build: 'Build',
  verify: 'Verify',
  archive: 'Archive',
  invalid: '状态异常',
};

const FRESHNESS_LABELS = {
  missing: '尚无验证',
  invalid: '验证无效',
  stale: '验证已过期',
  complete: '验证完整',
  partial: '部分验证',
  unknown: '状态未知',
};

const DISPOSITION_LABELS = {
  continue: '可继续',
  'await-user': '等待用户',
  blocked: '已阻塞',
  done: '已完成',
};

const ACTION_LABELS = {
  'work-phase': '继续当前阶段',
  'advance-phase': '推进阶段',
  repair: '修复后重试',
  archive: '准备归档',
  none: '无需动作',
};

const CONFLICT_LABELS = {
  'definite-conflict': '明确冲突',
  'possible-overlap': '可能重叠',
};

export function NativeWorkflowPanel({ native }) {
  if (!native) return null;

  const changes = native.changes;
  return (
    <section aria-labelledby="native-workflow-title" className="mt-8">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 id="native-workflow-title" className="text-[28px] font-bold leading-tight">
          Native 工作流
        </h2>
        <span className="text-sm text-muted">面向强模型的轻量变更状态</span>
      </div>

      {changes.length === 0 ? (
        <div className="rounded-lg bg-bg p-8 text-center text-sm text-muted shadow-raised">
          当前没有 Native change。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {changes.map((change) => (
            <NativeChangeCard key={change.name} change={change} />
          ))}
        </div>
      )}
    </section>
  );
}

function NativeChangeCard({ change }) {
  const findingCodes = change.findings.codes;
  const conflictPeers = change.conflicts.peers;

  return (
    <article className="min-w-0 rounded-lg bg-bg p-5 shadow-raised">
      <header className="flex min-w-0 items-start gap-3 border-b border-border-soft pb-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-meta">
            Native change
          </div>
          <h3 className="mt-1 break-all text-base font-semibold leading-snug">{change.name}</h3>
        </div>
        <StatusPill tone={phaseTone(change.phase)}>
          {PHASE_LABELS[change.phase] ?? '状态异常'}
        </StatusPill>
      </header>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StateMetric
          label="验证新鲜度"
          value={FRESHNESS_LABELS[change.verificationFreshness] ?? '状态未知'}
          tone={freshnessTone(change.verificationFreshness)}
        />
        <StateMetric
          label="归档状态"
          value={change.archiveReady ? '可归档' : '尚未就绪'}
          tone={change.archiveReady ? 'ok' : 'neutral'}
        />
        <StateMetric
          label="继续方式"
          value={continuationLabel(change.continuation)}
          tone={continuationTone(change.continuation)}
        />
      </dl>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SummaryList title="结构化发现" empty="无结构化风险">
          {findingCodes.map((code) => (
            <li
              key={code}
              className="break-all rounded-lg bg-surface px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg-2"
            >
              {code}
            </li>
          ))}
        </SummaryList>

        <SummaryList title="关联冲突" empty="未发现冲突变更">
          {conflictPeers.map((peer) => (
            <li
              key={`${peer.change}-${peer.classification}`}
              className="flex min-w-0 items-start gap-2 rounded-lg border border-border-soft px-2.5 py-2"
            >
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${peer.classification === 'definite-conflict' ? 'bg-danger' : 'bg-warn'}`}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block break-all font-mono text-[11px] leading-relaxed text-fg-2">
                  {peer.change}
                </span>
                <span className="block text-[11px] text-meta">
                  {CONFLICT_LABELS[peer.classification] ?? '可能重叠'}
                </span>
              </span>
            </li>
          ))}
        </SummaryList>
      </div>
    </article>
  );
}

function StateMetric({ label, value, tone }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-warm p-3">
      <dt className="text-[11px] font-medium text-meta">{label}</dt>
      <dd className="mt-1">
        <StatusPill tone={tone}>{value}</StatusPill>
      </dd>
    </div>
  );
}

function SummaryList({ title, empty, children }) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-xs font-semibold text-fg-2">{title}</h4>
      {items.length === 0 ? (
        <p className="rounded-lg bg-surface-warm px-3 py-3 text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">{items}</ul>
      )}
    </section>
  );
}

function StatusPill({ tone = 'neutral', children }) {
  const className =
    {
      ok: 'bg-ok-soft text-success',
      warn: 'bg-warn-soft text-warn',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
      neutral: 'bg-surface text-fg-2',
    }[tone] ?? 'bg-surface text-fg-2';

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-tight ${className}`}
    >
      <span className="break-words">{children}</span>
    </span>
  );
}

function phaseTone(phase) {
  if (phase === 'archive') return 'ok';
  if (phase === 'invalid') return 'danger';
  if (phase === 'verify') return 'warn';
  return 'info';
}

function freshnessTone(freshness) {
  if (freshness === 'complete') return 'ok';
  if (freshness === 'partial' || freshness === 'stale') return 'warn';
  if (freshness === 'invalid') return 'danger';
  return 'neutral';
}

function continuationLabel(continuation) {
  if (!continuation) return '状态未知';
  const disposition = DISPOSITION_LABELS[continuation.disposition] ?? '状态未知';
  const action = ACTION_LABELS[continuation.action] ?? '无需动作';
  return continuation.requiresUserDecision
    ? `${disposition} · 需要用户决定`
    : `${disposition} · ${action}`;
}

function continuationTone(continuation) {
  if (!continuation) return 'neutral';
  if (continuation.disposition === 'done') return 'ok';
  if (continuation.disposition === 'blocked') return 'danger';
  if (continuation.disposition === 'await-user') return 'warn';
  return 'info';
}
