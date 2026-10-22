import { t } from './dashboard-i18n.js';
import { useDashboardLanguage, useDashboardFormLanguage } from './dashboard-language.jsx';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import './eval-panel.css';
import { evalDisplayError } from './eval-guidance.jsx';
import { readEvalDemoSettings } from './eval-demo.js';
const { Text } = Typography;

function SettingsSection({ title, children }) {
  return (
    <section className="dashboard-settings-panel">
      <div className="dashboard-settings-panel-head">
        <h4>{title}</h4>
      </div>
      {children}
    </section>
  );
}

function SettingField(props) {
  return <Form.Item {...props} layout="horizontal" className="dashboard-eval-setting-row" />;
}
const endpoint = '/api/dashboard/eval/settings';
const agents = ['claude-code', 'codex', 'qoder', 'codebuddy'].map((value) => ({
  value,
  label: value,
}));
async function request(path = '', body, signal) {
  const response = await fetch(endpoint + path, {
    cache: 'no-store',
    signal,
    ...(body !== undefined
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? t('Eval 设置请求失败'));
  if (
    path !== '/check' &&
    (!value.defaults ||
      !value.credentials?.main ||
      !value.credentials?.judge ||
      typeof value.revision !== 'string' ||
      !Array.isArray(value.overrides))
  )
    throw new Error(t('Eval 设置响应无效，请刷新或升级 Dashboard'));
  return value;
}
export function EvalSettings({ readOnly = false, onSaved }) {
  const language = useDashboardLanguage();
  const [form] = Form.useForm();
  useDashboardFormLanguage(form);
  const { message } = App.useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [checks, setChecks] = useState(null);
  const [clearMain, setClearMain] = useState(false);
  const [clearJudge, setClearJudge] = useState(false);
  const [clearTracking, setClearTracking] = useState({});
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  const judgeEnabled = Form.useWatch('judgeEnabled', form);
  const agent = Form.useWatch('agent', form);
  const apply = (value) => {
    setData(value);
    form.resetFields();
    form.setFieldsValue({
      suite: 'local',
      langsmithTracing: true,
      ...value.defaults,
      mainKind: value.credentials.main.kind,
      judgeKind: value.credentials.judge.kind,
    });
    setClearMain(false);
    setClearJudge(false);
    setClearTracking({});
    setDirty(false);
    setChecks(null);
  };
  useEffect(() => {
    if (readOnly) {
      apply(readEvalDemoSettings());
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void request('', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) apply(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [readOnly, reload]);
  const save = async () => {
    if (readOnly || saving || loading) return;
    setSaving(true);
    setError(null);
    try {
      await form.validateFields();
      const values = form.getFieldsValue(true);
      const defaults = Object.fromEntries(
        Object.keys(data.defaults).map((key) => [key, values[key] ?? data.defaults[key]]),
      );
      const credentials = {};
      for (const [slot, field, kind, clear] of [
        ['main', 'mainCredential', 'mainKind', clearMain],
        ['judge', 'judgeCredential', 'judgeKind', clearJudge],
      ]) {
        if (clear) credentials[slot] = null;
        else if (values[field]?.trim())
          credentials[slot] = { value: values[field].trim(), kind: values[kind] ?? 'api-key' };
      }
      for (const slot of ['langsmith', 'langfusePublic', 'langfuseSecret']) {
        if (clearTracking[slot]) credentials[slot] = null;
        else if (values[`${slot}Credential`]?.trim())
          credentials[slot] = { value: values[`${slot}Credential`].trim(), kind: 'api-key' };
      }
      const next = await request('', { expectedRevision: data.revision, defaults, credentials });
      apply(next);
      onSaved?.();
      message.success(t('Eval 设置已保存'));
    } catch (err) {
      if (!err.errorFields) setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const credential = (slot) => {
    const main = slot === 'main';
    const status = data?.credentials[slot];
    const clear = main ? clearMain : clearJudge;
    const setClear = main ? setClearMain : setClearJudge;
    const field = main ? 'mainCredential' : 'judgeCredential';
    return (
      <div className="dashboard-eval-settings-credential">
        <div className="dashboard-eval-heading">
          <Text strong>{main ? t('执行凭据') : t('Judge 凭据')}</Text>
          <Tag color={clear ? 'warning' : status?.configured ? 'success' : 'default'}>
            {clear
              ? t('待移除')
              : status?.configured
                ? status.source === 'environment'
                  ? t('由启动环境提供')
                  : t('已配置')
                : t('未配置')}
          </Tag>
        </div>
        <div className="dashboard-eval-form-grid">
          <SettingField
            label={main ? t('执行凭据类型') : t('Judge 凭据类型')}
            name={main ? 'mainKind' : 'judgeKind'}
          >
            <Select
              options={[
                { value: 'api-key', label: 'API key' },
                ...(!main || ['claude-code', 'codebuddy'].includes(agent)
                  ? [{ value: 'auth-token', label: 'Auth token' }]
                  : []),
              ]}
            />
          </SettingField>
          <SettingField label={main ? t('新的执行凭据') : t('新的 Judge 凭据')} name={field}>
            <Input.Password
              autoComplete="off"
              placeholder={status?.configured ? t('留空保留已有凭据') : t('输入凭据')}
              disabled={readOnly || clear}
            />
          </SettingField>
        </div>
        {status?.saved && (
          <Button
            type="text"
            danger={!clear}
            disabled={readOnly || saving}
            onClick={() => {
              setClear(!clear);
              form.setFieldValue(field, '');
              setDirty(true);
            }}
          >
            {clear
              ? main
                ? t('撤销移除执行凭据')
                : t('撤销移除 Judge 凭据')
              : main
                ? t('移除已保存执行凭据')
                : t('移除已保存 Judge 凭据')}
          </Button>
        )}
        {clear && (
          <Text type="secondary">
            {t('保存后移除本机用户配置中的凭据；启动环境中的值保持有效。')}
          </Text>
        )}
      </div>
    );
  };
  const trackingCredential = (slot, label) => {
    const status = data?.credentials?.[slot];
    const clear = !!clearTracking[slot];
    return (
      <div className="dashboard-eval-settings-credential">
        <div className="dashboard-eval-heading">
          <Text strong>{label}</Text>
          <Tag color={clear ? 'warning' : status?.configured ? 'success' : 'default'}>
            {clear
              ? t('待移除')
              : status?.configured
                ? status.source === 'environment'
                  ? t('由启动环境提供')
                  : t('已配置')
                : t('未配置')}
          </Tag>
        </div>
        <SettingField label={t('新的 {0}', [label])} name={`${slot}Credential`}>
          <Input.Password
            autoComplete="off"
            disabled={readOnly || clear}
            placeholder={status?.configured ? t('留空保留已有凭据') : t('输入凭据')}
          />
        </SettingField>
        {status?.saved && (
          <Button
            type="text"
            danger={!clear}
            disabled={readOnly || saving}
            onClick={() => {
              setClearTracking((previous) => ({ ...previous, [slot]: !clear }));
              form.setFieldValue(`${slot}Credential`, '');
              setDirty(true);
            }}
          >
            {clear ? t('撤销移除 {0}', [label]) : t('移除已保存的 {0}', [label])}
          </Button>
        )}
        {clear && (
          <Text type="secondary">
            {t('保存后移除本机用户配置中的凭据；启动环境中的值保持有效。')}
          </Text>
        )}
      </div>
    );
  };
  return (
    <div className="dashboard-eval-page dashboard-eval-settings" aria-label={t('Eval 设置')}>
      <div className="dashboard-eval-heading">
        <div>
          <Text type="secondary">
            {t('本机用户级配置，供所有项目复用。新建评估可覆盖默认值。')}
          </Text>
        </div>
        <Space wrap>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            aria-label={t('保存 Eval 设置')}
            disabled={readOnly || loading || !data}
            loading={saving}
            onClick={() => void save()}
          >
            {t('保存 Eval 设置')}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            disabled={readOnly || loading || saving}
            onClick={() => setReload((value) => value + 1)}
          >
            {t('重新读取设置')}
          </Button>
        </Space>
      </div>
      {readOnly && (
        <Alert
          type="info"
          showIcon
          message={t('示例数据')}
          description={t('Eval 操作仅在本地 Dashboard 中提供')}
        />
      )}
      {error && (
        <Alert type="error" showIcon message={t('Eval 设置需要调整')} description={t(error)} />
      )}
      {data?.warnings?.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('已有配置需要调整')}
          description={data.warnings.map((warning) => t(warning)).join('\n')}
        />
      )}
      <Spin spinning={loading}>
        {data && (
          <Form
            name="eval-user-settings"
            className="dashboard-settings-stack"
            form={form}
            layout="vertical"
            disabled={readOnly}
            onValuesChange={() => {
              setDirty(true);
              setError(null);
            }}
          >
            <SettingsSection title={t('默认执行模型')}>
              <div className="dashboard-eval-form-grid">
                <SettingField label={t('默认执行 Agent')} name="agent" rules={[{ required: true }]}>
                  <Select options={agents} />
                </SettingField>
                <SettingField label={t('默认执行模型')} name="model">
                  <Input placeholder={t('留空沿用目标或启动环境')} />
                </SettingField>
              </div>
              <SettingField label={t('默认执行端点')} name="baseUrl">
                <Input placeholder={t('https://provider.example/v1，留空使用默认端点')} />
              </SettingField>
              {credential('main')}
            </SettingsSection>
            <SettingsSection title={t('独立 Judge')}>
              <SettingField name="judgeEnabled" valuePropName="checked">
                <Checkbox>{t('默认启用独立 Judge')}</Checkbox>
              </SettingField>
              {judgeEnabled && (
                <>
                  <div className="dashboard-eval-form-grid">
                    <SettingField
                      label={t('默认 Judge Agent')}
                      name="judgeAgent"
                      rules={[{ required: true }]}
                    >
                      <Select options={agents} />
                    </SettingField>
                    <SettingField
                      label={t('默认 Judge 模型')}
                      name="judgeModel"
                      rules={[{ required: true, message: t('请填写 Judge 模型') }]}
                    >
                      <Input />
                    </SettingField>
                  </div>
                  <SettingField label={t('默认 Judge 端点')} name="judgeBaseUrl">
                    <Input placeholder={t('留空使用默认端点')} />
                  </SettingField>
                </>
              )}
              {credential('judge')}
            </SettingsSection>
            <SettingsSection title={t('报告与追踪')}>
              <SettingField label={t('默认报告去向')} name="suite">
                <Select
                  options={[
                    { value: 'local', label: t('本地') },
                    { value: 'langsmith', label: 'LangSmith' },
                    { value: 'langfuse', label: 'Langfuse' },
                  ]}
                />
              </SettingField>
              <Text type="secondary">
                {t('用于新建 Skill 评估，可在运行前调整。SDK 应用评估使用本地报告。')}
              </Text>
              <div className="dashboard-eval-form-section">
                <Text strong>LangSmith</Text>
                <div className="dashboard-eval-form-grid">
                  <SettingField label={t('LangSmith 地址')} name="langsmithEndpoint">
                    <Input placeholder="https://api.smith.langchain.com" />
                  </SettingField>
                  <SettingField label={t('LangSmith 项目')} name="langsmithProject">
                    <Input placeholder="comet-skill-eval" />
                  </SettingField>
                </div>
                <SettingField name="langsmithTracing" valuePropName="checked">
                  <Checkbox>{t('LangSmith 轨迹追踪')}</Checkbox>
                </SettingField>
                {trackingCredential('langsmith', 'LangSmith API key')}
              </div>
              <div className="dashboard-eval-form-section">
                <Text strong>Langfuse</Text>
                <div className="dashboard-eval-form-grid">
                  <SettingField label={t('Langfuse 地址')} name="langfuseBaseUrl">
                    <Input placeholder="https://cloud.langfuse.com" />
                  </SettingField>
                  <SettingField label={t('Langfuse 环境')} name="langfuseEnvironment">
                    <Input placeholder={t('可选，例如 development 或 ci')} />
                  </SettingField>
                </div>
                {trackingCredential('langfusePublic', 'Langfuse Public key')}
                {trackingCredential('langfuseSecret', 'Langfuse Secret key')}
              </div>
            </SettingsSection>
            <SettingsSection title={t('默认执行预算')}>
              <div className="dashboard-eval-detail-grid">
                {[
                  ['Skill', 'skill', 86400, 200],
                  [t('SDK 应用'), 'application', 3600, 32],
                ].map(([title, prefix, seconds, turns]) => (
                  <div key={prefix}>
                    <Text strong>{title}</Text>
                    <SettingField
                      label={t('{0} 默认总时限（秒）', [title])}
                      name={`${prefix}TimeoutSeconds`}
                    >
                      <InputNumber min={30} max={seconds} style={{ width: '100%' }} />
                    </SettingField>
                    <SettingField label={t('{0} 默认最大轮数', [title])} name={`${prefix}MaxTurns`}>
                      <InputNumber min={1} max={turns} style={{ width: '100%' }} />
                    </SettingField>
                  </div>
                ))}
              </div>
            </SettingsSection>
            {data.overrides.length > 0 && (
              <Alert
                type="info"
                showIcon
                message={t('启动环境优先于用户配置')}
                description={t(
                  '{0}由 Dashboard 的启动环境提供。保存不会修改这些环境变量；需要调整时，更改启动环境后重启 Dashboard。',
                  [data.overrides.map((label) => t(label)).join(language === 'en' ? ', ' : '、')],
                )}
              />
            )}
            <div className="dashboard-eval-heading">
              <Text type="secondary">
                {dirty ? t('有未保存的更改') : t('已有凭据不会回显，也不会保存到浏览器缓存。')}
              </Text>
              <Space wrap>
                <Button
                  loading={checking}
                  disabled={readOnly || saving || dirty}
                  onClick={async () => {
                    if (readOnly) return;
                    setChecking(true);
                    setError(null);
                    try {
                      setChecks(await request('/check', {}));
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setChecking(false);
                    }
                  }}
                >
                  {t('检查本地环境')}
                </Button>
              </Space>
            </div>
            {checks && (
              <SettingsSection title={t('本地环境检查')}>
                <div className="dashboard-eval-checks">
                  {checks.environment.map((check) => (
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
              </SettingsSection>
            )}
            <Text className="dashboard-eval-settings-path" type="secondary">
              {t('配置保存在本机用户目录：')}
              {data.path}
              {t('。保存和本地环境检查均不会调用模型。')}
            </Text>
          </Form>
        )}
      </Spin>
    </div>
  );
}
