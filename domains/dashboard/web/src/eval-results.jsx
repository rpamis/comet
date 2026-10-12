import { t, localized, getDashboardLocale } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import { useDashboardViewState } from './dashboard-view-state.js';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  FileTextOutlined,
  EyeOutlined,
  SearchOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;
export const conclusionLabels = localized({
  passed: '通过',
  failed: '未通过',
  incomplete: '未完成',
});
export const evalPagination = localized({
  className: 'dashboard-eval-pagination',
  simple: { readOnly: true },
  hideOnSinglePage: true,
  showSizeChanger: false,
  locale: { prev_page: '上一页', next_page: '下一页' },
  showTotal: (total, [start, end]) => t('{0}–{1} / 共 {2} 条', [start, end, total]),
  itemRender: (_page, type, element) => {
    if (type !== 'prev' && type !== 'next') return element;
    const label = type === 'prev' ? t('上一页') : t('下一页');
    return React.cloneElement(element, { 'aria-label': label, children: label });
  },
});
const qualityLabels = localized({
  included: '有效',
  flagged: '已标记风险',
  excluded: '已排除',
  unknown: '证据缺失',
});
export const numeric = (value, suffix = '') =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString(getDashboardLocale())}${suffix}`
    : '—';
const cost = (value) => (typeof value === 'number' ? `$${value.toFixed(4)}` : '—');

const duration = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  const seconds = Math.round(value);
  const english = getDashboardLocale() === 'en-US';
  if (seconds < 60) return english ? `${seconds}s` : `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remaining = String(seconds % 60).padStart(2, '0');
  if (minutes < 60) return english ? `${minutes}m ${remaining}s` : `${minutes}分${remaining}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = String(minutes % 60).padStart(2, '0');
  return english
    ? `${hours}h ${remainingMinutes}m ${remaining}s`
    : `${hours}时${remainingMinutes}分${remaining}秒`;
};
const compactNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(value)
    : '—';

export function EvalDuration({ value }) {
  useDashboardLanguage();
  return (
    <Tooltip title={numeric(value, t(' 秒'))}>
      <span className="dashboard-eval-numeric">{duration(value)}</span>
    </Tooltip>
  );
}

export function Metric({ label, value, detail, preciseValue }) {
  useDashboardLanguage();
  return (
    <div className="dashboard-eval-metric">
      <Text type="secondary">{label}</Text>
      <Text strong>
        {preciseValue ? (
          <Tooltip title={preciseValue}>
            <span>{value}</span>
          </Tooltip>
        ) : (
          value
        )}
      </Text>
      {detail && <Text type="secondary">{detail}</Text>}
    </div>
  );
}

export function EvalRunProgress({ run }) {
  useDashboardLanguage();
  const active = !['completed', 'stopped', 'interrupted', 'unknown'].includes(run.executionStatus);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, run.id]);
  if (!active) return null;
  const progress = run.progress;
  const phase = progress?.phase ?? run.executionStatus;
  const index =
    { queued: 0, preparing: 0, generating: 0, running: 1, judging: 2, finalizing: 3 }[phase] ?? 0;
  const labels = {
    queued: t('等待执行'),
    preparing: t('准备环境'),
    generating: t('生成用例'),
    running: t('执行用例'),
    judging: t('判定结果'),
    finalizing: t('生成报告'),
    stopping: t('正在停止'),
  };
  const start = Date.parse(run.createdAt ?? '');
  const elapsed = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : null;
  const duration =
    elapsed === null ? '—' : t('{0} 分 {1} 秒', [Math.floor(elapsed / 60), elapsed % 60]);
  const completed = (run.cases ?? []).filter(
    (item) => item.passed !== null && item.passed !== undefined,
  ).length;
  const clock = (at) =>
    Number.isFinite(Date.parse(at ?? ''))
      ? new Date(at).toLocaleTimeString(getDashboardLocale(), { hour12: false })
      : t('等待活动');
  const activities = progress?.activities ?? [];
  return (
    <section className="dashboard-eval-live" aria-label={t('实时评估进度')}>
      <div className="dashboard-eval-heading">
        <Space size={10}>
          <Text strong>{t('评估进度')}</Text>
          <Tag color="processing">
            {run.executionStatus === 'stopping' ? t('正在停止') : (labels[phase] ?? t('执行中'))}
          </Tag>
        </Space>
        <Text type="secondary">
          {t('已用 ')}
          {duration}
          {run.config.timeoutSeconds
            ? t(' / {0} 分钟上限', [Math.floor(run.config.timeoutSeconds / 60)])
            : ''}
        </Text>
      </div>
      <Steps
        size="small"
        current={index}
        items={[
          { title: phase === 'generating' ? t('生成用例') : t('准备与用例') },
          { title: t('执行用例') },
          { title: t('判定结果') },
          { title: t('生成报告') },
        ]}
      />
      <div className="dashboard-eval-live-facts">
        <div>
          <Text type="secondary">{t('当前用例')}</Text>
          <Text strong>{progress?.currentCase?.task ?? run.config.task ?? t('等待用例确定')}</Text>
          {progress?.currentCase && (
            <Text type="secondary">{t('第 {0} 次重复', [progress.currentCase.repetition])}</Text>
          )}
        </div>
        <div>
          <Text type="secondary">{t('已结束用例')}</Text>
          <Text strong>
            {completed} / {run.expectedTotal ?? '—'}
          </Text>
        </div>
        <div>
          <Text type="secondary">{t('最近活动')}</Text>
          <Text>{clock(progress?.lastEventAt ?? progress?.updatedAt)}</Text>
        </div>
      </div>
      {activities.length ? (
        <ol className="dashboard-eval-live-activities" aria-label={t('最近执行活动')}>
          {activities
            .slice(-3)
            .reverse()
            .map((item) => (
              <li key={item.id}>
                <time>{clock(item.at)}</time>
                <span>{item.message}</span>
              </li>
            ))}
        </ol>
      ) : (
        <Text type="secondary">{t('尚未收到执行活动；阶段和用例结果会自动更新。')}</Text>
      )}
    </section>
  );
}

export function EvalSection({ title, description, extra, children, className = '' }) {
  useDashboardLanguage();
  return (
    <section className={`dashboard-eval-inner-section ${className}`}>
      <div className="dashboard-eval-section-heading">
        <div>
          <Title level={5}>{title}</Title>
          {description && <Text type="secondary">{description}</Text>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function CaseStatus({ item }) {
  useDashboardLanguage();
  const abnormal = item.quality === 'excluded';
  return (
    <Tag
      color={
        abnormal
          ? 'warning'
          : item.passed === true
            ? 'success'
            : item.passed === false
              ? 'error'
              : 'default'
      }
    >
      {abnormal
        ? t('执行异常')
        : item.passed === true
          ? t('通过')
          : item.passed === false
            ? t('未通过')
            : t('未完成')}
    </Tag>
  );
}

function Facts({ items }) {
  useDashboardLanguage();
  return (
    <dl className="dashboard-eval-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Scores({ scores, samples }) {
  useDashboardLanguage();
  return (
    <div className="dashboard-eval-score-grid">
      {Object.entries(scores).map(([name, score]) => (
        <div className="dashboard-eval-score-tile" key={name}>
          <div>
            <Text>{name}</Text>
            <Text className="dashboard-eval-numeric" strong>
              {Number(score).toFixed(2)}
            </Text>
          </div>
          <div className="dashboard-eval-score-track" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(1, score)) * 100}%` }} />
          </div>
          {samples && (
            <Text type="secondary">
              {samples[name]}
              {t(' 个有效分数')}
            </Text>
          )}
        </div>
      ))}
    </div>
  );
}

