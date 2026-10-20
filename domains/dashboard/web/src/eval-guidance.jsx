import { t } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import React from 'react';
import { Alert, Button, Card, Drawer, Space, Typography } from 'antd';
const { Text, Paragraph } = Typography;
export function evalDisplayError(error) {
  return String(error ?? '')
    .split('\n')
    .map((line) =>
      /请配置.*(?:LANGSMITH_|LANGFUSE_)/u.test(line)
        ? t('追踪服务凭据未配置，请在「设置 → Eval」配置所选报告服务。')
        : /配置文件位于 ~\/\.comet\/eval\/\.env|请配置.*(?:API_KEY|AUTH_TOKEN)/u.test(line)
          ? t('模型凭据未配置，请在「设置 → Eval」保存执行模型或独立 Judge 的凭据。')
          : t(line),
    )
    .join('\n');
}
export function evalErrorAdvice(error) {
  const text = String(error?.message ?? error ?? '');
  if (/常用配置.*(?:文件|记录无效)/u.test(text))
    return t(
      '保留当前项目的 .comet/eval/presets.json，检查文件格式后重试读取配置；不要覆盖历史记录。',
    );
  if (/常用配置已变化/u.test(text))
    return t('点击「重试读取配置」，重新选择最新配置，再确认更新或删除。');
  if (/配置名称已存在/u.test(text))
    return t('为新配置使用不同名称；需要更新时先选择原配置，再点击「更新所选配置」。');
  if (/最多保存 50/u.test(text))
    return t('删除不再使用的常用配置后再保存。删除常用配置会保留已有评估记录。');
  if (/目标类型与路径不一致/u.test(text))
    return t(
      'SKILL.md、Skill 目录或评估清单请选择「Skill / Eval manifest」；application.json 请选择「SDK 应用」。也可选择「自动识别」，修改类型会保留已输入的路径。',
    );
  if (/Docker|docker/u.test(text))
    return t('启动 Docker 并运行 docker info；确认服务可用后，保留当前设置重新预检。');
  if (/uv/u.test(text))
    return t('安装 uv，并在启动 Dashboard 的环境中确认 uv --version 可用，再重新预检。');
  if (/LANGSMITH_|LANGFUSE_/u.test(text))
    return t('打开「设置 → Eval」，配置所选报告服务的凭据后重新预检。');
  if (/凭据|API_KEY|AUTH_TOKEN|鉴权|401|403/u.test(text))
    return t(
      '打开「设置 → Eval」，配置执行模型或独立 Judge 的凭据，保存后重新预检。已有密钥不会回显，也不会放入浏览器缓存。',
    );
  if (/固定用例|原用例|原评分|原记录|执行组合/u.test(text))
    return t(
      '保留原报告，恢复原固定用例及评分规则。无法恢复时，选择完整评估建立新记录；失败重跑不会重新生成原用例。',
    );
  if (/变化|409|确认|预检/u.test(text))
    return t('目标、配置或原记录已经变化。保留当前输入，重新预检后再启动；不要重复旧启动请求。');
  if (/路径|目标|ENOENT|不存在/u.test(text))
    return t(
      '输入本机绝对路径可选择其他目录中的目标；相对路径基于当前选中的项目，与 Dashboard 的启动目录无关。检查目标是否为 Skill 目录、SKILL.md、评估清单或完整的 application.json。',
    );
  if (/Failed to fetch|network|连接|读取|请求失败/iu.test(text))
    return t(
      '确认本地 Dashboard 服务仍在运行，再重试读取。历史结果保留，刷新页面不会再次启动评估。',
    );
  return t(
    '查看用例失败检查项与执行日志，先修复指出的问题，再重新预检。修改配置后会创建新记录，原结果保留。',
  );
}
export function EvalErrorGuide({ error, onSettings }) {
  useDashboardLanguage();
  return (
    <div>
      <Paragraph type="secondary">{evalErrorAdvice(error)}</Paragraph>
      {onSettings &&
        /凭据|API_KEY|AUTH_TOKEN|LANGSMITH_|LANGFUSE_|鉴权|401|403/u.test(String(error ?? '')) && (
          <Button onClick={onSettings}>{t('打开 Eval 设置')}</Button>
        )}
    </div>
  );
}
export function EvalFirstUse() {
  useDashboardLanguage();
  return (
    <Card title={t('第一次使用 Eval')} size="small">
      <Space direction="vertical">
        <Text>
          {t(
            '1. 输入 Skill、评估清单或 SDK application.json 的路径，默认自动识别类型；绝对路径可指向其他目录，相对路径基于当前选中的项目。',
          )}
        </Text>
        <Text>
          {t(
            '2. 在「设置 → Eval」保存常用模型、端点与凭据，并准备 uv 和 Docker；需要独立 Judge 时单独配置。',
          )}
        </Text>
        <Text>
          {t('3. 查看用例和运行限制，预检通过后再开始。预检不调用模型，正式运行会产生模型费用。')}
        </Text>
        <Text type="secondary">
          {t(
            '已有 CLI 评估会自动出现在这里。没有记录时无需先设置基线；完成后可选择有效结果作为基线。',
          )}
        </Text>
      </Space>
    </Card>
  );
}
export function EvalGuideDrawer({ open, onClose, onSettings }) {
  useDashboardLanguage();
  return (
    <Drawer title={t('Eval 使用指南')} open={open} onClose={onClose} width={560}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <EvalFirstUse />
        <Card title={t('环境与凭据')} size="small">
          <Paragraph>{t('在启动 Dashboard 的环境中检查以下命令：')}</Paragraph>
          <pre className="dashboard-eval-pre">{'uv --version\ndocker info'}</pre>
          <Paragraph>
            {t(
              '在「设置 → Eval」管理本机用户级模型、端点、执行凭据和独立 Judge。保存后各项目共用；已有密钥只显示配置状态。',
            )}
          </Paragraph>
          <Button onClick={onSettings}>{t('打开 Eval 设置')}</Button>
        </Card>
        <Card title={t('结果与重跑')} size="small">
          <Paragraph>
            {t('检查用例输入、最终回答、失败检查项及原始日志。环境异常与模型能力失败分别显示。')}
          </Paragraph>
          <Paragraph>
            {t(
              '失败重跑只执行原记录中已判定失败的组合，保留原结果和重复次数。子集结果不能作为完整基线，也不会替代 SDK 应用完整验收。',
            )}
          </Paragraph>
        </Card>
        <Alert
          type="info"
          showIcon
          message={t('启动与停止')}
          description={t(
            '离开页面不会停止后台评估。停止后等待进程与容器核对；状态未确定时，先刷新核对，不要重复启动。',
          )}
        />
      </Space>
    </Drawer>
  );
}
