import React, { useEffect, useState } from 'react';
import { Alert, Drawer, Empty, Skeleton, Tag, Typography } from 'antd';
import { t } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';

const groups = [
  ['awaiting-user', '等待用户', 'gold'],
  ['verification-blocker', '验收受阻', 'red'],
  ['recovery-required', '需要恢复', 'red'],
  ['unknown-outcome', '结论未知', 'default'],
  ['ready', '可执行', 'blue'],
  ['waiting', '等待工作流推进', 'default'],
];

function reasonText(item) {
  switch (item.reason) {
    case 'dependency':
      return t('等待依赖：{0}', [item.related.join(', ')]);
    case 'dispatch-slot':
      return t('等待派发空位');
    case 'integration':
      return t('等待集成完成');
    case 'unknown':
      return t('等待原因未知');
    default:
      return null;
  }
}

function attentionHref(projectId, item, section) {
  const params = new URLSearchParams({
    view: 'workflow',
    project: projectId,
    workflow: item.workflow,
    change: item.locator,
    ...(section ? { section } : {}),
  });
  return `?${params}`;
}

function AttentionLink({ projectId, item, section, onOpen, children }) {
  return (
    <Typography.Link
      href={attentionHref(projectId, item, section)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(item, section);
      }}
    >
      {children}
    </Typography.Link>
  );
}

export function WorkflowAttentionDrawer({ open, projectId, onClose, onOpen }) {
  useDashboardLanguage();
  const [response, setResponse] = useState(null);
  useEffect(() => {
    if (!open || !projectId) return undefined;
    const controller = new AbortController();
    setResponse(null);
    fetch(`/api/dashboard/projects/${encodeURIComponent(projectId)}/workflow-attention`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((result) => {
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        return result.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setResponse({ projectId, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResponse({ projectId, error: true });
      });
    return () => controller.abort();
  }, [open, projectId]);
  const current = response?.projectId === projectId ? response : null;
  const items = current?.data?.items ?? [];
  const unavailable = current?.data?.unavailable ?? [];
  return (
    <Drawer title={t('待关注变更')} open={open} onClose={onClose} size="min(520px, 100vw)">
      {!current && <Skeleton active aria-label={t('正在读取待关注变更')} />}
      {current?.error && <Alert type="error" title={t('待关注变更读取失败')} showIcon />}
      {unavailable.length > 0 && (
        <Alert
          type="warning"
          title={t('部分工作流状态读取失败：{0}', [unavailable.map(workflowLabel).join(', ')])}
          showIcon
        />
      )}
      {current?.data && items.length === 0 && unavailable.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前项目没有待关注变更')} />
      )}
      {groups.map(([status, label, color]) => {
        const rows = items.filter((item) => item.status === status);
        if (rows.length === 0) return null;
        return (
          <section key={status} className="mb-5" aria-label={t(label)}>
            <h3 className="mb-2">
              <Tag color={color}>{t(label)}</Tag>
            </h3>
            <ul className="space-y-2">
              {rows.map((item) => (
                <li
                  key={item.locator}
                  className="rounded-lg border border-border-soft bg-bg px-3 py-2.5"
                >
                  <div className="min-w-0 break-words font-medium">
                    <AttentionLink projectId={projectId} item={item} onOpen={onOpen}>
                      {item.name}
                    </AttentionLink>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-meta">
                    <span>{workflowLabel(item.workflow)}</span>
                    {item.supervisorParent && <span>Supervisor · {item.supervisorParent}</span>}
                    <span className="break-all">{item.workspace.label}</span>
                  </div>
                  {reasonText(item) && (
                    <p className="mt-1 text-sm text-muted">{reasonText(item)}</p>
                  )}
                  {item.hasEvidence && (
                    <div className="mt-1 text-sm">
                      <AttentionLink
                        projectId={projectId}
                        item={item}
                        section="evidence"
                        onOpen={onOpen}
                      >
                        {t('查看验收证据')}
                      </AttentionLink>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Drawer>
  );
}

function workflowLabel(workflow) {
  return workflow === 'native' ? 'Native' : 'Classic';
}