export function EvalOverview({ run }) {
  useDashboardLanguage();
  const values = {};
  for (const item of (run.cases ?? []).filter(
    (item) => item.quality === 'included' || item.quality === 'flagged',
  ))
    for (const [key, value] of Object.entries(item.scores ?? {}))
      if (typeof value === 'number' && Number.isFinite(value)) (values[key] ??= []).push(value);
  const scores = Object.fromEntries(
    Object.entries(values).map(([key, items]) => [
      key,
      items.reduce((a, b) => a + b, 0) / items.length,
    ]),
  );
  const quality = (run.cases ?? []).reduce(
    (counts, item) => ({ ...counts, [item.quality]: (counts[item.quality] ?? 0) + 1 }),
    {},
  );
  const expected = run.expectedTotal ?? run.total;
  const metrics = run.metrics;
  return (
    <div className="dashboard-eval-stack">
      <div className="dashboard-eval-overview-grid">
        <Card className={`dashboard-eval-result-hero dashboard-eval-result-${run.conclusion}`}>
          <div className="dashboard-eval-result-heading">
            <Text className="dashboard-eval-section-label">{t('评估结论')}</Text>
            <Tag>{run.executionStatus === 'completed' ? t('执行已结束') : t('以当前结果为准')}</Tag>
          </div>
          <div className="dashboard-eval-result-word">{conclusionLabels[run.conclusion]}</div>
          <Text type="secondary">{t('任务检查决定结论；评分和执行证据用于解释结果。')}</Text>
          <div className="dashboard-eval-result-counts">
            <Metric label={t('通过用例')} value={`${run.passed} / ${expected}`} />
            <Metric
              label={t('完整结果')}
              value={run.total}
              detail={t('预期 {0} 个', [run.expectedTotal ?? t('未知')])}
            />
          </div>
        </Card>
        <Card className="dashboard-eval-resource-card" title={t('执行资源')} size="small">
          <div className="dashboard-eval-resource-grid">
            <Metric
              label={t('用例耗时')}
              value={<EvalDuration value={metrics.durationSeconds} />}
            />
            <Metric
              label="Tokens"
              value={compactNumber(metrics.tokens)}
              preciseValue={numeric(metrics.tokens)}
            />
            <Metric
              label={t('已知用例费用')}
              value={cost(metrics.knownCostUsd)}
              detail={
                metrics.costStatus === 'unavailable'
                  ? t('未采集费用')
                  : metrics.costStatus === 'partial'
                    ? t('仅部分用例费用，非完整总价')
                    : t('仅用例费用，不含其他开销')
              }
            />
            <Metric label={t('生成阶段费用')} value={cost(metrics.generationCostUsd)} />
          </div>
        </Card>
      </div>
      <div className="dashboard-eval-evidence-strip">
        <div>
          <Text className="dashboard-eval-section-label">{t('样本质量')}</Text>
          <Space wrap>
            <span>
              {quality.included ?? 0}
              {t(' 有效')}
            </span>
            <span>
              {quality.flagged ?? 0}
              {t(' 已标记')}
            </span>
            <span>
              {quality.excluded ?? 0}
              {t(' 已排除')}
            </span>
            <span>
              {quality.unknown ?? 0}
              {t(' 证据缺失')}
            </span>
          </Space>
        </div>
        <div>
          <Text className="dashboard-eval-section-label">{t('内容时效')}</Text>
          <Text type="secondary">
            {run.stale === true
              ? t('对应旧内容')
              : run.stale === false
                ? t('与当前内容一致')
                : t('未核对当前目标内容')}
          </Text>
        </div>
      </div>
      {Object.keys(scores).length > 0 && (
        <EvalSection
          title={t('适用评分维度（0–1）')}
          description={t('分数补充任务检查；查看用例证据确认判定原因。')}
        >
          <Scores
            scores={scores}
            samples={Object.fromEntries(
              Object.entries(values).map(([key, items]) => [key, items.length]),
            )}
          />
        </EvalSection>
      )}
      {(quality.excluded ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('环境异常样本未纳入模型能力评分')}
          description={t('结果不完整；请在用例详情中查看执行失败原因，修复环境后重新评估。')}
        />
      )}
      {run.limitations?.length > 0 && (
        <EvalSection title={t('评估边界')}>
          <ul className="dashboard-eval-notes">
            {run.limitations.map((item, index) => (
              <li key={index}>{t(item)}</li>
            ))}
          </ul>
        </EvalSection>
      )}
    </div>
  );
}

