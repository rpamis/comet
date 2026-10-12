import { t } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import React, { useEffect, useState } from 'react';
import { App, Button, Card, Input, Select, Space, Typography } from 'antd';
import { EvalErrorGuide } from './eval-guidance.jsx';
export function EvalPresetControls({ base, configuration, onApply, compact = false }) {
  useDashboardLanguage();
  const { message, modal } = App.useApp();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function request(suffix, body, signal) {
    const response = await fetch(base + suffix, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? t('常用配置读取失败'));
    return value;
  }
  useEffect(() => {
    const controller = new AbortController();
    request('/presets', undefined, controller.signal)
      .then((value) => setItems(value.items ?? []))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [base]);
  const current = items.find((item) => item.id === selected);
  const save = (replace) => {
    const value = { name: replace ? current.name : '' };
    modal.confirm({
      title: replace ? t('更新所选常用配置？') : t('保存常用配置'),
      content: (
        <Space direction="vertical">
          <Input
            aria-label={t('配置名称')}
            defaultValue={value.name}
            maxLength={80}
            placeholder={t('例如：日常回归')}
            onChange={(event) => {
              value.name = event.target.value;
            }}
          />
          <Typography.Text type="secondary">
            {t('保存当前目标与执行设置；不保存凭据、启动时基线或失败重跑绑定。')}
          </Typography.Text>
        </Space>
      ),
      onOk: async () => {
        try {
          const preset = await request('/presets', {
            name: value.name,
            config: configuration(),
            ...(replace ? { id: current.id, expectedUpdatedAt: current.updatedAt } : {}),
          });
          setItems((list) => [...list.filter((item) => item.id !== preset.id), preset]);
          setSelected(preset.id);
          setError(null);
          message.success(t('常用配置已保存'));
        } catch (err) {
          setError(err.message);
          message.error(err.message);
          throw err;
        }
      },
    });
  };
  const remove = () =>
    modal.confirm({
      title: t('删除常用配置「{0}」？', [current.name]),
      content: t('历史评估和当前表单内容保留。'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await request(`/presets/${encodeURIComponent(current.id)}/delete`, {
          expectedUpdatedAt: current.updatedAt,
        }).catch((err) => {
          setError(err.message);
          throw err;
        });
        setItems((list) => list.filter((item) => item.id !== current.id));
        setSelected(null);
      },
    });
  const Container = compact ? 'div' : Card;
  return (
    <Container
      {...(compact
        ? { className: 'dashboard-eval-presets' }
        : { size: 'small', title: t('常用配置') })}
    >
      <Space wrap style={{ width: '100%' }}>
        <Select
          aria-label={t('常用配置')}
          placeholder={compact ? t('常用配置') : t('选择已保存的配置')}
          allowClear
          style={{ minWidth: compact ? 150 : 190, maxWidth: '100%' }}
          value={selected ?? undefined}
          onChange={setSelected}
          options={items.map((item) => ({ value: item.id, label: item.name }))}
        />
        {(current || !compact) && (
          <Button disabled={!current || busy} onClick={() => onApply(current.config)}>
            {t('使用所选配置')}
          </Button>
        )}
        {configuration && <Button onClick={() => save(false)}>{t('保存为新配置')}</Button>}
        {configuration && (current || !compact) && (
          <Button disabled={!current} onClick={() => save(true)}>
            {t('更新所选配置')}
          </Button>
        )}
        {(current || !compact) && (
          <Button type={compact ? 'text' : 'default'} disabled={!current} danger onClick={remove}>
            {t('删除所选配置')}
          </Button>
        )}
        {error && (
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const value = await request('/presets');
                setItems(value.items ?? []);
                setError(null);
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('重试读取配置')}
          </Button>
        )}
      </Space>
      {error && (
        <>
          <Typography.Paragraph type="danger">{error}</Typography.Paragraph>
          <EvalErrorGuide error={error} />
        </>
      )}
      {!compact && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('配置仅保存在当前项目；应用后需要重新预检。')}
        </Typography.Paragraph>
      )}
    </Container>
  );
}
