import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Tag } from 'antd';
import { t } from './dashboard-i18n.js';
import { ApplicationEvidenceCards } from './application-record-inspector.jsx';
import { refreshApplicationRunPage, mergeApplicationRunPages } from './application-data.js';

// Any 的版本与运行入口独立分页，避免项目首屏或 Creator 历史挤掉应用运行。
export function useApplicationVersionRuns(request, applicationId, enabled, refresh) {
  const [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(null),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const generation = useMemo(() => ({}), [request, applicationId, enabled, refresh, retry]);
  const current = useRef(null),
    pending = useRef(null);
  useLayoutEffect(() => {
    current.current = generation;
    pending.current?.abort();
    setLoading(false);
    setError(null);
    return () => pending.current?.abort();
  }, [generation]);
  const page =
    snapshot && snapshot.applicationId === applicationId && snapshot.request === request
      ? snapshot.page
      : null;
  useEffect(() => {
    if (!enabled || !applicationId) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    request(
      'application-runs',
      { applicationId, kind: 'application', limit: 100 },
      controller.signal,
    )
      .then((next) => {
        if (!controller.signal.aborted && current.current === generation)
          setSnapshot((previous) =>
            controller.signal.aborted
              ? previous
              : {
                  applicationId,
                  generation,
                  request,
                  page: refreshApplicationRunPage(
                    previous?.applicationId === applicationId && previous.request === request
                      ? previous.page
                      : null,
                    next,
                  ),
                },
          );
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          pending.current = null;
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [generation]);
  const loadMore = async () => {
    if (!page?.nextCursor || snapshot.generation !== generation || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await request(
        'application-runs',
        { applicationId, kind: 'application', limit: 100, cursor: page.nextCursor },
        controller.signal,
      );
      if (!controller.signal.aborted && current.current === generation)
        setSnapshot((previous) =>
          controller.signal.aborted || current.current !== generation
            ? previous
            : {
                applicationId,
                generation,
                request,
                page: mergeApplicationRunPages(previous.page, next),
              },
        );
    } catch (failure) {
      if (!controller.signal.aborted && current.current === generation) {
        if (failure.code === 'STALE_APPLICATION_CURSOR') setRetry((value) => value + 1);
        else setError(failure);
      }
    } finally {
      if (!controller.signal.aborted && current.current === generation) {
        pending.current = null;
        setLoading(false);
      }
    }
  };
  return { page, error, loading, loadMore, reload: () => setRetry((value) => value + 1) };
}

export function ApplicationCreationSidebar({
  detail,
  group,
  versionHistory,
  onSelect,
  onEvidence,
  onRuns,
}) {
  const delivered = (group?.creators ?? []).filter(
    (run) => run.status === 'delivered' && run.application,
  );
  const deliveredVersions = new Set(delivered.map((run) => run.application.version));
  const installed = [
    ...new Map(
      (group?.runs ?? [])
        .filter((run) => run.application && !deliveredVersions.has(run.application.version))
        .map((run) => [run.application.version, run]),
    ).values(),
  ];
  return (
    <div className="any-creation-sidebar">
      <h3>{t('已交付版本')}</h3>
      {delivered.map((run) => (
        <button
          className="any-delivered-version"
          key={run.locator}
          onClick={() => onSelect(run.locator)}
        >
          <span>
            <b>v{run.application.version}</b>
            <Tag color="success">{t('已交付')}</Tag>
          </span>
          <code>{run.runId}</code>
          <small>{t('查看版本与分发入口')}</small>
        </button>
      ))}
      {installed.map((run) => (
        <button
          className="any-delivered-version"
          key={run.locator}
          onClick={() => onSelect(run.locator)}
        >
          <b>v{run.application.version}</b>
          <small>{t('已安装的固定版本')}</small>
          <small>{t('查看版本与分发入口')}</small>
        </button>
      ))}
      {!delivered.length && <p className="any-note">{t('已加载的创作记录中暂无已交付版本。')}</p>}
      {versionHistory?.error && (
        <div className="any-run-list-error" role="status">
          <span>{t('版本记录读取失败，暂时显示已加载的版本。')}</span>
          <Button type="link" onClick={versionHistory.reload}>
            {t('重新读取版本记录')}
          </Button>
        </div>
      )}
      {versionHistory?.page?.nextCursor && (
        <Button type="link" loading={versionHistory.loading} onClick={versionHistory.loadMore}>
          {t('加载更多版本记录')}
        </Button>
      )}
      <p className="any-note">
        {t('当前创作与已交付版本分别保留；未确认的方案不会替换已发布内容。')}
      </p>
      <Button block onClick={onRuns} disabled={!group?.runs.length}>
        {t('查看自定义工作流')}
      </Button>
      <h3>{t('当前候选的验证证据')}</h3>
      {detail ? (
        <ApplicationEvidenceCards detail={detail} onEvidence={onEvidence} />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('正在读取记录')} />
      )}
    </div>
  );
}
