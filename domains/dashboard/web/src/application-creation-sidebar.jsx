import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty } from 'antd';
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

export function ApplicationCreationSidebar({ detail, hasRuns, onEvidence, onRuns }) {
  return (
    <div className="any-creation-sidebar">
      <h3>{t('当前候选的验证证据')}</h3>
      {detail ? (
        <ApplicationEvidenceCards detail={detail} onEvidence={onEvidence} />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('正在读取记录')} />
      )}
      <Button block onClick={onRuns} disabled={!hasRuns}>
        {t('查看自定义工作流')}
      </Button>
    </div>
  );
}
