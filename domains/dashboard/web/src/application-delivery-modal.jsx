import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { t, systemText } from './dashboard-i18n.js';
import { dashboardResponseError } from './dashboard-web-state.js';
import { useDashboardLanguage } from './dashboard-language.jsx';

export function ApplicationDeliveryModal({ projectId, projectPath, detail, demo, onClose }) {
  useDashboardLanguage();
  const [mode, setMode] = useState('install'),
    [scope, setScope] = useState('project');
  const [targetDirectory, setTargetDirectory] = useState(projectPath ?? '');
  const [destination, setDestination] = useState(''),
    [platforms, setPlatforms] = useState(['codex']);
  const [upgrade, setUpgrade] = useState(false),
    [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(!demo),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null),
    [result, setResult] = useState(null),
    [error, setError] = useState(null);
  const endpoint = `/api/dashboard/projects/${encodeURIComponent(projectId)}/application-delivery`;
  useEffect(() => {
    if (demo) {
      setOptions([
        { id: 'codex', name: 'Codex' },
        { id: 'claude', name: 'Claude Code' },
        { id: 'cursor', name: 'Cursor' },
      ]);
      return;
    }
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw await dashboardResponseError(response);
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setOptions(data.platforms);
          setTargetDirectory(data.projectRoot);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, demo]);
  const change = (setter, value) => {
    setter(value);
    setPreview(null);
    setResult(null);
    setError(null);
  };
  const submit = async (confirm = false) => {
    if (demo || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const body = {
      locator: detail.locator,
      action:
        mode === 'install'
          ? confirm
            ? 'install'
            : 'preview-install'
          : confirm
            ? 'export'
            : 'preview-export',
      ...(mode === 'install' ? { scope, targetDirectory, platforms, upgrade } : { destination }),
      ...(confirm ? { confirmationHash: preview?.confirmationHash } : {}),
    };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw await dashboardResponseError(response);
      const data = await response.json();
      if (confirm) {
        setResult(data);
        setPreview(null);
      } else setPreview(data);
    } catch (e) {
      setError(e.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const operation = (value) =>
    t(
      {
        create: '新增',
        replace: '更新',
        update: '更新',
        conflict: '冲突',
        unchanged: '无需修改',
        install: '安装',
        upgrade: '升级',
      }[value] ??
        value ??
        '新增',
    );
  const writes =
    preview && mode === 'install'
      ? [
          ...(preview.hostSkills ?? []).map((s) => ({
            key: s.root,
            name: `${t(s.kind === 'entry' ? '入口 Skill' : '依赖 Skill')} · ${s.name}`,
            path: s.root,
            operation: operation(s.operation),
          })),
          ...(preview.hostIntegration ?? []).flatMap((p) =>
            p.files.map((f) => ({
              key: `${p.platformId}:${f.path}`,
              name: `${p.platformId} · ${t({ rule: '工作流规则', router: 'Hook 路由脚本', 'hook-config': 'Hook 配置' }[f.role] ?? f.role)}`,
              path: f.path,
              operation: operation(f.operation),
            })),
          ),
        ]
      : [];
  const disabled = busy || loading || demo;
  return (
    <Modal
      open
      title={t('分发 / 导出应用')}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      width={780}
      rootClassName="any-delivery-modal"
      footer={
        <Space wrap>
          <Button disabled={busy} onClick={onClose}>
            {t('关闭窗口')}
          </Button>
          <Button
            disabled={disabled || (mode === 'install' ? !platforms.length : !destination.trim())}
            loading={busy && !preview}
            onClick={() => submit()}
          >
            {t(mode === 'install' ? '预览安装' : '预览导出')}
          </Button>
          {preview && (
            <Button type="primary" disabled={disabled} loading={busy} onClick={() => submit(true)}>
              {t(mode === 'install' ? '确认安装' : '确认导出')}
            </Button>
          )}
        </Space>
      }
    >
      <div className="any-delivery-body">
        <p className="any-delivery-identity">
          <b>{detail.application.id}</b>
          <Tag>v{detail.application.version}</Tag>
        </p>
        <p className="any-footnote">
          {t('分发完整应用、入口 Skill、固定依赖和平台配置；保留原运行记录。')}
        </p>
        {demo && (
          <Alert
            showIcon
            type="info"
            message={t('示例预览：可查看分发配置，实际操作请打开本地 Dashboard。')}
          />
        )}
        {error && <Alert showIcon type="error" message={systemText(error)} />}
        {result && (
          <Alert
            showIcon
            type="success"
            message={t(mode === 'install' ? '分发完成' : '导出完成')}
            description={<code>{result.file}</code>}
          />
        )}
        <Segmented
          block
          value={mode}
          disabled={busy}
          options={[
            { value: 'install', label: t('安装到 Agent 平台') },
            { value: 'export', label: t('导出到目录') },
          ]}
          onChange={(v) => change(setMode, v)}
        />
        {mode === 'install' ? (
          <>
            <div className="any-delivery-field">
              <label htmlFor="any-delivery-platforms">{t('目标平台')}</label>
              <Select
                id="any-delivery-platforms"
                mode="multiple"
                value={platforms}
                disabled={disabled}
                options={options.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(v) => change(setPlatforms, v)}
              />
              <Button
                type="link"
                size="small"
                disabled={disabled}
                onClick={() =>
                  change(
                    setPlatforms,
                    options.map((p) => p.id),
                  )
                }
              >
                {t('选择全部平台')}
              </Button>
            </div>
            <div className="any-delivery-field">
              <label>{t('安装范围')}</label>
              <Segmented
                block
                disabled={busy}
                value={scope}
                options={[
                  { value: 'project', label: t('项目') },
                  { value: 'user', label: t('当前用户') },
                ]}
                onChange={(v) => {
                  change(setScope, v);
                  setTargetDirectory(v === 'project' ? (projectPath ?? '') : '');
                }}
              />
            </div>
            <div className="any-delivery-field">
              <label htmlFor="any-delivery-target">{t('目标根目录')}</label>
              <Input
                id="any-delivery-target"
                value={targetDirectory}
                disabled={busy}
                placeholder={t(
                  scope === 'user' ? '留空使用当前用户主目录' : '留空使用当前项目目录',
                )}
                onChange={(e) => change(setTargetDirectory, e.target.value)}
              />
              <small>
                {t(
                  scope === 'user'
                    ? '填写目录可使用自定义用户根目录，平台配置仍按各平台的标准结构写入。'
                    : '可指定其他项目目录，平台配置仍按各平台的标准结构写入。',
                )}
              </small>
            </div>
            <Checkbox
              checked={upgrade}
              disabled={busy}
              onChange={(e) => change(setUpgrade, e.target.checked)}
            >
              {t('升级同名应用，保留活动运行使用的旧版本')}
            </Checkbox>
          </>
        ) : (
          <div className="any-delivery-field">
            <label htmlFor="any-delivery-destination">{t('导出目录')}</label>
            <Input
              id="any-delivery-destination"
              value={destination}
              disabled={busy}
              placeholder={t('输入尚不存在的目标目录')}
              onChange={(e) => change(setDestination, e.target.value)}
            />
            <small>
              {t(
                '导出完整应用包，包含固定依赖和执行模块，不包含运行记录。相对路径按当前项目解析。',
              )}
            </small>
          </div>
        )}
        {preview && (
          <section className="any-delivery-preview" aria-label={t('写入预览')}>
            <h3>{t('写入预览')}</h3>
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: 'target',
                  label: t(mode === 'install' ? '应用存储目录' : '导出目录'),
                  children: <code>{preview.target ?? preview.destination}</code>,
                },
                ...(mode === 'install'
                  ? [{ key: 'operation', label: t('操作'), children: operation(preview.operation) }]
                  : []),
              ]}
            />
            {writes.length > 0 && (
              <Table
                tableLayout="fixed"
                size="small"
                pagination={false}
                dataSource={writes}
                columns={[
                  { title: t('内容'), dataIndex: 'name', width: 155 },
                  { title: t('操作'), dataIndex: 'operation', width: 78 },
                  { title: t('写入路径'), dataIndex: 'path', render: (p) => <code>{p}</code> },
                ]}
              />
            )}
            {preview.requiredCapabilities?.length > 0 && (
              <p>
                {t('需要的 Agent 平台能力')}：{preview.requiredCapabilities.join(', ')}
              </p>
            )}
            {preview.evaluation && (
              <p>
                {t('当前内容的模型评估')}：
                {t(
                  {
                    passed: '通过',
                    failed: '失败',
                    stale: '已失效',
                    incomplete: '未完成',
                    'not-recorded': '无记录',
                    'not-evaluated': '未评估',
                    skipped: '已跳过',
                  }[preview.evaluation.status] ?? '无记录',
                )}
              </p>
            )}
            <Collapse
              size="small"
              items={[
                {
                  key: 'files',
                  label: `${t('完整应用文件')} (${preview.files.length})`,
                  children: (
                    <ul>
                      {preview.files.map((f) => (
                        <li key={f}>
                          <code>{f}</code>
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]}
            />
            <p className="any-footnote">
              {t('确认后将复制这些文件并写入所选平台配置。修改选项后需重新预览。')}
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}
