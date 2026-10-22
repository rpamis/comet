import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  getDashboardLanguage,
  getDashboardLocale,
  localized,
  readDashboardLanguage,
  setDashboardLanguage,
  subscribeDashboardLanguage,
  t,
  systemText,
  knowledgeText,
} from '../../../domains/dashboard/web/src/dashboard-i18n.js';
import english from '../../../domains/dashboard/web/src/messages.en.json';
import { renderYamlTable } from '../../../domains/dashboard/web/src/markdown-preview.js';

afterEach(() => setDashboardLanguage('zh', { persist: false }));

describe('Dashboard interface language', () => {
  it('translates stored system reasons and repository descriptions without changing records', () => {
    setDashboardLanguage('en', { persist: false });
    const reason = '由用户明确要求，立即更新个人记忆；用户明确设置；当前项目已匹配';
    expect(systemText(reason)).toBe(
      'Requested directly by the user; Explicitly set by the user; Current project matches',
    );
    expect(systemText('用户补充的自由说明')).toBe('用户补充的自由说明');
    expect(systemText('原验收结果保留；打开时读取对应创作记录，不能用于当前候选')).toBe(
      'The original validation result is retained; open its creation record to read it. It does not apply to the current candidate.',
    );
    const record = {
      id: 'generated-module-dashboard',
      authority: 'repository',
      title: '模块入口与依赖：domains/dashboard',
      summary:
        '可确认入口：domains/dashboard/server.ts。 跨模块依赖：domains/eval。 镜像测试目录：test/domains/dashboard/。',
    };
    const before = JSON.stringify(record);
    expect(knowledgeText(record, record.title)).toBe(
      'Module entry points and dependencies: domains/dashboard',
    );
    expect(knowledgeText(record, record.summary)).toBe(
      'Confirmed entry points: domains/dashboard/server.ts. Cross-module dependencies: domains/eval. Mirrored test directory: test/domains/dashboard/.',
    );
    expect(knowledgeText({ ...record, authority: 'user' }, record.summary)).toBe(record.summary);
    expect(JSON.stringify(record)).toBe(before);
    expect(t('未进入检索：索引刷新超过时间预算，尚未处理的语料当前不会参与召回。')).toContain(
      'index refresh exceeded its time budget',
    );
    expect(t('Judge 凭据')).toBe('Judge credentials');
    setDashboardLanguage('zh', { persist: false });
    expect(knowledgeText(record, record.summary)).toBe(record.summary);
  });
  it('translates structured preview labels while preserving original document values', async () => {
    setDashboardLanguage('en', { persist: false });
    const html = await renderYamlTable('schema: 4\nname: 用户任务\n', { schema: 'native-state' });
    expect(html).toContain('Field');
    expect(html).toContain('Description');
    expect(html).toContain('Value');
    expect(html).toContain('Unique name of the current change.');
    expect(html).toContain('用户任务');
  });
  it('switches copy and presentation tables without changing protocol values', () => {
    const options = localized(Object.freeze([{ value: 'running', label: '进行中' }]));
    expect(options[0].label).toBe('进行中');
    expect(localized({ value: 'Passed', label: '通过' }).value).toBe('Passed');
    setDashboardLanguage('en', { persist: false });
    expect(t('评估工作台')).toBe('Evaluation workspace');
    expect(t('执行失败')).toBe('Execution failed');
    expect(options[0]).toEqual({ value: 'running', label: 'In progress' });
    expect(getDashboardLocale()).toBe('en-US');
    setDashboardLanguage('zh', { persist: false });
    expect(options[0].label).toBe('进行中');
    expect(getDashboardLocale()).toBe('zh-CN');
  });

  it('preserves interpolated user content and translates displayed diagnostics again', () => {
    setDashboardLanguage('en', { persist: false });
    expect(t('查看用例 {0}', ['用户用例'])).toBe('View case 用户用例');
    const message = t('更新失败：{0}', ['原始错误']);
    expect(message).toBe('Update failed: 原始错误');
    setDashboardLanguage('zh', { persist: false });
    expect(t(message)).toBe('更新失败：原始错误');
    expect(t('A custom untranslated message')).toBe('A custom untranslated message');
  });

  it('persists supported choices and tolerates unavailable browser storage', () => {
    const setItem = vi.fn();
    setDashboardLanguage('en', { storage: { setItem } });
    expect(setItem).toHaveBeenCalledWith('comet-dashboard-language', 'en');
    expect(readDashboardLanguage({ getItem: () => 'en' })).toBe('en');
    expect(readDashboardLanguage({ getItem: () => 'unsupported' })).toBe('zh');
    expect(
      readDashboardLanguage({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBe('zh');
    expect(() =>
      setDashboardLanguage('zh', {
        storage: {
          setItem: () => {
            throw new Error('denied');
          },
        },
      }),
    ).not.toThrow();
    setDashboardLanguage('unsupported', { storage: { setItem } });
    expect(getDashboardLanguage()).toBe('zh');
  });

  it('notifies mounted consumers only when the language changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDashboardLanguage(listener);
    setDashboardLanguage('zh', { persist: false });
    setDashboardLanguage('en', { persist: false });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setDashboardLanguage('zh', { persist: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('covers interface messages and preserves every interpolation slot', async () => {
    const directory = path.resolve('domains/dashboard/web/src');
    const missing: string[] = [];
    for (const name of (await fs.readdir(directory)).filter((entry) =>
      /\.(?:jsx|js)$/u.test(entry),
    )) {
      const source = ts.createSourceFile(
        name,
        await fs.readFile(path.join(directory, name), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JSX,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 't' &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const key = node.arguments[0].text;
          if (!Object.hasOwn(english, key) && !Object.hasOwn(english, key.trim()))
            missing.push(`${name}: ${key}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
    for (const [source, translation] of Object.entries(english)) {
      expect(translation.trim(), source).not.toBe('');
      expect(translation.match(/\{\d+\}/gu)?.sort() ?? [], source).toEqual(
        source.match(/\{\d+\}/gu)?.sort() ?? [],
      );
      if (source !== '中文') expect(translation, source).not.toMatch(/[\u4e00-\u9fff]/u);
    }
  });
});
