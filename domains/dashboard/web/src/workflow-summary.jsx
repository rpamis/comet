import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Empty, Skeleton, Tag } from 'antd';
import { t } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import { DashboardModal } from './dashboard-modal.jsx';
import { nativeChangeBlockers } from './native-status-presentation.js';

export function matchesSummary(change, filter) {
  if (filter === 'failed') return change.verify?.result === 'fail';
  if (filter === 'tasks') return (change.tasks?.total ?? 0) > (change.tasks?.completed ?? 0);
  if (filter === 'running') return change.localExecution?.status === 'running';
  if (filter === 'attention')
    return (
      ['fail', 'blocked'].includes(change.verificationResult) ||
      (change.acceptance?.failed ?? 0) > 0 ||
      (change.acceptance?.blocked ?? 0) > 0 ||
      nativeChangeBlockers(change).length > 0
    );
  if (filter === 'pending') return (change.acceptance?.pending ?? 0) > 0;
  return true;
}
export const summaryLabels = {
  failed: 'Verify 失败',
  tasks: '未完成任务',
  running: '正在执行',
  attention: '失败或阻塞',
  pending: '待验收项',
  git: 'Git 未提交',
};

// 完整读取活跃变更的摘要，统计与筛选共用同一集合；不预读详情或历史归档。
export function useWorkflowSummary({ projectId, workflow, snapshot, demo, enabled }) {
  const scope = projectId + ':' + workflow + ':' + demo;
  const [state, setState] = useState({ rows: [], loading: true, ready: false, error: null });
  const [retry, setRetry] = useState(0);
  const revision = snapshot?.project?.generatedAt;
  useEffect(() => {
    if (!enabled || !snapshot) return;
    const controller = new AbortController();
    if (
      !demo &&
      (workflow === 'native'
        ? snapshot.native?.activeChangeCount
        : snapshot.summary?.activeChanges) === 0
    ) {
      setState({ scope, rows: [], loading: false, ready: true, error: null });
      return;
    }
    if (demo) {
      const rows =
        workflow === 'native' ? (snapshot.native?.changes ?? []) : (snapshot.changes?.active ?? []);
      setState({
        scope,
        rows: rows.filter((row) => row.status === 'active'),
        loading: false,
        ready: true,
        error: null,
      });
      return;
    }
    setState((previous) => ({
      scope,
      rows: previous.scope === scope ? previous.rows : [],
      ready: previous.scope === scope && Boolean(previous.ready),
      loading: true,
      error: null,
    }));
    (async () => {
      const rows = [];
      const seen = new Set();
      let cursor;
      do {
        const params = new URLSearchParams({ status: 'active', limit: '50' });
        if (cursor) params.set('cursor', cursor);
        const endpoint = workflow === 'native' ? 'native-changes' : 'changes';
        const response = await fetch(
          '/api/dashboard/projects/' +
            encodeURIComponent(projectId) +
            '/' +
            endpoint +
            '?' +
            params,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const page = await response.json();
        rows.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error(t('变更列表分页重复，请重试'));
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (!controller.signal.aborted)
        setState({ scope, rows, loading: false, ready: true, error: null });
    })().catch((error) => {
      if (!controller.signal.aborted)
        setState((previous) => ({
          scope,
          rows: previous.scope === scope ? previous.rows : [],
          ready: previous.scope === scope && Boolean(previous.ready),
          loading: false,
          error: error.message,
        }));
    });
    return () => controller.abort();
  }, [projectId, workflow, revision, demo, enabled, retry, scope]);
  return {
    ...(state.scope === scope ? state : { rows: [], loading: true, ready: false, error: null }),
    retry: () => setRetry((value) => value + 1),
  };
}

export function SummaryFilterBar({ filter, onClear, summary }) {
  useDashboardLanguage();
  return (
    <>
      {summary.error && (
        <Alert
          type="warning"
          showIcon
          message={t('统计读取失败')}
          description={summary.error}
          action={<Button onClick={summary.retry}>{t('重试')}</Button>}
        />
      )}
      {filter && (
        <div className="dashboard-summary-filter" role="status">
          <span>
            {t('当前筛选')}：{t(summaryLabels[filter])}
          </span>
          <Button type="link" onClick={onClear}>
            {t('清除筛选')}
          </Button>
        </div>
      )}
    </>
  );
}

function SummaryGroup({ change, kind, loadDetail, onLocate }) {
  const changeRef = useRef(change);
  changeRef.current = change;
  const identity = change.locator ?? change.id ?? change.name;
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(null);
    loadDetail(changeRef.current, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [identity, change.stateVersion, change.updatedAt, loadDetail, retry]);
  if (error)
    return (
      <Alert
        type="error"
        message={error}
        action={<Button onClick={() => setRetry((value) => value + 1)}>{t('重试')}</Button>}
      />
    );
  if (!detail) return <Skeleton active paragraph={{ rows: 2 }} />;
  const items =
    kind === 'tasks'
      ? (detail.tasks?.incomplete ?? [])
      : (detail.acceptanceItems ?? [])
          .filter((item) => item.result === 'pending')
          .map((item) => item.id + ' · ' + item.text);
  return (
    <div>
      <ul className="dashboard-summary-items">
        {items.map((item, index) => (
          <li key={index}>
            <button
              type="button"
              className="dashboard-summary-item-link"
              onClick={() => onLocate(change)}
            >
              {item}
            </button>
          </li>
        ))}
      </ul>
      {!items.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无待处理条目')} />
      )}
      <Button type="link" onClick={() => onLocate(change)}>
        {t('定位到变更详情')}
      </Button>
    </div>
  );
}

function gitStatusLabel(status) {
  if (!status) return '未提交';
  if (status.includes('U') || ['AA', 'DD'].includes(status)) return '冲突';
  if (status.includes('R')) return '重命名';
  if (status.includes('D')) return '删除';
  if (status === '??' || status.includes('A')) return '新增';
  if (status.includes('C')) return '复制';
  return '修改';
}

export function SummaryDetails({ kind, rows, summary, git, loadDetail, onClose, onLocate }) {
  useDashboardLanguage();
  const files =
    git?.dirtyEntries ?? (git?.dirtyFileList ?? []).map((path) => ({ path, status: null }));
  return (
    <DashboardModal
      open={Boolean(kind)}
      title={t(summaryLabels[kind] ?? '')}
      onClose={onClose}
      showFullscreen={false}
      width={760}
      footer={<Button onClick={onClose}>{t('关闭')}</Button>}
    >
      <div className="dashboard-summary-details">
        {kind === 'git' ? (
          <>
            {git?.dirtyEntriesTruncated && (
              <p>{t('仅显示前 {0} 项，共 {1} 个未提交文件', [files.length, git.dirtyFiles])}</p>
            )}
            {git?.dirtyFiles === null ? (
              <Empty description={t('Git 状态未知')} />
            ) : files.length ? (
              <ul className="dashboard-summary-items dashboard-summary-git">
                {files.map((file, i) => (
                  <li key={i}>
                    <Tag>{t(gitStatusLabel(file.status))}</Tag>
                    <code>{file.path}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty description={t('工作区没有未提交文件')} />
            )}
          </>
        ) : summary.loading && !summary.ready ? (
          <Skeleton active />
        ) : summary.error ? (
          <Alert
            type="error"
            message={t('统计读取失败')}
            action={<Button onClick={summary.retry}>{t('重试')}</Button>}
          />
        ) : rows.length ? (
          <Collapse
            items={rows.map((change) => ({
              key: change.locator ?? change.id ?? change.name,
              label: change.displayName ?? change.name,
              extra: (
                <Tag>
                  {kind === 'tasks'
                    ? Math.max(0, (change.tasks?.total ?? 0) - (change.tasks?.completed ?? 0))
                    : (change.acceptance?.pending ?? 0)}
                </Tag>
              ),
              children: (
                <SummaryGroup
                  change={change}
                  kind={kind}
                  loadDetail={loadDetail}
                  onLocate={onLocate}
                />
              ),
            }))}
          />
        ) : (
          <Empty description={t('暂无待处理条目')} />
        )}
      </div>
    </DashboardModal>
  );
}
