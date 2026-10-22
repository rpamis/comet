import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Empty, Space, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { t } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import { DashboardModal } from './dashboard-modal.jsx';
import './dashboard-update.css';

const { Title, Text, Paragraph } = Typography;
async function request(url, options) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? t('更新请求失败'));
  return value;
}

export function useDashboardUpdate(enabled) {
  const [info, setInfo] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const cursor = useRef({ id: null, value: 0 });
  const acceptJob = useCallback((next) => {
    if (!next) return;
    const same = cursor.current.id === next.id;
    const entries = next.entries.filter((entry) => !same || entry.sequence > cursor.current.value);
    cursor.current = { id: next.id, value: next.cursor };
    setJob((previous) => {
      const retained = [...(same ? (previous?.entries ?? []) : []), ...entries].slice(-2000);
      let length = retained.reduce((total, entry) => total + entry.text.length, 0);
      let trimmed = false;
      while (retained.length > 1 && length > 512 * 1024) {
        length -= retained.shift().text.length;
        trimmed = true;
      }
      return {
        ...next,
        entries: retained,
        truncated: next.truncated || (same && previous?.truncated) || trimmed,
      };
    });
  }, []);
  const refresh = useCallback(
    async (force = false, signal) => {
      setChecking(true);
      try {
        const result = await request(`/api/dashboard/update${force ? '?refresh=1' : ''}`, {
          signal,
        });
        if (typeof result?.currentVersion !== 'string' || !Array.isArray(result.projects))
          throw new Error(t('无法读取 Comet 版本信息'));
        setInfo(result);
        acceptJob(result.job);
        setError(null);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        setChecking(false);
      }
    },
    [acceptJob],
  );
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    void refresh(false, controller.signal);
    const timer = setInterval(() => void refresh(false, controller.signal), 60 * 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || job?.status !== 'running') return undefined;
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await request(`/api/dashboard/update/job?after=${cursor.current.value}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          acceptJob(next);
          setError(null);
        }
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, job?.status, acceptJob]);
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      acceptJob(
        await request('/api/dashboard/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirmed: true,
            version: info.latestVersion,
            projectRevision: info.projectRevision,
          }),
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };
  return { info, job, error, checking, starting, refresh, start };
}

export function DashboardVersion({ update, onClick }) {
  useDashboardLanguage();
  return (
    <button
      type="button"
      className="dashboard-version"
      aria-label={t('Comet 版本与更新')}
      onClick={onClick}
    >
      {update.info ? (
        <span className="dashboard-version-number">v{update.info.currentVersion}</span>
      ) : (
        <span className="dashboard-version-number">Comet</span>
      )}
      {update.job?.status === 'running' ? (
        <SyncOutlined spin />
      ) : update.info?.hasUpdate ? (
        <span className="dashboard-version-new">new</span>
      ) : null}
    </button>
  );
}

export function DashboardUpdateModal({ open, update, onClose }) {
  useDashboardLanguage();
  const { info, job, checking, starting, start } = update;
  const showConfirmation =
    info?.hasUpdate &&
    job?.status !== 'running' &&
    !(job?.status === 'completed' && job.version === info.latestVersion);
  return (
    <DashboardModal
      open={open}
      onClose={onClose}
      title={t('Comet 更新')}
      ariaLabel={t('Comet 更新')}
      description={t('检查 npm 正式版本，并更新项目索引中的 Comet 安装。')}
      width={860}
      className="dashboard-settings-modal dashboard-update-modal"
      rootClassName="dashboard-update-modal-root"
      showFullscreen={false}
      showCloseButton
      footer={
        showConfirmation ? (
          <div className="dashboard-update-confirm">
            <Text>{t('确认将以上项目更新到 v{0}？', [info.latestVersion])}</Text>
            <Space wrap>
              <Button disabled={starting} onClick={onClose}>
                {t('暂不更新')}
              </Button>
              <Button
                type="primary"
                disabled={!info.checked || !info.projects.length || checking}
                loading={starting}
                onClick={() => void start()}
              >
                {t(job?.status === 'failed' ? '确认重试更新' : '确认更新')}
              </Button>
            </Space>
          </div>
        ) : null
      }
    >
      <DashboardUpdatePanel update={update} />
    </DashboardModal>
  );
}

function DashboardUpdatePanel({ update }) {
  useDashboardLanguage();
  const { info, job, error, checking, starting, refresh } = update;
  const [follow, setFollow] = useState(true);
  const log = useRef(null);
  useEffect(() => {
    if (follow && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [follow, job?.cursor]);
  const running = job?.status === 'running';
  return (
    <section className="dashboard-update-page" aria-label={t('Comet 更新')}>
      <div className="dashboard-update-heading">
        <Button
          icon={<ReloadOutlined />}
          loading={checking}
          disabled={running || starting}
          onClick={() => void refresh(true)}
        >
          {t('检查新版本')}
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={t('更新请求失败')} description={t(error)} />}
      {!info ? (
        <Spin />
      ) : (
        <>
          <div className="dashboard-update-versions">
            <div>
              <Text type="secondary">{t('当前 Dashboard 版本')}</Text>
              <Title level={2}>v{info.currentVersion}</Title>
            </div>
            <div>
              <Text type="secondary">{t('npm 最新版本')}</Text>
              <Title level={2}>{info.latestVersion ? `v${info.latestVersion}` : '—'}</Title>
            </div>
            <Tag color={!info.checked ? 'warning' : info.hasUpdate ? 'red' : 'default'}>
              {t(
                !info.checked ? '版本检查暂不可用' : info.hasUpdate ? '发现新版本' : '当前无需更新',
              )}
            </Tag>
          </div>
          <Card title={t('更新范围')} size="small">
            <Paragraph>
              {t(
                '默认更新索引中的全部 {0} 个项目，并由 comet update 更新 Comet npm 包和已有安装。',
                [info.projects.length],
              )}
            </Paragraph>
            {info.projects.length ? (
              <ul className="dashboard-update-projects">
                {info.projects.map((project) => (
                  <li key={project}>{project}</li>
                ))}
              </ul>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('项目索引为空，没有可更新的项目')}
              />
            )}
            <Text type="secondary">
              {t(
                '使用默认复制模式，保留各项目的 Skill 语言；跳过可选的新集成。无法自动确定的配置会在日志中报告。',
              )}
            </Text>
          </Card>
        </>
      )}
      {job && (
        <div className="dashboard-update-log-section">
          <div className="dashboard-update-log-heading">
            <Space>
              <Title level={4}>{t('命令行日志')}</Title>
              <Tag
                color={running ? 'processing' : job.status === 'completed' ? 'success' : 'error'}
              >
                {t(running ? '正在更新' : job.status === 'completed' ? '更新完成' : '更新未完成')}
              </Tag>
            </Space>
            <Checkbox checked={follow} onChange={(event) => setFollow(event.target.checked)}>
              {t('跟随最新日志')}
            </Checkbox>
          </div>
          {job.status === 'completed' && (
            <Alert
              type="success"
              showIcon
              message={t('更新命令执行完成')}
              description={t('重新启动 Dashboard 后使用新版本。请先查看日志中的项目更新结果。')}
            />
          )}
          {job.status === 'failed' && (
            <Alert
              type="error"
              showIcon
              message={t('更新未完成')}
              description={t('请根据日志处理失败项，再重新检查版本并确认重试。退出码：{0}', [
                job.exitCode ?? '—',
              ])}
            />
          )}
          {job.truncated && <Text type="secondary">{t('日志较长，仅保留最近的输出。')}</Text>}
          <pre
            ref={log}
            className="dashboard-update-log"
            role="log"
            aria-label={t('更新命令行日志')}
            aria-live="off"
          >
            {job.entries.map((entry) => (
              <span
                key={entry.sequence}
                className={entry.stream === 'stderr' ? 'is-stderr' : undefined}
              >
                {entry.text}
              </span>
            ))}
          </pre>
          <Text type="secondary">
            {t('切换页面不会中断更新；日志保留在当前 Dashboard 进程中。')}
          </Text>
        </div>
      )}
    </section>
  );
}