export function EvalCases({ run, onSelect, stateScope }) {
  useDashboardLanguage();
  const [filter, setFilter] = useDashboardViewState(stateScope, `${run.id}:case-filter`, 'all');
  const [search, setSearch] = useDashboardViewState(stateScope, `${run.id}:case-search`, '');
  const [page, setPage] = useDashboardViewState(stateScope, `${run.id}:case-page`, 1);
  const cases = run.cases ?? [];
  const matches = {
    all: () => true,
    failed: (item) => item.passed === false && item.quality !== 'excluded',
    abnormal: (item) => item.quality === 'excluded',
  };
  const data = cases.filter(
    (item) =>
      matches[filter](item) &&
      `${item.task}\n${item.prompt ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <EvalSection
      title={t('用例结果')}
      description={t('从结果进入输入、回答与检查证据。')}
      extra={
        <Text type="secondary">
          {data.length} / {cases.length}
          {t(' 个结果')}
        </Text>
      }
    >
      <div className="dashboard-eval-case-toolbar">
        <Segmented
          aria-label={t('用例筛选')}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: t('全部用例') },
            { value: 'failed', label: t('仅未通过') },
            { value: 'abnormal', label: t('仅执行异常') },
          ]}
        />
        <Input
          aria-label={t('搜索用例')}
          prefix={<SearchOutlined />}
          placeholder={t('搜索名称或输入…')}
          allowClear
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <Table
        rowKey="id"
        size="small"
        pagination={{
          ...evalPagination,
          pageSize: 10,
          current: Math.min(page, Math.max(1, Math.ceil(data.length / 10))),
          onChange: setPage,
        }}
        dataSource={data}
        columns={[
          {
            title: t('用例 / 输入'),
            key: 'task',
            render: (_, item) => (
              <div className="dashboard-eval-case-name">
                <Button
                  className="dashboard-eval-target"
                  type="link"
                  onClick={() => onSelect(item)}
                >
                  {item.task}
                </Button>
                {item.prompt && (
                  <Text
                    className="dashboard-eval-case-excerpt"
                    type="secondary"
                    title={item.prompt}
                  >
                    {item.prompt}
                  </Text>
                )}
                <Text className="dashboard-eval-secondary" type="secondary">
                  {[
                    item.treatment,
                    typeof item.repetition === 'number' ? t('第 {0} 次', [item.repetition]) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </div>
            ),
          },
          {
            title: t('判定'),
            key: 'result',
            render: (_, item) => (
              <div className="dashboard-eval-case-name">
                <CaseStatus item={item} />
                <Text className="dashboard-eval-secondary" type="secondary">
                  {qualityLabels[item.quality]}
                </Text>
              </div>
            ),
          },
          {
            title: t('检查摘要'),
            key: 'check',
            responsive: ['lg'],
            render: (_, item) => (
              <Text className="dashboard-eval-case-excerpt" type="secondary">
                {item.checksFailed?.[0] ??
                  (item.checksPassed?.length
                    ? t('{0} 项检查通过', [item.checksPassed.length])
                    : t('暂无检查证据'))}
              </Text>
            ),
          },
          {
            title: t('耗时'),
            key: 'duration',
            responsive: ['md'],
            render: (_, item) => <EvalDuration value={item.durationSeconds} />,
          },
        ]}
        locale={{ emptyText: cases.length ? t('没有符合筛选条件的用例') : t('用例结果尚未生成') }}
      />
    </EvalSection>
  );
}

export function EvalCaseEvidence({ value, onArtifact }) {
  useDashboardLanguage();
  if (!value) return null;
  return (
    <div className="dashboard-eval-stack dashboard-eval-case-evidence">
      <div className="dashboard-eval-evidence-heading">
        <CaseStatus item={value} />
        <Text type="secondary">{value.model ?? t('模型未采集')}</Text>
        <Text type="secondary">
          <EvalDuration value={value.durationSeconds} />
        </Text>
      </div>
      <div className="dashboard-eval-reading-grid">
        <EvalSection title={t('输入 / 指令')}>
          <pre className="dashboard-eval-reading">
            {value.prompt || t('此记录未保存输入，请查看原始证据。')}
          </pre>
        </EvalSection>
        <EvalSection title={t('最终回答')}>
          <pre className="dashboard-eval-reading">
            {value.finalResponse || t('未保存最终回答或执行尚未结束，请结合检查项与日志判断。')}
          </pre>
        </EvalSection>
      </div>
      <EvalSection
        title={t('失败检查项')}
        extra={
          <Tag color={value.checksFailed?.length ? 'error' : 'default'}>
            {value.checksFailed?.length ?? 0}
            {t(' 项')}
          </Tag>
        }
      >
        <ul className="dashboard-eval-verdict-list dashboard-eval-verdict-failed">
          {value.checksFailed?.length ? (
            value.checksFailed.map((check, index) => (
              <li key={index}>
                <CloseCircleOutlined />
                <span>{check}</span>
              </li>
            ))
          ) : (
            <li>{t('无失败检查项')}</li>
          )}
        </ul>
      </EvalSection>
      <EvalSection title={t('通过检查项与评分')}>
        <ul className="dashboard-eval-verdict-list">
          {value.checksPassed?.length ? (
            value.checksPassed.map((check, index) => (
              <li key={index}>
                <CheckCircleOutlined />
                <span>{check}</span>
              </li>
            ))
          ) : (
            <li className="dashboard-eval-muted">{t('未记录通过检查项')}</li>
          )}
        </ul>
        {Object.values(value.scores ?? {}).some((score) => typeof score === 'number') && (
          <Scores
            scores={Object.fromEntries(
              Object.entries(value.scores).filter(
                ([, score]) => typeof score === 'number' && Number.isFinite(score),
              ),
            )}
          />
        )}
      </EvalSection>
      <EvalSection title={t('执行证据')}>
        <Facts
          items={[
            [t('样本质量'), qualityLabels[value.quality]],
            [t('质量说明'), value.qualityReason ?? '—'],
            [t('实际模型'), value.model ?? '—'],
            [t('实际 Agent'), value.agent ?? '—'],
            ['Tokens', numeric(value.tokens)],
            [t('已知用例费用'), cost(value.costUsd)],
          ]}
        />
        {value.failureAttribution?.length > 0 && (
          <ul className="dashboard-eval-notes">
            {value.failureAttribution.map((item, index) => (
              <li key={index}>
                <Text strong>{item.bucket}</Text> · {item.reason ?? item.check}
              </li>
            ))}
          </ul>
        )}
      </EvalSection>
      {value.artifacts?.length > 0 && (
        <EvalSection title={t('相关产物')}>
          <Space wrap>
            {value.artifacts.map((item) => (
              <Button key={item.id} icon={<FileTextOutlined />} onClick={() => onArtifact(item.id)}>
                {item.label}
              </Button>
            ))}
          </Space>
        </EvalSection>
      )}
    </div>
  );
}

function CoverageList({ values, missing = false }) {
  useDashboardLanguage();
  return values?.length ? (
    <ul
      className={`dashboard-eval-coverage-list ${missing ? 'dashboard-eval-coverage-missing' : ''}`}
    >
      {values.map((item) => (
        <li key={item}>
          {missing ? <span className="dashboard-eval-status-dot" /> : <CheckCircleOutlined />}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  ) : (
    <Text type="secondary">{t('暂无证据')}</Text>
  );
}

export function EvalCoverage({ run }) {
  useDashboardLanguage();
  const coverage = run.coverage;
  if (!coverage) return <Empty description={t('实际 SDK 执行覆盖证据尚未生成')} />;
  return (
    <div className="dashboard-eval-stack">
      <div className="dashboard-eval-evidence-strip dashboard-eval-coverage-summary">
        <Metric label={t('已覆盖步骤')} value={coverage.coveredSteps?.length ?? 0} />
        <Metric label={t('未覆盖步骤')} value={coverage.uncoveredSteps?.length ?? 0} />
        <Metric label={t('未覆盖决策')} value={coverage.uncoveredChoices?.length ?? 0} />
      </div>
      <Alert type="info" showIcon message={t('少量用例通过不代表完整验收，请同时检查未覆盖路径')} />
      <EvalSection
        title={t('实际执行步骤')}
        description={t('实际执行与验证覆盖分别记录，执行过的步骤仍可能缺少验证。')}
      >
        <div className="dashboard-eval-step-path">
          {coverage.executedSteps?.length ? (
            coverage.executedSteps.map((step) => (
              <div key={step}>
                <span>{t('执行')}</span>
                <Text>{step}</Text>
              </div>
            ))
          ) : (
            <Text type="secondary">{t('暂无证据')}</Text>
          )}
        </div>
      </EvalSection>
      <div className="dashboard-eval-detail-grid">
        <Card title={t('步骤覆盖')} size="small">
          <div className="dashboard-eval-coverage-pair">
            <EvalSection title={t('已覆盖步骤')}>
              <CoverageList values={coverage.coveredSteps} />
            </EvalSection>
            <EvalSection title={t('未覆盖步骤')}>
              <CoverageList values={coverage.uncoveredSteps} missing />
            </EvalSection>
          </div>
        </Card>
        <Card title={t('决策覆盖')} size="small">
          <div className="dashboard-eval-coverage-pair">
            <EvalSection title={t('已覆盖决策')}>
              <CoverageList values={coverage.coveredChoices} />
            </EvalSection>
            <EvalSection title={t('未覆盖决策')}>
              <CoverageList values={coverage.uncoveredChoices} missing />
            </EvalSection>
          </div>
        </Card>
      </div>
      <EvalSection title={t('恢复行为')}>
        <CoverageList values={coverage.recoveredActions} />
      </EvalSection>
      <Text type="secondary">
        {t('实际模型：')}
        {coverage.actualModels?.join('、') || t('未采集')}
      </Text>
    </div>
  );
}

export function EvalConfiguration({ run }) {
  useDashboardLanguage();
  const config = run.config;
  return (
    <div className="dashboard-eval-stack">
      <EvalSection
        title={t('运行快照')}
        description={t('这里记录本次执行使用的配置；重新评估时可修改配置。')}
      >
        <div className="dashboard-eval-detail-grid">
          <Card size="small" title={t('目标与参照')}>
            <Facts
              items={[
                [t('目标路径'), run.target.path ?? t('旧记录未保存')],
                [
                  t('内容身份'),
                  <Text className="dashboard-eval-hash" code>
                    {run.target.contentHash ?? t('未保存')}
                  </Text>,
                ],
                [t('启动时绑定基线'), run.boundBaselineRunId ?? t('未绑定或旧记录未保存')],
              ]}
            />
          </Card>
          <Card size="small" title={t('执行与判定')}>
            <Facts
              items={[
                [t('执行 Agent / 模型'), `${config.agent ?? '—'} / ${config.model ?? '—'}`],
                [t('执行端点'), config.baseUrl ?? t('由运行环境提供')],
                [
                  t('独立 Judge'),
                  config.judgeModel
                    ? `${config.judgeAgent ?? t('默认 Agent')} / ${config.judgeModel}`
                    : t('未配置或旧记录未保存'),
                ],
                [t('Judge 端点'), config.judgeBaseUrl ?? t('由运行环境提供')],
              ]}
            />
          </Card>
          <Card size="small" title={t('执行限制')}>
            <Facts
              items={[
                [t('评估总时限'), numeric(config.timeoutSeconds, t(' 秒'))],
                [t('最大执行轮数'), numeric(config.maxTurns, t(' 轮'))],
                [t('评估 Profile'), config.profile ?? t('沿用目标配置')],
              ]}
            />
          </Card>
          <Card size="small" title={t('报告与凭据')}>
            <Facts
              items={[
                [t('报告去向'), config.suite ?? 'local'],
                [t('凭据'), t('由运行环境提供，不写入运行快照或浏览器缓存')],
              ]}
            />
          </Card>
        </div>
      </EvalSection>
    </div>
  );
}

export function EvalArtifacts({ run, downloads, onOpen, onDownload }) {
  useDashboardLanguage();
  const descriptions = {
    markdown: t('Markdown 报告 · 可阅读与编辑'),
    html: t('HTML 报告 · 浏览器预览'),
    json: t('结构化数据 · JSON'),
  };
  return (
    <EvalSection
      title={t('日志与产物')}
      description={t('预览执行证据，或下载文件留存与分享。')}
      extra={
        <Text type="secondary">
          {run.artifacts?.length ?? 0}
          {t(' 个文件')}
        </Text>
      }
    >
      {run.artifacts?.length ? (
        <div className="dashboard-eval-file-list">
          {run.artifacts.map((item) => (
            <div className="dashboard-eval-file-row" key={item.id}>
              <div className="dashboard-eval-file-icon">
                <FileTextOutlined />
              </div>
              <div className="dashboard-eval-file-name">
                <Button
                  className="dashboard-eval-target"
                  type="link"
                  aria-label={item.label}
                  onClick={() => onOpen(item.id)}
                >
                  {item.label}
                </Button>
                <Text type="secondary">{descriptions[item.format] ?? t('执行日志与证据文件')}</Text>
              </div>
              <Space size={8} className="dashboard-eval-file-actions">
                <Button
                  type="link"
                  icon={<EyeOutlined />}
                  aria-label={t('预览产物 {0}', [item.label])}
                  onClick={() => onOpen(item.id)}
                >
                  {t('预览')}
                </Button>
                <Button
                  type="link"
                  icon={<DownloadOutlined />}
                  aria-label={t('下载产物 {0}', [item.label])}
                  loading={downloads.includes(`${run.id}/${item.id}`)}
                  onClick={() => onDownload(item.id)}
                >
                  {t('下载')}
                </Button>
              </Space>
            </div>
          ))}
        </div>
      ) : (
        <Empty description={t('产物尚未生成')} />
      )}
      <Text className="dashboard-eval-footnote" type="secondary">
        {t('日志在独立后台进程中记录，离开页面不会停止评估。')}
      </Text>
    </EvalSection>
  );
}

const settingLabels = localized({
  agent: '执行 Agent',
  model: '执行模型',
  baseUrl: '执行端点',
  judgeEnabled: '启用独立 Judge',
  judgeAgent: 'Judge Agent',
  judgeModel: 'Judge 模型',
  judgeBaseUrl: 'Judge 端点',
  suite: '报告去向',
  profile: '评估配置',
  quick: '快速冒烟',
  task: '指定用例',
  timeoutSeconds: '超时（秒）',
  maxTurns: '最大执行轮数',
  contentHash: '内容快照',
  version: '内容版本',
});
export function EvalComparison({ value }) {
  useDashboardLanguage();
  if (!value) return <Empty description={t('选择有效基线后查看对比')} />;
  return (
    <div className="dashboard-eval-stack">
      {!value.comparable && (
        <Alert
          type="warning"
          showIcon
          message={t('当前结果不满足可比条件')}
          description={value.reasons.map((item) => t(item)).join('\n')}
        />
      )}
      <div className="dashboard-eval-comparison-summary">
        <Metric
          label={t('基线通过')}
          value={`${value.baseline.passed} / ${value.baseline.expectedTotal ?? value.baseline.total}`}
        />
        <Metric
          label={t('本次通过')}
          value={`${value.candidate.passed} / ${value.candidate.expectedTotal ?? value.candidate.total}`}
        />
        <Metric
          label={t('用例变化')}
          value={value.comparable ? `${value.improved} / ${value.regressed}` : t('仅并列查看')}
          detail={value.comparable ? t('进步 / 退步') : undefined}
        />
      </div>
      {value.comparable ? (
        <EvalSection title={t('逐项对比')} description={t('同一固定用例的基线结果与本次结果。')}>
          <Table
            size="small"
            rowKey={(item) => `${item.task}-${item.repetition}`}
            pagination={false}
            dataSource={value.cases}
            columns={[
              { title: t('用例'), dataIndex: 'task' },
              {
                title: t('基线'),
                dataIndex: 'baseline',
                render: (item) =>
                  typeof item === 'boolean' ? <CaseStatus item={{ passed: item }} /> : '—',
              },
              {
                title: t('本次'),
                dataIndex: 'candidate',
                render: (item) =>
                  typeof item === 'boolean' ? <CaseStatus item={{ passed: item }} /> : '—',
              },
              {
                title: t('变化'),
                dataIndex: 'change',
                render: (item) => (
                  <Tag
                    color={
                      item === 'improved' ? 'success' : item === 'regressed' ? 'error' : 'default'
                    }
                  >
                    {
                      {
                        improved: t('进步'),
                        regressed: t('退步'),
                        unchanged: t('持平'),
                        unmatched: t('未配对'),
                      }[item]
                    }
                  </Tag>
                ),
              },
            ]}
          />
        </EvalSection>
      ) : (
        <div className="dashboard-eval-detail-grid">
          {[
            [t('基线用例'), value.baseline],
            [t('本次用例'), value.candidate],
          ].map(([title, run]) => (
            <Card key={run.id} title={title} size="small">
              <Text>{run.target.name}</Text>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={run.cases}
                columns={[
                  { title: t('用例'), dataIndex: 'task' },
                  {
                    title: t('状态'),
                    key: 'status',
                    render: (_, item) => <CaseStatus item={item} />,
                  },
                ]}
              />
            </Card>
          ))}
        </div>
      )}
      {value.configurationChanges.length > 0 && (
        <EvalSection
          title={t('配置差异')}
          description={t('模型或执行配置同时变化时，结果不能单独归因于内容升级。')}
        >
          <Table
            size="small"
            rowKey="field"
            pagination={false}
            dataSource={value.configurationChanges}
            columns={[
              {
                title: t('设置'),
                dataIndex: 'field',
                width: 96,
                render: (field) => settingLabels[field] ?? field,
              },
              { title: t('基线'), dataIndex: 'baseline', render: (item) => String(item ?? '—') },
              { title: t('本次'), dataIndex: 'candidate', render: (item) => String(item ?? '—') },
            ]}
          />
        </EvalSection>
      )}
      <EvalSection title={t('资源对比')}>
        <Facts
          items={[
            [
              t('已知费用（基线 / 本次）'),
              `${cost(value.baseline.metrics.knownCostUsd)} / ${cost(value.candidate.metrics.knownCostUsd)}`,
            ],
            [
              t('用例耗时（基线 / 本次）'),
              <Space>
                <EvalDuration value={value.baseline.metrics.durationSeconds} />
                <span>/</span>
                <EvalDuration value={value.candidate.metrics.durationSeconds} />
              </Space>,
            ],
          ]}
        />
      </EvalSection>
    </div>
  );
}
