import React from 'react';
import { Collapse, Descriptions, Tag } from 'antd';
import { t } from './dashboard-i18n.js';
import { applicationOutputSummary } from './application-data.js';

export function ApplicationStepDefinition({ step, record }) {
  if (!step) return null;
  const contract = step.artifactContract;
  const summary = applicationOutputSummary(record, step.outputFields);
  return (
    <div className="any-step-definition">
      {step.description && <p>{step.description}</p>}
      {!!step.skills?.length && (
        <div className="any-choice-tags">
          {step.skills.map((skill) => (
            <Tag key={skill}>{skill}</Tag>
          ))}
        </div>
      )}
      {step.observation === 'action' &&
        (step.skills?.length > 0 || step.type === 'invoke_skill') && (
          <p className="any-note">
            {t('此 Skill 作为一次调用记录；内部操作只有拆成步骤或子流程后才能逐项展示。')}
          </p>
        )}
      {step.observation === 'subworkflow' && (
        <p className="any-note">{t('启动后可从执行记录进入子流程，查看其独立步骤。')}</p>
      )}
      {summary.length > 0 && (
        <>
          <h4>{record ? t('业务结果') : t('预期输出字段')}</h4>
          <Descriptions
            size="small"
            column={1}
            items={summary.map((field) => ({
              key: field.path,
              label: field.label,
              children: !record ? (
                <code>{field.path}</code>
              ) : !field.available ? (
                t('尚无该字段')
              ) : typeof field.value === 'object' ? (
                <pre>{JSON.stringify(field.value, null, 2)}</pre>
              ) : (
                String(field.value)
              ),
            }))}
          />
        </>
      )}
      {contract && (
        <>
          <h4>{t('预期产物')}</h4>
          {contract.noArtifactsReason && <p>{contract.noArtifactsReason}</p>}
          {contract.artifacts?.map((artifact, index) => (
            <div
              className="any-expected-artifact"
              key={`${artifact.ref ?? artifact.refFrom}:${index}`}
            >
              <code>{artifact.ref ?? t('从输出字段 {0} 读取文件路径', [artifact.refFrom])}</code>
              {artifact.nonEmpty && <span>{t('文件内容不能为空')}</span>}
              {!!artifact.requiredHeadings?.length && (
                <span>{t('必需标题：{0}', [artifact.requiredHeadings.join(' · ')])}</span>
              )}
              {!!artifact.requiredText?.length && (
                <span>{t('必需内容：{0}', [artifact.requiredText.join(' · ')])}</span>
              )}
              {artifact.schema && (
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: 'schema',
                      label: t('文件结构要求'),
                      children: <pre>{JSON.stringify(artifact.schema, null, 2)}</pre>,
                    },
                  ]}
                />
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function ApplicationDefinitionInspector({ step }) {
  return (
    <div className="any-inspector-inner">
      <div className="any-panel-heading">
        <b>{t('步骤定义')}</b>
      </div>
      <div className="any-detail-content">
        <h3>{step.title}</h3>
        <Tag>{step.recordCount > 0 ? t('读取执行记录') : t('尚未开始')}</Tag>
        <p>{t('此处展示固定版本的步骤要求；实际结果会在执行记录中显示。')}</p>
        <ApplicationStepDefinition step={step} />
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'definition',
              label: t('原始步骤定义'),
              children: (
                <pre>
                  {JSON.stringify(
                    {
                      stepId: step.stepId,
                      type: step.type,
                      ref: step.ref,
                      workflow: step.workflow,
                      join: step.join,
                      choices: step.choices,
                    },
                    null,
                    2,
                  )}
                </pre>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
