import React, { useEffect } from 'react';
import { Button, Select } from 'antd';
import { AppstoreOutlined, FileTextOutlined } from '@ant-design/icons';
import { t } from './dashboard-i18n.js';
import { ApplicationStatus } from './application-record-inspector.jsx';
import { preferredApplicationRun, groupApplicationRunChildren } from './application-data.js';
import { useDashboardViewState } from './dashboard-view-state.js';

/** 应用是导航单位；版本和记录只在当前应用的内容区切换。 */
export function ApplicationHistorySelector({
  viewScope,
  group,
  selected,
  applicationWorkspace,
  onSelect,
  loading,
  error,
  hasMore,
  onMore,
  onRetry,
  versionHistory,
}) {
  const [filter, setFilter] = useDashboardViewState(viewScope, 'historyVersion', null);
  const selectedVersion = selected?.application
    ? `version:${selected.application.version}`
    : 'draft';
  const filterMatches =
    filter?.key === group?.key &&
    (filter?.version === 'all' || filter?.version === selectedVersion);
  const version = filterMatches ? filter.version : 'all';
  useEffect(() => {
    // 导航可以恢复另一条运行；旧版本筛选不能隐藏当前记录。
    if (filter && !filterMatches) setFilter(null);
  }, [filter, filterMatches, setFilter]);
  const creators = group?.creators ?? [];
  const creatorVersions = new Set(creators.map((run) => run.application?.version));
  const installedVersions = new Map();
  for (const run of group?.runs ?? []) {
    if (
      !creatorVersions.has(run.application?.version) &&
      !installedVersions.has(run.application?.version)
    )
      installedVersions.set(run.application?.version, run);
  }
  const records = applicationWorkspace
    ? [...(group?.runs ?? []), ...(group?.children ?? [])]
    : [...creators, ...installedVersions.values()];
  // 单独打开旧记录或子流程时，当前记录仍须保留在选择器中。
  if (selected && !records.some((run) => run.locator === selected.locator)) records.push(selected);
  const versions = [...new Set(records.map((run) => run.application?.version))];
  const versionKey = (run) => (run.application ? `version:${run.application.version}` : 'draft');
  const visible = records.filter((run) => version === 'all' || versionKey(run) === version);
  const recordOption = (run) => ({
    value: run.locator,
    label: `${run.runId ?? t('无法读取')} · ${run.application ? `v${run.application.version}` : t('未生成版本')}${run.isChild ? ` · ${t('子流程')}` : ''}`,
    searchText: [run.runId, run.goal, run.title, run.application?.version]
      .filter(Boolean)
      .join(' '),
    run,
  });
  let options = visible.map(recordOption);
  if (applicationWorkspace && group) {
    const children = groupApplicationRunChildren(group);
    const included = new Set();
    options = visible
      .filter((run) => !run.isChild)
      .map((run) => {
        const nested = (children.get(run.locator) ?? []).filter((child) => visible.includes(child));
        included.add(run.locator);
        nested.forEach((child) => included.add(child.locator));
        return nested.length
          ? { label: run.runId, options: [run, ...nested].map(recordOption) }
          : recordOption(run);
      });
    options.push(...visible.filter((run) => !included.has(run.locator)).map(recordOption));
  }
  const chooseVersion = (next) => {
    setFilter({ key: group?.key, version: next });
    if (next === 'all' || versionKey(selected) === next) return;
    const chosen = preferredApplicationRun(records.filter((run) => versionKey(run) === next));
    if (chosen) onSelect(chosen.locator);
  };
  return (
    <section
      className="any-context-selector"
      aria-label={t(applicationWorkspace ? '应用运行记录' : '应用版本与创作记录')}
    >
      <div className="any-context-application">
        <span className="any-context-application-icon" aria-hidden="true">
          {group?.id ? <AppstoreOutlined /> : <FileTextOutlined />}
        </span>
        <strong>{group?.title ?? selected?.title}</strong>
      </div>
      <div className="any-context-fields">
        <label>
          <span>{t('应用版本')}</span>
          <Select
            aria-label={t('应用版本')}
            value={version}
            virtual={false}
            onChange={chooseVersion}
            options={[
              { value: 'all', label: t('全部版本') },
              ...versions.map((value) => ({
                value: value === undefined ? 'draft' : `version:${value}`,
                label: value === undefined ? t('未生成版本') : `v${value}`,
              })),
            ]}
          />
        </label>
        <label>
          <span>{t(applicationWorkspace ? '运行记录' : '创作记录')}</span>
          <Select
            aria-label={t(applicationWorkspace ? '运行记录' : '创作记录')}
            value={selected?.locator}
            showSearch
            virtual={false}
            filterOption={(input, option) =>
              (option.searchText ?? '').toLowerCase().includes(input.toLowerCase())
            }
            onChange={onSelect}
            loading={loading && !records.length}
            popupMatchSelectWidth={false}
            classNames={{ popup: { root: 'any-record-select-popup' } }}
            options={options}
            optionRender={({ data: { run, label } }) => (
              <div className="any-record-select-option">
                <span>
                  <span>{label}</span>
                  <ApplicationStatus value={run.status} />
                </span>
                <small>{run.goal ?? run.title}</small>
                {!applicationWorkspace && run.kind === 'application' && (
                  <small>{t('已安装的固定版本')}</small>
                )}
                {run.archive && <small>{t('历史实验 · 只读')}</small>}
              </div>
            )}
          />
        </label>
      </div>
      {(error || hasMore || versionHistory?.error || versionHistory?.page?.nextCursor) && (
        <div className="any-context-history-actions">
          {error && <span role="status">{t('历史记录读取失败，暂时显示已加载的记录。')}</span>}
          {error && (
            <Button size="small" type="link" onClick={onRetry}>
              {t(applicationWorkspace ? '重新读取运行列表' : '重新读取创作记录')}
            </Button>
          )}
          {hasMore && (
            <Button size="small" type="link" loading={loading} onClick={onMore}>
              {t(applicationWorkspace ? '加载更多历史记录' : '加载更多创作记录')}
            </Button>
          )}
          {versionHistory?.error && (
            <span role="status">{t('版本记录读取失败，暂时显示已加载的版本。')}</span>
          )}
          {versionHistory?.error && (
            <Button size="small" type="link" onClick={versionHistory.reload}>
              {t('重新读取版本记录')}
            </Button>
          )}
          {versionHistory?.page?.nextCursor && (
            <Button
              size="small"
              type="link"
              loading={versionHistory.loading}
              onClick={versionHistory.loadMore}
            >
              {t('加载更多版本记录')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
