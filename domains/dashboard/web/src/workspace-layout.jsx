import React, { useEffect, useState } from 'react';
import { Card, Tooltip } from 'antd';
import { FolderOpenOutlined, FolderOutlined } from '@ant-design/icons';
import { ChangeCountBadge } from './number-transition.jsx';

export function DashboardExplorerRowTooltip({
  name,
  status,
  description,
  workspace,
  message,
  children,
}) {
  const [stacked, setStacked] = useState(
    () => window.matchMedia?.('(max-width: 760px)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 760px)');
    const update = () => setStacked(query?.matches ?? false);
    update();
    query?.addEventListener('change', update);
    return () => query?.removeEventListener('change', update);
  }, []);

  return (
    <Tooltip
      placement={stacked ? 'top' : 'right'}
      trigger={['hover', 'focus']}
      styles={{ root: { pointerEvents: 'none', transition: 'none' } }}
      title={
        <>
          <div>{name}</div>
          <div>{status}</div>
          {description && <div>{description}</div>}
          {workspace && (
            <div>{[workspace.label, workspace.branch].filter(Boolean).join(' · ')}</div>
          )}
          {message && <div>{message}</div>}
        </>
      }
    >
      {children}
    </Tooltip>
  );
}

export function DashboardExplorerFolderIcon({ expanded }) {
  const FolderIcon = expanded ? FolderOpenOutlined : FolderOutlined;
  return (
    <span
      className="dashboard-explorer-folder-stack"
      data-folder-state={expanded ? 'expanded' : 'collapsed'}
      aria-hidden="true"
    >
      <FolderOutlined className="dashboard-explorer-folder-back" />
      <FolderIcon className="dashboard-explorer-folder-front" />
    </span>
  );
}

export function DashboardExplorerRowContent({ name, description, count, status, showIcon = true }) {
  return (
    <>
      {showIcon && <FolderOutlined className="dashboard-explorer-row-icon" aria-hidden="true" />}
      <span className="dashboard-explorer-row-body">
        <span className="dashboard-explorer-row-name">{name}</span>
        {(description || count) && (
          <span className="dashboard-explorer-row-count">
            {description}
            {description && count ? ' · ' : null}
            {count}
          </span>
        )}
      </span>
      <span className="dashboard-explorer-row-status">{status}</span>
    </>
  );
}

export function DashboardExplorerTitle({ count, badgeClassName = '' }) {
  return (
    <h3 className="dashboard-explorer-title">
      Changes Explorer
      <ChangeCountBadge
        count={count}
        className={`dashboard-explorer-count ${badgeClassName}`.trim()}
      />
    </h3>
  );
}

export function DashboardChangeDetail({
  title,
  meta,
  suggestion,
  extra,
  className = '',
  children,
  ...props
}) {
  return (
    <Card
      {...props}
      className={`dashboard-change-detail min-w-0 ${className}`.trim()}
      title={
        <div className={`dashboard-change-detail-header${suggestion ? ' has-suggestion' : ''}`}>
          <div className="dashboard-change-detail-heading">
            <div className="dashboard-change-detail-title">{title}</div>
            {meta && <div className="dashboard-change-detail-meta">{meta}</div>}
          </div>
          {suggestion}
        </div>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}

export function DashboardWorkspaceRegion({ left, center, leftClassName = '', className = '' }) {
  return (
    <div className={`dashboard-workspace-region dashboard-master-detail ${className}`.trim()}>
      <div className={`dashboard-workspace-left ${leftClassName}`.trim()}>{left}</div>
      <div className="dashboard-workspace-center min-w-0">{center}</div>
    </div>
  );
}
