import { navigateDashboard, useDashboardNavigation } from './dashboard-navigation.js';
import { useDashboardViewState } from './dashboard-view-state.js';
import { t, localized } from './dashboard-i18n.js';
import { useDashboardLanguage, useDashboardFormLanguage } from './dashboard-language.jsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Popover,
  Select,
  Segmented,
  Space,
  Spin,
  Steps,
  Table,
  Tabs,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  EyeOutlined,
  FileTextOutlined,
  FlagOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  DownOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { renderMarkdown } from './markdown-preview.js';
import './eval-panel.css';
import { DashboardMotion, useDashboardMotion } from './dashboard-motion.jsx';
import {
  EvalFirstUse,
  EvalErrorGuide,
  EvalGuideDrawer,
  evalDisplayError,
} from './eval-guidance.jsx';
import { EvalPresetControls } from './eval-preset-controls.jsx';
import {
  EvalSection,
  EvalRunProgress,
  EvalOverview,
  EvalCases,
  EvalCaseEvidence,
  EvalCoverage,
  EvalConfiguration,
  EvalComparison,
  EvalArtifacts,
  Metric,
  EvalDuration,
  conclusionLabels,
  evalPagination,
} from './eval-results.jsx';

const { Text, Title, Paragraph } = Typography;
const terminal = (status) => ['completed', 'stopped', 'interrupted', 'unknown'].includes(status);
const executionLabels = localized({
  queued: '等待执行',
  preparing: '准备环境',
  generating: '生成用例',
  running: '执行中',
  judging: '判定中',
  finalizing: '整理报告',
  stopping: '停止中',
  completed: '已结束',
  stopped: '已停止',
  interrupted: '异常中断',
  unknown: '历史记录',
});
const sourceLabels = localized({
  authored: '手写用例',
  recommended: '推荐用例',
  'generated-cache': '生成缓存',
  'pending-generation': '待自动生成',
  'fixed-reuse': '复用固定用例',
  quick: '快速冒烟',
  explicit: '指定用例',
});
async function requestJson(base, suffix, { signal, body } = {}) {
  const response = await fetch(base + suffix, {
    signal,
    ...(body !== undefined
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || t('Eval 请求失败')), { status: response.status });
  return data;
}
function locationFor(projectId, runId, mode = 'list') {
  navigateDashboard({ view: 'eval', projectId, runId, mode });
}
function saveArtifact(value, filename) {
  const types = {
    markdown: 'text/markdown;charset=utf-8',
    html: 'text/html;charset=utf-8',
    json: 'application/json;charset=utf-8',
    text: 'text/plain;charset=utf-8',
  };
  const url = URL.createObjectURL(
    new Blob([value.content], { type: types[value.format] || types.text }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function RunStatus({ run }) {
  useDashboardLanguage();
  return (
    <Space size={5} wrap>
      <Tag color={terminal(run.executionStatus) ? 'default' : 'processing'}>
        {executionLabels[run.executionStatus] || run.executionStatus}
      </Tag>
      {terminal(run.executionStatus) && (
        <Tag
          color={
            run.conclusion === 'passed'
              ? 'success'
              : run.conclusion === 'failed'
                ? 'error'
                : 'warning'
          }
        >
          {conclusionLabels[run.conclusion]}
        </Tag>
      )}
      {run.config?.retrySourceRunId && <Tag color="blue">{t('失败重跑')}</Tag>}
    </Space>
  );
}
function EvalMarkdown({ content }) {
  useDashboardLanguage();
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    setHtml('');
    void renderMarkdown(content).then((value) => {
      if (!cancelled) setHtml(value);
    });
    return () => {
      cancelled = true;
    };
  }, [content]);
  return <div className="markdown-body md-github" dangerouslySetInnerHTML={{ __html: html }} />;
}
export function EvalPanel({
  projectId,
  projectPath,
  query = '',
  readOnly = false,
  refreshToken = 0,
  onSettings,
}) {
  useDashboardLanguage();
  const navigation = useDashboardNavigation();
  const base = `/api/dashboard/projects/${encodeURIComponent(projectId)}/eval`;
  const { message, modal } = App.useApp();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(() =>
    navigation.runId ? 'detail' : navigation.mode === 'new' ? 'new' : 'list',
  );
  const [selectedId, setSelectedId] = useState(() => navigation.runId);
  const pageMotion = useDashboardMotion(`${mode}:${selectedId ?? ''}`, 'page');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const stateScope = `${projectId}:eval`;
  const [tab, setTab] = useDashboardViewState(stateScope, `${selectedId}:tab`, 'overview');
  const [runFilter, setRunFilter] = useDashboardViewState(stateScope, 'run-filter', 'all');
  const [runPage, setRunPage] = useDashboardViewState(stateScope, 'run-page', 1);
  const [caseDetail, setCaseDetail] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [followLog, setFollowLog] = useState(true);
  const [logError, setLogError] = useState(null);
  const logView = useRef(null);
  const [downloads, setDownloads] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [baselineId, setBaselineId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [initialConfig, setInitialConfig] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const controller = useRef(null);
  const artifactRequest = useRef(null);
  const downloadRequests = useRef(new Map());
  const active = useRef(true);
  const selectedRef = useRef(selectedId);
  const inFlight = useRef(false);
  selectedRef.current = selectedId;
  const refresh = useCallback(
    async (manual = false) => {
      if (readOnly || inFlight.current) return;
      inFlight.current = true;
      const current = new AbortController();
      controller.current = current;
      if (manual) setLoading(true);
      try {
        const data = await requestJson(
          base,
          `/runs${query ? `?q=${encodeURIComponent(query)}` : ''}`,
          { signal: current.signal },
        );
        if (!active.current || current.signal.aborted) return;
        setRuns(data.items ?? []);
        setError(null);
        const id = selectedRef.current;
        if (id) {
          const run = await requestJson(base, `/runs/${encodeURIComponent(id)}`, {
            signal: current.signal,
          });
          if (active.current && selectedRef.current === id) setDetail(run);
        }
      } catch (err) {
        if (active.current && err.name !== 'AbortError') setError(err.message);
      } finally {
        inFlight.current = false;
        if (active.current) setLoading(false);
      }
    },
    [base, query, readOnly],
  );
  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => {
      active.current = false;
      controller.current?.abort();
      artifactRequest.current?.abort();
      for (const request of downloadRequests.current.values()) request.abort();
      downloadRequests.current.clear();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (refreshToken) void refresh(true);
  }, [refreshToken, refresh]);
  useEffect(() => {
    if (navigation.view !== 'eval' || (navigation.projectId && navigation.projectId !== projectId))
      return;
    const runId = navigation.runId;
    if (selectedRef.current !== runId) {
      selectedRef.current = runId;
      setSelectedId(runId);
      setDetail(null);
      setComparison(null);
      setCaseDetail(null);
      setArtifact(null);
      if (runId) void refresh();
    }
    setMode(runId ? 'detail' : navigation.mode === 'new' ? 'new' : 'list');
  }, [navigation, projectId, refresh]);
  const openRun = async (run) => {
    setSelectedId(run.id);
    selectedRef.current = run.id;
    setDetail(run);
    setMode('detail');
    setComparison(null);
    locationFor(projectId, run.id);
    setDetailLoading(true);
    try {
      const value = await requestJson(base, `/runs/${encodeURIComponent(run.id)}`);
      if (active.current && selectedRef.current === run.id) setDetail(value);
    } catch (err) {
      message.error(err.message);
    } finally {
      if (active.current) setDetailLoading(false);
    }
  };
  const back = () => {
    setMode('list');
    setSelectedId(null);
    selectedRef.current = null;
    setDetail(null);
    setComparison(null);
    locationFor(projectId, null);
  };
  const newRun = (config, review = false) => {
    setInitialConfig(config ?? null);
    setReviewTarget(review);
    setMode('new');
    setSelectedId(null);
    selectedRef.current = null;
    locationFor(projectId, null, 'new');
  };
  const setBaseline = async (run) => {
    const apply = async () => {
      controller.current?.abort();
      const updated = await requestJson(base, `/runs/${encodeURIComponent(run.id)}/baseline`, {
        body: run.baselineRunId ? { expectedPrevious: run.baselineRunId } : {},
      });
      if (!active.current) return;
      setRuns((current) =>
        current.map((item) =>
          item.id === updated.id
            ? updated
            : item.baselineScope === updated.baselineScope
              ? { ...item, isBaseline: false, baselineRunId: updated.id }
              : item,
        ),
      );
      if (selectedRef.current === run.id) setDetail(updated);
      message.success(t('默认基线已设置'));
    };
    if (run.baselineRunId && run.baselineRunId !== run.id) {
      modal.confirm({
        title: t('替换默认基线？'),
        content: (
          <Space direction="vertical">
            <Text>
              {t('原基线：')}
              {run.baselineRunId}
            </Text>
            <Text>
              {t('新基线：')}
              {run.id}
            </Text>
            <Text type="secondary">{t('保留历史结果及启动时绑定的参照。')}</Text>
          </Space>
        ),
        okText: t('确认替换'),
        cancelText: t('取消'),
        onOk: async () => {
          try {
            await apply();
          } catch (err) {
            message.error(err.message);
            throw err;
          }
        },
      });
    } else {
      try {
        await apply();
      } catch (err) {
        message.error(err.message);
      }
    }
  };
  const clearBaseline = (run) =>
    modal.confirm({
      title: t('取消默认基线？'),
      content: t(
        '仅取消当前目标和固定用例集的默认基线。历史结果、其他用例集的基线，以及运行启动时绑定的参照均保留。',
      ),
      okText: t('取消基线'),
      cancelText: t('保留基线'),
      onOk: async () => {
        try {
          const updated = await requestJson(
            base,
            `/runs/${encodeURIComponent(run.id)}/baseline/clear`,
            { body: {} },
          );
          if (!active.current) return;
          setRuns((current) =>
            current.map((item) =>
              item.baselineScope === updated.baselineScope
                ? { ...item, isBaseline: false, baselineRunId: null }
                : item,
            ),
          );
          if (selectedRef.current === run.id) setDetail(updated);
          message.success(t('默认基线已取消'));
        } catch (err) {
          message.error(err.message);
          void refresh(true);
          throw err;
        }
      },
    });
  const stop = async () => {
    controller.current?.abort();
    setBusy(true);
    try {
      setDetail(
        await requestJson(base, `/runs/${encodeURIComponent(detail.id)}/stop`, { body: {} }),
      );
      message.info(t('停止请求已提交，正在核对进程与容器'));
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const rerun = async (failedOnly = false) => {
    setBusy(true);
    try {
      const preview = await requestJson(
        base,
        `/runs/${encodeURIComponent(detail.id)}/rerun-preview`,
        { body: { failedOnly } },
      );
      newRun(preview.config);
    } catch (err) {
      message.error(err.message);
      setError(err.message);
      if (!failedOnly)
        newRun({
          ...detail.config,
          targetType: detail.target.type === 'application' ? 'application' : 'skill',
        });
    } finally {
      setBusy(false);
    }
  };
  const openArtifact = async (id) => {
    const runId = detail.id;
    artifactRequest.current?.abort();
    const request = new AbortController();
    artifactRequest.current = request;
    setLogError(null);
    setArtifactLoading(true);
    setArtifact({ label: id, format: 'text', content: '' });
    try {
      const value = await requestJson(
        base,
        `/runs/${encodeURIComponent(runId)}/artifact?ref=${encodeURIComponent(id)}${id === 'execution.log' ? '&tail=1' : ''}`,
        { signal: request.signal },
      );
      if (active.current && !request.signal.aborted && selectedRef.current === runId)
        setArtifact({ ...value, label: id, runId });
    } catch (err) {
      if (err.name === 'AbortError' || !active.current) return;
      message.error(err.message);
      setArtifact(null);
    } finally {
      if (active.current && artifactRequest.current === request && !request.signal.aborted)
        setArtifactLoading(false);
    }
  };
  const downloadArtifact = async (id) => {
    const runId = detail.id;
    const key = `${runId}/${id}`;
    if (downloadRequests.current.has(key)) return;
    const request = new AbortController();
    downloadRequests.current.set(key, request);
    setDownloads((current) => [...current, key]);
    try {
      const value = await requestJson(
        base,
        `/runs/${encodeURIComponent(runId)}/artifact?ref=${encodeURIComponent(id)}`,
        { signal: request.signal },
      );
      if (active.current && !request.signal.aborted && selectedRef.current === runId)
        saveArtifact(value, `${runId}-${id.split('/').pop()}`);
    } catch (err) {
      if (err.name !== 'AbortError' && active.current) message.error(err.message);
    } finally {
      downloadRequests.current.delete(key);
      if (active.current) setDownloads((current) => current.filter((item) => item !== key));
    }
  };
  useEffect(() => {
    if (artifact?.label !== 'execution.log' || !artifact.runId) return undefined;
    const runId = artifact.runId;
    const controller = new AbortController();
    let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await requestJson(
          base,
          `/runs/${encodeURIComponent(runId)}/artifact?ref=execution.log&tail=1`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setLogError(null);
        setArtifact((current) => {
          if (current?.runId !== runId || current?.label !== 'execution.log') return current;
          if (current.content === value.content && current.truncated === value.truncated)
            return current;
          return { ...current, ...value };
        });
      } catch (error) {
        if (!controller.signal.aborted) setLogError(error.message);
      } finally {
        pending = false;
      }
    };
    void update();
    const timer = terminal(detail?.executionStatus) ? null : setInterval(() => void update(), 3000);
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [base, artifact?.label, artifact?.runId, detail?.executionStatus]);
  useEffect(() => {
    if (artifact?.label !== 'execution.log' || !followLog) return;
    const body = logView.current?.closest('.ant-drawer-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, [artifact?.content, artifact?.label, followLog]);
  const compare = async (id) => {
    setBaselineId(id);
    setBusy(true);
    try {
      setComparison(
        await requestJson(
          base,
          `/runs/${encodeURIComponent(detail.id)}/compare?baseline=${encodeURIComponent(id)}`,
        ),
      );
      setMode('compare');
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const baselineControl = (run) =>
    run.isBaseline ? (
      <Space size={4} wrap>
        <Tag icon={<FlagOutlined />} color="blue">
          {t('默认基线')}
        </Tag>
        <Button size="small" type="text" onClick={() => clearBaseline(run)} disabled={readOnly}>
          {t('取消基线')}
        </Button>
      </Space>
    ) : !run.baselineEligible ? (
      <Tooltip title={t(run.baselineDisabledReason)}>
        <Button
          type="text"
          size="small"
          className="dashboard-eval-unavailable"
          icon={<InfoCircleOutlined />}
          aria-label={t('基线不可用：{0}', [t(run.baselineDisabledReason)])}
        >
          {t('不可设为基线')}
        </Button>
      </Tooltip>
    ) : (
      <Button size="small" onClick={() => void setBaseline(run)} disabled={readOnly}>
        {run.baselineRunId ? t('替换默认基线') : t('设为基线')}
      </Button>
    );
  const filtered = runs.filter((run) =>
    runFilter === 'active'
      ? !terminal(run.executionStatus)
      : runFilter === 'finished'
        ? terminal(run.executionStatus)
        : runFilter === 'baseline'
          ? run.isBaseline
          : true,
  );
  const list = (
    <div className="dashboard-eval-stack">
      <div className="dashboard-eval-summary-band" aria-label={t('评估记录统计')}>
        <Metric label={t('运行记录')} value={runs.length} />
        <Metric
          label={t('进行中')}
          value={runs.filter((run) => !terminal(run.executionStatus)).length}
        />
        <Metric
          label={t('已结束 / 历史')}
          value={runs.filter((run) => terminal(run.executionStatus)).length}
        />
        <Metric label={t('基线组')} value={runs.filter((run) => run.isBaseline).length} />
      </div>
      <div className="dashboard-eval-heading dashboard-eval-list-toolbar">
        <Segmented
          aria-label={t('运行筛选')}
          value={runFilter}
          onChange={(value) => {
            setRunFilter(value);
            setRunPage(1);
          }}
          options={[
            { value: 'all', label: t('全部记录') },
            { value: 'active', label: t('进行中') },
            { value: 'finished', label: t('已结束') },
            { value: 'baseline', label: t('仅看基线') },
          ]}
        />
        <Space wrap>
          {!readOnly && (
            <EvalPresetControls compact base={base} onApply={(config) => newRun(config, true)} />
          )}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'guide', label: t('使用指南'), onClick: () => setGuideOpen(true) },
                {
                  key: 'rules',
                  label: t('基线规则'),
                  onClick: () =>
                    modal.info({
                      title: t('基线规则'),
                      content: t(
                        '同一目标、固定用例与评分规则最多一个默认基线。完整但未通过的结果也可设置；可以替换或取消，历史证据保留。',
                      ),
                    }),
                },
              ],
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label={t('更多操作')} />
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => newRun()}
            disabled={readOnly}
          >
            {t('新建评估')}
          </Button>
        </Space>
      </div>
      {!loading && runs.length === 0 && <EvalFirstUse />}
      {!loading && !filtered.length ? (
        <Empty description={runs.length ? t('没有符合筛选条件的记录') : t('暂无评估记录')}>
          <Paragraph type="secondary">
            {t('选择本地 Skill 或 SDK 应用，预检通过后开始第一次评估。')}
          </Paragraph>
          <Button type="primary" onClick={() => newRun()}>
            {t('新建评估')}
          </Button>
        </Empty>
      ) : (
        <Table
          className="dashboard-eval-history-table"
          rowKey="id"
          loading={loading && !filtered.length}
          dataSource={filtered}
          pagination={{
            ...evalPagination,
            pageSize: 15,
            current: Math.min(runPage, Math.max(1, Math.ceil(filtered.length / 15))),
            onChange: setRunPage,
          }}
          size="small"
          columns={[
            {
              title: t('目标 / 运行'),
              key: 'target',
              onCell: (run) => ({
                className: 'dashboard-eval-target-cell',
                onClick: () => void openRun(run),
              }),
              render: (_, run) => (
                <Button
                  type="text"
                  className="dashboard-eval-run-entry"
                  aria-label={run.target.name}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openRun(run);
                  }}
                >
                  <span className="dashboard-eval-target-info">
                    <span className="dashboard-eval-target-name">{run.target.name}</span>
                    <span className="dashboard-eval-secondary">
                      {run.target.version ?? '—'} ·{' '}
                      {run.origin === 'dashboard' ? 'Dashboard' : t('CLI / 历史')}
                    </span>
                    <span className="dashboard-eval-secondary dashboard-eval-run-id" title={run.id}>
                      {run.id.length > 24 ? `${run.id.slice(0, 12)}…${run.id.slice(-8)}` : run.id}
                    </span>
                  </span>
                  <span className="dashboard-eval-target-cta" aria-hidden="true">
                    {t('查看详情 ')}
                    <RightOutlined />
                  </span>
                </Button>
              ),
            },
            { title: t('状态'), key: 'status', render: (_, run) => <RunStatus run={run} /> },
            {
              title: t('通过用例'),
              key: 'passed',
              render: (_, run) => (
                <span className="dashboard-eval-numeric">
                  {run.passed} / {run.expectedTotal ?? run.total}
                  <br />
                  <Text type="secondary">
                    <EvalDuration value={run.metrics.durationSeconds} />
                  </Text>
                </span>
              ),
            },
            {
              title: t('模型'),
              key: 'model',
              responsive: ['lg'],
              render: (_, run) => (
                <span>
                  {run.config.model ?? run.cases[0]?.model ?? '—'}
                  <br />
                  <Text type="secondary">{run.config.agent ?? '—'}</Text>
                </span>
              ),
            },
            { title: t('基线'), key: 'baseline', render: (_, run) => baselineControl(run) },
          ]}
        />
      )}
    </div>
  );
  const candidates = detail
    ? runs.filter(
        (run) =>
          run.id !== detail.id &&
          run.baselineEligible &&
          run.baselineScope &&
          run.baselineScope === detail.baselineScope,
      )
    : [];
  const defaultReference = detail?.boundBaselineRunId || detail?.baselineRunId;
  const otherBaselines = detail
    ? runs.filter(
        (run) =>
          run.id !== detail.id &&
          run.isBaseline &&
          run.baselineEligible &&
          !candidates.some((candidate) => candidate.id === run.id),
      )
    : [];
  const referenceOption = (run) => ({
    value: run.id,
    label: `${run.target.name} · ${run.target.version ?? '—'} · ${run.id}`,
  });
  const reportHint = detail?.artifacts?.some((item) =>
    ['summary.md', 'summary.html'].includes(item.id),
  )
    ? t('可直接预览或下载已生成的报告，其他文件在「日志与产物」中查看。')
    : terminal(detail?.executionStatus)
      ? t('本次运行未生成报告，可在「日志与产物」中查看执行日志。')
      : t('报告生成后即可预览或下载，页面会自动更新。');
  return (
    <section
      ref={pageMotion}
      className="dashboard-eval-page"
      data-dashboard-scroll="eval"
      data-dashboard-motion="page"
      aria-label={t('Eval 工作台')}
    >
      <EvalGuideDrawer
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onSettings={() => {
          setGuideOpen(false);
          onSettings?.();
        }}
      />
      {error && (
        <Alert
          closable
          type="error"
          showIcon
          message={t('Eval 数据读取失败')}
          description={
            <>
              <Paragraph>{evalDisplayError(error)}</Paragraph>
              <EvalErrorGuide error={error} />
            </>
          }
          action={
            <Button size="small" onClick={() => void refresh(true)}>
              {t('重试')}
            </Button>
          }
          onClose={() => setError(null)}
        />
      )}
      {readOnly ? (
        <Empty description={t('Eval 操作仅在本地 Dashboard 中提供')} />
      ) : mode === 'new' ? (
        <EvalCreate
          base={base}
          projectPath={projectPath}
          onSettings={onSettings}
          settingsRefreshToken={refreshToken}
          initialConfig={initialConfig}
          reviewTarget={reviewTarget}
          onGuide={() => setGuideOpen(true)}
          onBack={back}
          onStarted={(run) => {
            setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
            void openRun(run);
          }}
          runs={runs}
        />
      ) : mode === 'list' ? (
        list
      ) : !detail ? (
        <Spin tip={t('读取评估记录…')} />
      ) : mode === 'compare' ? (
        <div className="dashboard-eval-stack">
          <Button
            className="dashboard-eval-back"
            icon={<ArrowLeftOutlined />}
            onClick={() => setMode('detail')}
          >
            {t('返回详情')}
          </Button>
          <Title level={3}>{t('与基线对比')}</Title>
          <Text type="secondary">{t('临时参照只影响当前查看，不修改默认基线。')}</Text>
          {candidates.length === 0 && !comparison && (
            <Alert
              type="info"
              showIcon
              message={t('当前评估没有匹配的对比参照')}
              description={t(
                '已保存的基线不一定适用于本次评估。只有目标、固定用例和评分规则一致时，才能判定进步或退步；其他基线可以并列查看。需要可比结果时，请使用与基线相同的固定用例和评分规则重新评估。',
              )}
            />
          )}
          <Select
            aria-label={t('临时参照')}
            placeholder={t('选择对比参照或其他基线')}
            value={baselineId ?? undefined}
            options={[
              ...(candidates.length
                ? [{ label: t('可比参照'), options: candidates.map(referenceOption) }]
                : []),
              ...(otherBaselines.length
                ? [
                    {
                      label: t('其他基线 · 仅并列查看'),
                      options: otherBaselines.map(referenceOption),
                    },
                  ]
                : []),
            ]}
            notFoundContent={t('没有其他有效基线；可先将完整评估设为基线')}
            onChange={(id) => void compare(id)}
            loading={busy}
          />
          {comparison && <EvalComparison value={comparison} />}
        </div>
      ) : (
        <div className="dashboard-eval-stack dashboard-eval-detail">
          <div className="dashboard-eval-heading dashboard-eval-breadcrumb">
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={back}>
              {t('运行记录')}
            </Button>
            <Text
              type="secondary"
              className="dashboard-eval-run-id"
              title={detail.id}
              copyable={{ text: detail.id }}
            >
              {detail.id.length > 32
                ? `${detail.id.slice(0, 16)}…${detail.id.slice(-10)}`
                : detail.id}
            </Text>
          </div>
          <div className="dashboard-eval-heading dashboard-eval-masthead">
            <div>
              <Title level={3} className="dashboard-eval-title">
                {detail.target.name}
              </Title>
              <Text type="secondary">
                {detail.target.version ?? t('无版本信息')} ·{' '}
                {detail.target.type === 'application' ? t('SDK 应用') : 'Skill'}
              </Text>
            </div>
            <RunStatus run={detail} />
          </div>
          <EvalRunProgress run={detail} />
          {detail.config.retrySourceRunId && (
            <Alert
              type="info"
              showIcon
              message={t('本次仅重跑失败用例')}
              description={t(
                '原记录：{0}。本次通过不代表完整用例集通过，不能替换完整基线或 SDK 应用验收。',
                [detail.config.retrySourceRunId],
              )}
            />
          )}
          {detail.executionStatus === 'stopping' && (
            <Alert
              type="warning"
              showIcon
              message={t('正在核对进程与实验容器是否停止，现有结果将保留')}
            />
          )}
          {detail.failures?.length > 0 && (
            <Alert
              type="warning"
              message={t('评估限制或执行问题')}
              description={detail.failures.join('\n')}
              showIcon
            />
          )}
          {detail.diagnostics?.length > 0 && (
            <Alert
              type="warning"
              message={t('部分产物不可读取')}
              description={detail.diagnostics.map((item) => t(item)).join('\n')}
            />
          )}
          <Space wrap className="dashboard-eval-actions">
            {detail.availableActions.stop && (
              <Button
                danger
                loading={busy}
                onClick={() => void stop()}
                disabled={detail.executionStatus === 'stopping'}
              >
                {t('停止评估')}
              </Button>
            )}
            {detail.availableActions.rerun && (
              <Button type="primary" loading={busy} onClick={() => void rerun()}>
                {t('修改配置后重新评估')}
              </Button>
            )}
            {detail.availableActions.rerun &&
              detail.cases?.some((item) => item.passed === false) && (
                <Button loading={busy} onClick={() => void rerun(true)}>
                  {t('只重跑失败用例')}
                </Button>
              )}
            {detail.availableActions.compare && (
              <Button
                onClick={() => {
                  if (defaultReference && defaultReference !== detail.id)
                    void compare(defaultReference);
                  else {
                    setComparison(null);
                    setBaselineId(null);
                    setMode('compare');
                  }
                }}
              >
                {t('与基线对比')}
              </Button>
            )}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  ['summary.md', 'Markdown'],
                  ['summary.html', 'HTML'],
                ].flatMap(([id, label]) => [
                  {
                    key: `preview:${id}`,
                    label: t('预览 {0}', [label]),
                    icon: <EyeOutlined />,
                    disabled: !detail.artifacts?.some((item) => item.id === id),
                    onClick: () => void openArtifact(id),
                  },
                  {
                    key: `download:${id}`,
                    label: t('下载 {0}', [label]),
                    icon: <DownloadOutlined />,
                    disabled:
                      !detail.artifacts?.some((item) => item.id === id) ||
                      downloads.includes(`${detail.id}/${id}`),
                    onClick: () => void downloadArtifact(id),
                  },
                ]),
              }}
              popupRender={(menu) => (
                <div className="dashboard-eval-report-menu">
                  {menu}
                  <Text type="secondary">{reportHint}</Text>
                </div>
              )}
            >
              <Button icon={<FileTextOutlined />} aria-label={t('评估报告')}>
                {t('评估报告')} <DownOutlined />
              </Button>
            </Dropdown>
            <Popover
              trigger="click"
              placement="bottomRight"
              title={t('默认参照')}
              content={
                <div className="dashboard-eval-baseline-popover">
                  <Text className="dashboard-eval-context-id" title={detail.baselineRunId ?? ''}>
                    {t('默认基线：')}
                    {detail.baselineRunId ?? t('未设置')}
                  </Text>
                  {detail.boundBaselineRunId && (
                    <Text
                      type="secondary"
                      className="dashboard-eval-context-id"
                      title={detail.boundBaselineRunId}
                    >
                      {t('启动时绑定：')}
                      {detail.boundBaselineRunId}
                    </Text>
                  )}
                  {baselineControl(detail)}
                  <Text type="secondary">{t('同一目标与固定用例集最多一个，可替换或取消。')}</Text>
                </div>
              }
            >
              <Button type="text" icon={<FlagOutlined />} aria-label={t('默认参照')}>
                {t('默认参照')}
              </Button>
            </Popover>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'guide', label: t('使用指南'), onClick: () => setGuideOpen(true) },
                  {
                    key: 'refresh',
                    label: t('刷新状态'),
                    icon: <ReloadOutlined />,
                    onClick: () => void refresh(true),
                  },
                ],
              }}
            >
              <Button type="text" icon={<MoreOutlined />} aria-label={t('更多操作')} />
            </Dropdown>
          </Space>
          <Spin spinning={detailLoading}>
            <Tabs
              tabBarGutter={16}
              activeKey={tab}
              onChange={setTab}
              items={[
                { key: 'overview', label: t('结果概览'), children: <EvalOverview run={detail} /> },
                {
                  key: 'cases',
                  label: t('用例结果'),
                  children: (
                    <EvalCases run={detail} stateScope={stateScope} onSelect={setCaseDetail} />
                  ),
                },
                ...(detail.target.type === 'application'
                  ? [
                      {
                        key: 'coverage',
                        label: t('SDK 覆盖'),
                        children: <EvalCoverage run={detail} />,
                      },
                    ]
                  : []),
                {
                  key: 'logs',
                  label: t('日志与产物'),
                  children: (
                    <EvalArtifacts
                      run={detail}
                      downloads={downloads}
                      onOpen={(id) => void openArtifact(id)}
                      onDownload={(id) => void downloadArtifact(id)}
                    />
                  ),
                },
                {
                  key: 'config',
                  label: t('执行配置'),
                  children: <EvalConfiguration run={detail} />,
                },
              ].map((item) => ({
                ...item,
                children: (
                  <DashboardMotion
                    motionKey={`${selectedId}:${item.key}`}
                    active={tab === item.key}
                  >
                    {item.children}
                  </DashboardMotion>
                ),
              }))}
            />
          </Spin>
        </div>
      )}
      <Drawer
        open={!!caseDetail}
        onClose={() => setCaseDetail(null)}
        title={caseDetail?.task ?? t('用例详情')}
        width={960}
        rootClassName="dashboard-eval-drawer"
        destroyOnHidden
      >
        <EvalCaseEvidence
          value={caseDetail}
          onArtifact={(id) => {
            setCaseDetail(null);
            void openArtifact(id);
          }}
        />
      </Drawer>
      <Drawer
        open={!!artifact}
        onClose={() => {
          artifactRequest.current?.abort();
          setArtifact(null);
        }}
        title={artifact?.label ?? t('报告预览')}
        width={900}
        rootClassName={`dashboard-eval-drawer dashboard-eval-artifact-drawer${artifact?.format === 'html' ? ' dashboard-eval-html-drawer' : ''}`}
        destroyOnHidden
        extra={
          <Space size={12} wrap>
            {artifact?.label === 'execution.log' && (
              <Space size={6}>
                <Text type="secondary">{t('跟随最新')}</Text>
                <Switch
                  aria-label={t('跟随最新日志')}
                  size="small"
                  checked={followLog}
                  onChange={setFollowLog}
                />
              </Space>
            )}
            <Button
              icon={<DownloadOutlined />}
              disabled={artifactLoading || !artifact}
              onClick={() =>
                artifact.label === 'execution.log'
                  ? void downloadArtifact(artifact.label)
                  : saveArtifact(artifact, `${artifact.runId}-${artifact.label.split('/').pop()}`)
              }
            >
              {t('下载文件')}
            </Button>
          </Space>
        }
      >
        {artifact?.label === 'execution.log' && (
          <Paragraph type="secondary">
            {artifact.truncated
              ? t('显示最近 256 KB 日志，下载可获取完整文件。')
              : t('运行期间自动更新日志。')}
            {logError && t('更新失败：{0}', [logError])}
          </Paragraph>
        )}
        <Spin spinning={artifactLoading}>
          {artifact?.format === 'markdown' ? (
            <EvalMarkdown content={artifact.content} />
          ) : artifact?.format === 'html' ? (
            <iframe
              title={t('Eval HTML 报告')}
              sandbox="allow-scripts"
              className="dashboard-eval-report-frame"
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">${artifact.content}`}
            />
          ) : (
            <pre ref={logView} className="dashboard-eval-pre">
              {artifact?.content}
            </pre>
          )}
        </Spin>
      </Drawer>
    </section>
  );
}

