import React, { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { DashboardModal } from './dashboard-modal.jsx';
import { dashboardResponseError } from './dashboard-web-state.js';

const PAGE_SIZE = 50;

export function DashboardGitList({ title, kind, items, hasMore, projectId, useDemo }) {
  const identity = JSON.stringify([projectId, kind, useDemo]);
  const canExpand = hasMore === true || items.length > 5;
  const [openIdentity, setOpenIdentity] = useState(null);
  const [page, setPage] = useState({ items: [], nextCursor: null, total: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restartRequired, setRestartRequired] = useState(false);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const bodyRef = useRef(null);
  const loadMoreRef = useRef(null);
  const requestRef = useRef(null);
  const failedCursorRef = useRef(null);
  const open = openIdentity === identity;

  useEffect(() => {
    setOpenIdentity(null);
    requestRef.current?.abort();
    return () => requestRef.current?.abort();
  }, [identity]);

  const loadPage = async (cursor = null) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    failedCursorRef.current = cursor;
    setLoading(true);
    setError('');
    setRestartRequired(false);
    if (cursor === null) setPage({ items: [], nextCursor: null, total: null });
    try {
      let result;
      if (useDemo) {
        const start = cursor === null ? 0 : Number(cursor);
        const next = start + PAGE_SIZE;
        result = {
          items: items.slice(start, next),
          nextCursor: next < items.length ? String(next) : null,
          total: items.length,
        };
      } else {
        if (!projectId) throw new Error('未选择项目，无法读取 Git 列表。');
        const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor !== null) query.set('cursor', cursor);
        const response = await fetch(
          `/api/dashboard/projects/${encodeURIComponent(projectId)}/git/${kind}?${query}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) {
          if (response.status === 409) {
            failedCursorRef.current = null;
            setRestartRequired(true);
          }
          throw await dashboardResponseError(response);
        }
        result = await response.json();
      }
      if (controller.signal.aborted) return;
      setPage((current) => ({
        ...result,
        items: cursor === null ? result.items : [...current.items, ...result.items],
      }));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || 'Git 列表读取失败。');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const close = () => {
    requestRef.current?.abort();
    setOpenIdentity(null);
    setLoading(false);
  };
  const content = (
    <>
      <span className="dashboard-git-list-heading">{title}</span>
      <ul className="dashboard-git-preview-list">
        {items.slice(0, 5).map((item, index) => (
          <li key={`${index}:${item}`} title={item}>
            {item}
          </li>
        ))}
      </ul>
      {items.length === 0 && <span className="text-xs text-meta">暂无{title}</span>}
    </>
  );

  return (
    <>
      {canExpand ? (
        <button
          ref={triggerRef}
          className={`dashboard-git-list dashboard-git-list-trigger is-${kind}`}
          type="button"
          aria-label={`展开完整${title}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setOpenIdentity(identity);
            void loadPage();
          }}
        >
          {content}
        </button>
      ) : (
        <div className={`dashboard-git-list is-${kind}`}>{content}</div>
      )}
      <DashboardModal
        open={open}
        title={`完整${title}`}
        ariaLabel={`完整${title}`}
        subtitle={
          <span aria-hidden="true">
            {page.total === null ? `已加载 ${page.items.length} 项` : `${page.total} 项`}
          </span>
        }
        className="dashboard-git-modal"
        showFullscreenToggle={false}
        bodyProps={{
          ref: bodyRef,
          tabIndex: 0,
          role: 'region',
          'aria-label': `${title}完整列表内容`,
        }}
        onClose={close}
        afterClose={() => {
          if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
        }}
        wrapProps={{
          onKeyDownCapture: (event) => {
            if (!open || event.key !== 'Tab') return;
            const first = bodyRef.current;
            const last = closeRef.current;
            if (event.shiftKey && event.target === first) {
              event.preventDefault();
              last?.focus({ preventScroll: true });
            } else if (!event.shiftKey && event.target === last) {
              event.preventDefault();
              first?.focus({ preventScroll: true });
            }
          },
        }}
        footer={
          <div className="dashboard-suggestion-actions">
            {(page.nextCursor !== null || error) && (
              <Button
                ref={loadMoreRef}
                loading={loading}
                aria-label={error ? (restartRequired ? '重新加载' : '重试') : '加载更多'}
                aria-busy={loading}
                onClick={() => void loadPage(error ? failedCursorRef.current : page.nextCursor)}
              >
                {error ? (restartRequired ? '重新加载' : '重试') : '加载更多'}
              </Button>
            )}
            <Button ref={closeRef} type="primary" aria-label="关闭" onClick={close}>
              关闭
            </Button>
          </div>
        }
      >
        <span className="sr-only" role="status">
          {page.total === null ? `已加载 ${page.items.length} 项` : `共 ${page.total} 项`}
        </span>
        {error && (
          <p role="alert">
            {title}读取失败：{error}
          </p>
        )}
        {loading && <p role="status">正在读取{title}…</p>}
        {!loading && !error && page.items.length === 0 && <p>暂无{title}</p>}
        <ul className={`dashboard-git-full-list is-${kind}`} aria-label={`${title}完整列表`}>
          {page.items.map((item, index) => (
            <li key={`${index}:${item}`}>{item}</li>
          ))}
        </ul>
      </DashboardModal>
    </>
  );
}
