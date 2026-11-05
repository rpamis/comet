import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Progress, Select, Space, Spin, Tag, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { t } from './dashboard-i18n.js';
const { Text } = Typography;
async function request(base, path, body, signal) {
  const response = await fetch(base + path, {
    signal,
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? data.message ?? t('请求失败'));
  return data;
}
const statusLabels = {
  'not-downloaded': '未下载',
  downloading: '下载中',
  cached: '已缓存',
  failed: '下载失败',
  'version-mismatch': '版本不匹配',
};
export function EvalDatasets({
  base,
  value,
  datasetTreatment,
  datasetRoot,
  task,
  accepted,
  onChange,
  onTaskChange,
  onAccept,
  onReady,
}) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [taskListing, setTaskListing] = useState(null),
    [loadingTasks, setLoadingTasks] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const selected = items.find((item) => item.id === value);
  const taskRequestKey = JSON.stringify([base, value, datasetRoot, datasetTreatment]);
  const tasksReady = taskListing?.key === taskRequestKey;
  const tasks = tasksReady ? taskListing.items : [];
  const tasksAvailable = Boolean(value && (datasetRoot || selected?.status === 'cached'));
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const data = await request(base, '/datasets', undefined, controller.signal);
        if (controller.signal.aborted) return;
        setItems(data.items);
        setError(null);
        if (data.items.some((item) => item.status === 'downloading'))
          timer = setTimeout(poll, 1000);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, refresh]);
  useEffect(() => {
    onReady(tasksReady);
  }, [tasksReady, onReady]);
  useEffect(() => {
    const controller = new AbortController();
    setTaskListing(null);
    if (!tasksAvailable) {
      setLoadingTasks(false);
      return () => controller.abort();
    }
    setLoadingTasks(true);
    const query = new URLSearchParams({ datasetTreatment });
    if (datasetRoot) query.set('datasetRoot', datasetRoot);
    void request(base, `/datasets/${value}/tasks?${query}`, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setTaskListing({ key: taskRequestKey, items: data.items });
          setError(null);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTasks(false);
      });
    return () => controller.abort();
  }, [base, value, datasetRoot, datasetTreatment, taskRequestKey, tasksAvailable, refresh]);
  useEffect(() => {
    if (loadingTasks || !tasksReady || !task) return;
    const supported = new Set(
      taskListing.items.filter((item) => item.supported).map((item) => item.id),
    );
    const current = task
      .split(',')
      .filter((id) => supported.has(id))
      .join(',');
    if (current !== task) onTaskChange(current);
  }, [taskListing, tasksReady, loadingTasks, task, onTaskChange]);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const result = await request(base, `/datasets/${value}/download`, {
        licenseAccepted: accepted,
      });
      setItems((current) => current.map((item) => (item.id === value ? result : item)));
      setRefresh((current) => current + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const progress = selected?.progress;
  const phase =
    {
      connecting: '正在连接',
      downloading: '正在下载',
      verifying: '正在校验摘要',
      extracting: '正在解压',
      completed: '正在确认缓存',
    }[progress?.phase] ?? '正在下载';
  return (
    <Space
      direction="vertical"
      size="middle"
      style={{ width: '100%' }}
      className="dashboard-eval-datasets"
    >
      <Text>{t('数据集')}</Text>
      <Select
        aria-label={t('内置数据集')}
        value={value}
        placeholder={t('选择数据集')}
        options={items.map((item) => ({ value: item.id, label: item.name }))}
        onChange={(id) => {
          setError(null);
          onChange(id);
        }}
      />
      <Text type="secondary">{t('选择只展示信息。点击下载后才获取数据，不会启动评测。')}</Text>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => setRefresh((current) => current + 1)}>
              {t('刷新状态')}
            </Button>
          }
        />
      )}
      {selected && (
        <>
          <Space wrap>
            <Text strong>{selected.name}</Text>
            <Tag>v{selected.version}</Tag>
            {!datasetRoot && (
              <Tag
                color={
                  selected.status === 'cached'
                    ? 'success'
                    : selected.status === 'failed'
                      ? 'error'
                      : 'default'
                }
              >
                {t(statusLabels[selected.status])}
              </Tag>
            )}
          </Space>
          {datasetRoot && <Text type="secondary">{datasetRoot}</Text>}
          <Text type="secondary">{selected.sizeHint}</Text>
          <a href={selected.source} target="_blank" rel="noreferrer">
            {t('查看数据来源')}
          </a>
          <a href={selected.licenseUrl} target="_blank" rel="noreferrer">
            {selected.license}
          </a>
          {value === 'workbuddy-code' && (
            <Checkbox checked={accepted} onChange={(event) => onAccept(event.target.checked)}>
              {t('已阅读并接受 WorkBuddy 数据集许可')}
            </Checkbox>
          )}
          {!datasetRoot &&
            (selected.status === 'downloading' ? (
              <>
                <Space>
                  <Spin size="small" />
                  <Text>{t(phase)}</Text>
                </Space>
                {progress?.total > 0 && (
                  <Progress
                    percent={Math.min(
                      100,
                      Math.floor((100 * (progress.bytes ?? 0)) / progress.total),
                    )}
                  />
                )}
                <Text type="secondary">
                  {((progress?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB
                  {progress?.total > 0 ? ` / ${(progress.total / 1024 / 1024).toFixed(1)} MB` : ''}
                </Text>
              </>
            ) : selected.status !== 'cached' ? (
              <>
                {selected.error && <Alert type="warning" message={selected.error} />}
                <Button
                  icon={<DownloadOutlined aria-hidden="true" />}
                  loading={busy}
                  disabled={value === 'workbuddy-code' && !accepted}
                  onClick={() => void download()}
                >
                  {t(
                    selected.status === 'failed'
                      ? '重试下载'
                      : selected.status === 'version-mismatch'
                        ? '重新下载'
                        : '下载数据集',
                  )}
                </Button>
              </>
            ) : (
              <Text type="success">{t('已缓存，评测将复用该版本。')}</Text>
            ))}
          {tasksAvailable && (
            <>
              <Text>{t('选择评测任务')}</Text>
              <Select
                aria-label={t('数据集任务')}
                mode="multiple"
                value={task ? task.split(',') : []}
                loading={loadingTasks}
                placeholder={t('选择一个或多个任务')}
                options={tasks.map((item) => ({
                  value: item.id,
                  label: item.reason ? `${item.id} · ${item.reason}` : item.id,
                  disabled: !item.supported,
                }))}
                onChange={(ids) => onTaskChange(ids.join(','))}
              />
            </>
          )}
        </>
      )}
      <Button
        type="text"
        icon={<ReloadOutlined aria-hidden="true" />}
        onClick={() => setRefresh((current) => current + 1)}
      >
        {t('刷新下载状态')}
      </Button>
    </Space>
  );
}