const inferTargetType = (target) =>
  /(?:^|[\\/])application\.json$/u.test(String(target ?? '').trim()) ? 'application' : 'skill';

function EvalCreate({
  base,
  projectPath,
  onSettings,
  settingsRefreshToken,
  initialConfig,
  reviewTarget,
  onGuide,
  onBack,
  onStarted,
  runs,
}) {
  useDashboardLanguage();
  const [form] = Form.useForm();
  useDashboardFormLanguage(form);
  const { message } = App.useApp();
  const [step, setStep] = useState(initialConfig && !reviewTarget ? 2 : 0);
  const stepMotion = useDashboardMotion(step, 'panel');
  const [seedConfig, setSeedConfig] = useState(initialConfig);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [agents, setAgents] = useState(['claude-code', 'codex', 'qoder', 'codebuddy']);
  const launchId = useRef(null);
  const live = useRef(true);
  const overrides = useRef(new Set(Object.keys(initialConfig ?? {})));
  const [userSettings, setUserSettings] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const targetTypeSelection =
    Form.useWatch('targetType', form) ?? initialConfig?.targetType ?? 'auto';
  const targetPath = Form.useWatch('target', form);
  const targetType =
    targetTypeSelection === 'auto' ? inferTargetType(targetPath) : targetTypeSelection;
  const judgeEnabled = Form.useWatch('judgeEnabled', form);
  Form.useWatch([], form);
  const summaryConfig = preview?.config ?? form.getFieldsValue(true);
  const budgetFor = (type) => ({
    timeoutSeconds:
      userSettings?.defaults?.[`${type}TimeoutSeconds`] ?? (type === 'application' ? 1200 : 600),
    maxTurns: userSettings?.defaults?.[`${type}MaxTurns`] ?? (type === 'application' ? 8 : 40),
  });
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/dashboard/eval/settings', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value) => {
        if (controller.signal.aborted || !value.defaults) return;
        setUserSettings(value);
        const type =
          form.getFieldValue('targetType') === 'application' ||
          (form.getFieldValue('targetType') === 'auto' &&
            inferTargetType(form.getFieldValue('target')) === 'application')
            ? 'application'
            : 'skill';
        const defaults = {
          ...Object.fromEntries(
            [
              'agent',
              'model',
              'baseUrl',
              'judgeEnabled',
              'judgeAgent',
              'judgeModel',
              'judgeBaseUrl',
            ].map((key) => [key, value.defaults[key]]),
          ),
          timeoutSeconds: value.defaults[`${type}TimeoutSeconds`],
          maxTurns: value.defaults[`${type}MaxTurns`],
        };
        form.setFieldsValue(
          Object.fromEntries(
            Object.entries(defaults).filter(([key]) => !overrides.current.has(key)),
          ),
        );
        setPreview(null);
        launchId.current = null;
      })
      .catch(() => {});
    return () => controller.abort();
  }, [form, settingsRefreshToken]);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void requestJson(base, '/capabilities', { signal: controller.signal })
      .then((data) => {
        if (live.current && data.agents?.length) setAgents(data.agents);
      })
      .catch(() => {});
    return () => {
      live.current = false;
      controller.abort();
    };
  }, [base]);
  const configuration = () => {
    const values = form.getFieldsValue(true);
    const config = { ...seedConfig, ...values };
    if (config.targetType === 'auto') delete config.targetType;
    if (!config.judgeEnabled) {
      delete config.judgeAgent;
      delete config.judgeModel;
      delete config.judgeBaseUrl;
    }
    delete config.baselineRunId;
    for (const key of Object.keys(config))
      if (config[key] === '' || config[key] === undefined || config[key] === null)
        delete config[key];
    if (targetType === 'application') {
      delete config.quick;
      delete config.task;
      delete config.profile;
      delete config.baseUrl;
      delete config.judgeBaseUrl;
      config.suite = 'local';
    }
    return config;
  };
  const inspect = async (advance = false) => {
    setBusy(true);
    setError(null);
    try {
      if (step !== 1) await form.validateFields();
      if (!String(form.getFieldValue('target') ?? '').trim())
        throw new Error(t('请选择本地目标路径'));
      const value = await requestJson(base, '/preview', { body: configuration() });
      if (!live.current) return;
      setPreview(value);
      launchId.current = crypto.randomUUID();
      if (advance) setStep((current) => Math.min(2, current + 1));
    } catch (err) {
      if (live.current) setError(err.message || t('请补齐目标配置'));
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const start = async () => {
    if (starting || !preview || preview.blockedReasons.length) return;
    setStarting(true);
    setError(null);
    try {
      const baselineRunId = form.getFieldValue('baselineRunId') ?? null;
      const run = await requestJson(base, '/runs', {
        body: {
          config: preview.config,
          confirmationHash: preview.confirmationHash,
          requestId: launchId.current,
          baselineRunId,
        },
      });
      if (live.current) onStarted(run);
    } catch (err) {
      if (live.current) {
        setError(err.message);
        if (err.status === 409) setPreview(null);
      }
    } finally {
      if (live.current) setStarting(false);
    }
  };
  const options = agents.map((value) => ({ value }));
  const baselineCandidates = runs.filter(
    (run) => run.isBaseline && run.baselineEligible && preview?.target.id === run.target.id,
  );
  return (
    <div
      ref={stepMotion}
      className="dashboard-eval-stack dashboard-eval-create"
      data-dashboard-motion="panel"
    >
      <div className="dashboard-eval-heading dashboard-eval-masthead">
        <div>
          <Text className="dashboard-eval-eyebrow">{t('EVAL / 新运行')}</Text>
          <Title level={3} className="dashboard-eval-title">
            {t('新建评估')}
          </Title>
          <Text type="secondary">{t('固定目标与用例，检查环境后开始执行。')}</Text>
        </div>
        <Space wrap>
          <Button type="text" onClick={onGuide}>
            {t('使用指南')}
          </Button>
          <Button onClick={onBack} disabled={starting}>
            {t('返回记录')}
          </Button>
        </Space>
      </div>
      <EvalPresetControls
        compact
        base={base}
        configuration={configuration}
        onApply={(config) => {
          const cleared = Object.fromEntries(
            Object.keys(form.getFieldsValue(true)).map((key) => [key, undefined]),
          );
          form.setFieldsValue({
            ...cleared,
            ...config,
            targetType: config.targetType ?? 'auto',
            judgeEnabled: config.judgeEnabled ?? Boolean(config.judgeModel),
          });
          setSeedConfig(config);
          overrides.current = new Set(Object.keys(config));
          setPreview(null);
          setError(null);
          launchId.current = null;
          setStep(0);
        }}
      />
      {seedConfig?.retrySourceRunId && (
        <Alert
          type="info"
          showIcon
          message={t('失败用例重跑 · 原记录 {0}', [seedConfig.retrySourceRunId])}
          description={t(
            '仅执行原记录中失败的组合，完整用例和基线保持原状；环境异常也可在修复后重跑。',
          )}
        />
      )}
      <Steps
        current={step}
        items={[{ title: t('目标与快照') }, { title: t('用例与标准') }, { title: t('执行与确认') }]}
      />
      {error && (
        <Alert
          type="error"
          showIcon
          message={t('评估配置需要调整')}
          description={
            <>
              <Paragraph>{evalDisplayError(error)}</Paragraph>
              <EvalErrorGuide error={error} />
            </>
          }
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          targetType: 'auto',
          suite: 'local',
          timeoutSeconds: 1200,
          maxTurns: 8,
          judgeEnabled: initialConfig
            ? (initialConfig.judgeEnabled ?? Boolean(initialConfig.judgeModel))
            : undefined,
          ...initialConfig,
        }}
        onValuesChange={(changed) => {
          for (const key of Object.keys(changed)) overrides.current.add(key);
          if (Object.keys(changed).every((key) => key === 'baselineRunId')) return;
          setPreview(null);
          setError(null);
          if (
            step === 0 &&
            typeof changed.target === 'string' &&
            form.getFieldValue('targetType') === 'auto'
          ) {
            const type = inferTargetType(changed.target);
            form.setFieldsValue(
              Object.fromEntries(
                Object.entries(budgetFor(type)).filter(([key]) => !overrides.current.has(key)),
              ),
            );
          }
          launchId.current = null;
        }}
      >
        {step === 0 && (
          <Card size="small" title={t('评估目标')}>
            <Form.Item label={t('目标类型')} name="targetType">
              <Select
                options={[
                  { value: 'auto', label: t('自动识别（推荐）') },
                  { value: 'application', label: t('SDK 应用') },
                  { value: 'skill', label: 'Skill / Eval manifest' },
                ]}
                onChange={(type) => {
                  form.setFieldsValue({
                    previousExperimentId: undefined,
                    quick: false,
                    task: undefined,
                    ...Object.fromEntries(
                      Object.entries(
                        budgetFor(
                          type === 'auto' ? inferTargetType(form.getFieldValue('target')) : type,
                        ),
                      ).filter(([key]) => !overrides.current.has(key)),
                    ),
                  });
                }}
              />
            </Form.Item>
            <Form.Item
              label={t('目标路径')}
              name="target"
              rules={[{ required: true, message: t('请选择本地目标路径') }]}
              extra={
                <Text type="secondary" className="dashboard-eval-secondary">
                  {t('支持本机绝对路径；相对路径基于当前选中的项目')}
                  {projectPath ? `：${projectPath}` : ''}。
                </Text>
              }
            >
              <Input
                placeholder={
                  targetTypeSelection === 'auto'
                    ? t('Skill 目录、SKILL.md、comet/eval.yaml 或 application.json')
                    : targetType === 'application'
                      ? '.comet/applications/example/application.json'
                      : t('Skill 目录、SKILL.md 或 comet/eval.yaml')
                }
              />
            </Form.Item>
            <Form.Item
              label={targetType === 'application' ? t('评估目标') : t('评估目的（记录备注）')}
              name="goal"
            >
              <Input.TextArea
                rows={3}
                maxLength={4000}
                placeholder={t('希望验证的任务、用户决定或恢复行为')}
              />
            </Form.Item>
            <Text type="secondary">
              {t('选择与预览不会调用模型。目标内容和依赖在正式运行时固定。')}
            </Text>
          </Card>
        )}
        {step === 1 && (
          <div className="dashboard-eval-stack">
            <Card title={t('目标与用例身份')} size="small">
              {preview ? (
                <Descriptions
                  size="small"
                  column={1}
                  items={[
                    {
                      key: 'target',
                      label: t('目标'),
                      children: `${preview.target.name} · ${preview.target.version ?? t('无版本信息')}`,
                    },
                    { key: 'path', label: t('路径'), children: preview.target.path },
                    {
                      key: 'content',
                      label: t('内容身份'),
                      children: <Text code>{preview.target.contentHash}</Text>,
                    },
                    {
                      key: 'source',
                      label: t('用例来源'),
                      children: sourceLabels[preview.taskSource] ?? preview.taskSource,
                    },
                  ]}
                />
              ) : (
                <Alert
                  type="info"
                  message={t('配置发生变化，请重新收集目标与用例')}
                  action={
                    <Button onClick={() => void inspect()} loading={busy}>
                      {t('收集用例')}
                    </Button>
                  }
                />
              )}
            </Card>
            {preview?.taskSource === 'pending-generation' ? (
              <Alert
                type="info"
                showIcon
                message={t('正式运行时生成并固定 {0}–{1} 个用例', [
                  preview.taskCount.min,
                  preview.taskCount.max,
                ])}
                description={t('尚未生成具体用例。生成会调用模型，费用与用例执行费用分别记录。')}
              />
            ) : preview?.tasks?.length ? (
              <EvalSection
                title={t('固定用例')}
                description={t('查看输入与判定标准，确认这些用例能回答本次评估目标。')}
                extra={
                  <Tag>
                    {preview.tasks.length}
                    {t(' 个用例')}
                  </Tag>
                }
              >
                <div className="dashboard-eval-file-list">
                  {preview.tasks.map((item) => (
                    <div className="dashboard-eval-file-row" key={item.name}>
                      <FileTextOutlined />
                      <div className="dashboard-eval-file-name">
                        <Button
                          className="dashboard-eval-target"
                          type="link"
                          onClick={() => setTask(item)}
                        >
                          {item.name}
                        </Button>
                        <Text className="dashboard-eval-case-excerpt" type="secondary">
                          {item.instruction ?? t('由固定用例模板提供输入')}
                        </Text>
                      </div>
                      <Button
                        type="text"
                        onClick={() => setTask(item)}
                        aria-label={t('查看用例 {0}', [item.name])}
                      >
                        {t('查看标准')}
                      </Button>
                    </div>
                  ))}
                </div>
              </EvalSection>
            ) : (
              <Empty description={t('没有可执行用例，请检查目标配置')} />
            )}
            {targetType === 'skill' && (
              <Card size="small" title={t('用例选择')}>
                <Form.Item name="quick" valuePropName="checked">
                  <Checkbox>{t('使用快速冒烟用例')}</Checkbox>
                </Form.Item>
                <Form.Item label={t('指定用例（可选）')} name="task">
                  <Input placeholder={t('使用 manifest 中已声明或内置用例的名称')} />
                </Form.Item>
                <Button loading={busy} onClick={() => void inspect()}>
                  {t('更新用例预览')}
                </Button>
              </Card>
            )}
            <Text type="secondary">
              {t('已有固定用例可查看输入与判定标准。自动生成的用例会在正式运行时固定。')}
            </Text>
          </div>
        )}
        {step === 2 && (
          <div className="dashboard-eval-stack dashboard-eval-execution-grid">
            <Card size="small" className="dashboard-eval-settings-summary">
              <div className="dashboard-eval-heading">
                <div>
                  <Text strong>{t('全局 Eval 设置')}</Text>
                  <br />
                  <Text type="secondary">
                    {userSettings?.defaults
                      ? `${userSettings.defaults.agent} · ${userSettings.defaults.model || t('运行时默认模型')}`
                      : t('模型与凭据可在设置中统一配置')}
                    {t('。本次可调整执行参数。')}
                  </Text>
                </div>
                <Button onClick={onSettings}>{t('编辑 Eval 设置')}</Button>
              </div>
            </Card>
            <Card title={t('执行配置')} size="small">
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'agent',
                    label: t('执行 Agent'),
                    children: summaryConfig.agent || t('运行时默认'),
                  },
                  {
                    key: 'model',
                    label: t('执行模型'),
                    children: summaryConfig.model || t('运行时默认'),
                  },
                  {
                    key: 'judge',
                    label: t('独立 Judge'),
                    children:
                      summaryConfig.judgeEnabled === false || !summaryConfig.judgeModel
                        ? t('未启用')
                        : `${summaryConfig.judgeAgent || t('默认 Agent')} / ${summaryConfig.judgeModel}`,
                  },
                  {
                    key: 'budget',
                    label: t('执行预算'),
                    children: t('{0} 秒 / {1} 轮', [
                      summaryConfig.timeoutSeconds ?? '—',
                      summaryConfig.maxTurns ?? '—',
                    ]),
                  },
                ]}
              />
              <Button
                type="text"
                className="dashboard-eval-override-toggle"
                aria-expanded={overrideOpen}
                aria-controls="eval-run-overrides"
                onClick={() => setOverrideOpen((value) => !value)}
              >
                {overrideOpen ? t('收起临时覆盖') : t('临时覆盖本次配置')}
              </Button>
              <div id="eval-run-overrides" hidden={!overrideOpen}>
                <div className="dashboard-eval-form-section">
                  <EvalSection
                    title={t('执行模型')}
                    description={t('选择适配器与模型，留空的值沿用运行环境。')}
                  />
                  <div className="dashboard-eval-form-grid">
                    <Form.Item label={t('执行 Agent')} name="agent">
                      <AutoComplete options={options} placeholder={t('内置或已安装的适配器 ID')} />
                    </Form.Item>
                    <Form.Item label={t('执行模型')} name="model">
                      <Input placeholder={t('留空沿用目标或当前环境配置')} />
                    </Form.Item>
                  </div>
                </div>
                <div className="dashboard-eval-form-section">
                  <EvalSection
                    title={t('独立判定')}
                    description={t('需要单独的判定模型时，配置独立 Judge。')}
                  />
                  <Form.Item name="judgeEnabled" valuePropName="checked">
                    <Checkbox>{t('配置独立 Judge')}</Checkbox>
                  </Form.Item>
                  {judgeEnabled && (
                    <div className="dashboard-eval-form-grid">
                      <Form.Item label="Judge Agent" name="judgeAgent">
                        <AutoComplete options={options} placeholder={t('独立 Judge 的 Agent')} />
                      </Form.Item>
                      <Form.Item
                        label={t('Judge 模型')}
                        name="judgeModel"
                        rules={[{ required: true, message: t('请指定 Judge 模型') }]}
                      >
                        <Input />
                      </Form.Item>
                    </div>
                  )}
                </div>
                <div className="dashboard-eval-form-section">
                  <EvalSection
                    title={t('执行预算')}
                    description={t('达到总时限或轮数上限时停止执行。')}
                  />
                  <div className="dashboard-eval-form-grid">
                    <Form.Item label={t('评估总时限（秒）')} name="timeoutSeconds">
                      <InputNumber
                        min={30}
                        max={targetType === 'application' ? 3600 : 86400}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Form.Item label={t('最大执行轮数')} name="maxTurns">
                      <InputNumber
                        min={1}
                        max={targetType === 'application' ? 32 : 200}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </div>
                </div>
                <div className="dashboard-eval-form-section">
                  <EvalSection title={t('报告与环境')} />
                  {targetType === 'skill' && (
                    <div className="dashboard-eval-form-grid">
                      <Form.Item label={t('报告与追踪去向')} name="suite">
                        <Select
                          options={[
                            { value: 'local', label: t('本地') },
                            { value: 'langsmith', label: 'LangSmith' },
                            { value: 'langfuse', label: 'Langfuse' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item label={t('执行端点覆盖（可选）')} name="baseUrl">
                        <Input placeholder="https://provider.example/v1" />
                      </Form.Item>
                      <Form.Item label={t('评估 Profile（可选）')} name="profile">
                        <Input placeholder={t('沿用目标配置')} />
                      </Form.Item>
                      {judgeEnabled && (
                        <Form.Item label={t('Judge 端点覆盖（可选）')} name="judgeBaseUrl">
                          <Input />
                        </Form.Item>
                      )}
                    </div>
                  )}
                </div>
                {targetType === 'application' && (
                  <Text type="secondary">
                    {t(
                      'SDK 应用使用完整固定用例和 local 模式；端点由执行环境提供，每个用例执行一次。',
                    )}
                  </Text>
                )}
              </div>
            </Card>
            <Card title={t('预检与执行摘要')} size="small">
              <Button icon={<ReloadOutlined />} loading={busy} onClick={() => void inspect()}>
                {t('检查目标与执行环境')}
              </Button>
              {preview && (
                <div className="dashboard-eval-stack">
                  <Descriptions
                    className="dashboard-eval-preflight-summary"
                    size="small"
                    column={1}
                    items={[
                      {
                        key: 'target',
                        label: t('目标'),
                        children: `${preview.target.name} · ${preview.target.version ?? '—'}`,
                      },
                      {
                        key: 'cases',
                        label: t('用例'),
                        children:
                          preview.taskCount.min === preview.taskCount.max
                            ? t('{0} 个固定用例', [preview.taskCount.min])
                            : t('待生成 {0}–{1} 个', [
                                preview.taskCount.min,
                                preview.taskCount.max,
                              ]),
                      },
                      {
                        key: 'limits',
                        label: t('预算'),
                        children: t('{0} 秒 / {1} 轮', [
                          preview.config.timeoutSeconds,
                          preview.config.maxTurns,
                        ]),
                      },
                      {
                        key: 'agent',
                        label: t('执行 Agent / 模型'),
                        children: `${preview.config.agent} / ${preview.config.model ?? t('运行时默认')}`,
                      },
                      {
                        key: 'judge',
                        label: t('独立 Judge'),
                        children: preview.config.judgeModel
                          ? `${preview.config.judgeAgent} / ${preview.config.judgeModel}`
                          : t('未启用'),
                      },
                      {
                        key: 'cost',
                        label: t('费用'),
                        children: t('会调用模型；当前无法提供完整费用估算'),
                      },
                    ]}
                  />
                  <div className="dashboard-eval-checks">
                    {preview.environment.map((check) => (
                      <div key={check.id}>
                        <Tag
                          color={
                            check.status === 'available'
                              ? 'success'
                              : check.status === 'missing'
                                ? 'error'
                                : 'default'
                          }
                        >
                          {t(check.label)}
                        </Tag>
                        <Text>{evalDisplayError(check.detail)}</Text>
                      </div>
                    ))}
                  </div>
                  {preview.blockedReasons.length > 0 && (
                    <Alert
                      type="error"
                      showIcon
                      message={t('当前无法开始评估')}
                      description={
                        <>
                          <Paragraph>
                            {evalDisplayError(preview.blockedReasons.join('\n'))}
                          </Paragraph>
                          <EvalErrorGuide
                            error={preview.blockedReasons.join('\n')}
                            onSettings={onSettings}
                          />
                        </>
                      }
                    />
                  )}
                  {preview.limitations.map((limit, index) => (
                    <Text key={index} type="secondary">
                      {t(limit)}
                    </Text>
                  ))}
                  {baselineCandidates.length > 0 && (
                    <Form.Item label={t('启动时绑定的基线（可选）')} name="baselineRunId">
                      <Select
                        allowClear
                        options={baselineCandidates.map((run) => ({
                          value: run.id,
                          label: `${run.target.name} · ${run.id}`,
                        }))}
                      />
                    </Form.Item>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}
      </Form>
      <Space
        className="dashboard-eval-heading dashboard-eval-create-footer"
        style={{ justifyContent: 'flex-end' }}
      >
        {step > 0 && (
          <Button onClick={() => setStep((current) => current - 1)} disabled={busy || starting}>
            {t('上一步')}
          </Button>
        )}
        {step < 2 ? (
          <Button
            type="primary"
            aria-label={t('下一步')}
            loading={busy}
            onClick={() => void inspect(true)}
          >
            {t('下一步')}
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<ExperimentOutlined />}
            loading={starting}
            disabled={!preview || preview.blockedReasons.length > 0 || busy}
            onClick={() => void start()}
          >
            {t('开始评估')}
          </Button>
        )}
      </Space>
      <Drawer
        open={!!task}
        onClose={() => setTask(null)}
        title={task?.name ?? t('用例预览')}
        width={720}
        rootClassName="dashboard-eval-drawer"
      >
        <div className="dashboard-eval-stack">
          <EvalSection title={t('输入 / 指令')}>
            <pre className="dashboard-eval-reading">
              {task?.instruction ?? t('由固定用例模板提供')}
            </pre>
          </EvalSection>
          <EvalSection title={t('判定标准')}>
            <pre className="dashboard-eval-reading dashboard-eval-pre">
              {task?.expected
                ? JSON.stringify(task.expected, null, 2)
                : t('由固定验证器提供，运行后展示具体检查项')}
            </pre>
          </EvalSection>
        </div>
      </Drawer>
    </div>
  );
}
