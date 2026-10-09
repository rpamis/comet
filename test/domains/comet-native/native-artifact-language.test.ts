import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isNativeBriefStructureHeading,
  nativeBriefStructureSubsectionKey,
  nativeBriefTemplate,
  nativeHeadingKey,
} from '../../../domains/comet-native/native-artifact-language.js';
import { deriveBriefAcceptanceCriteria } from '../../../domains/comet-native/native-acceptance.js';
import { validateNativeBrief } from '../../../domains/comet-native/native-artifacts.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { renderNativeVerificationReport } from '../../../domains/comet-native/native-verification-report-v2.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { renderNativeEvidenceProjectionMarkdown } from '../../../domains/comet-native/native-evidence-projection.js';

describe('Native artifact language', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('renders Chinese brief headings while keeping English headings available', () => {
    expect(nativeBriefTemplate('zh-CN')).toContain('# 目标\n');
    expect(nativeBriefTemplate('zh-CN')).toContain('# 验收示例\n');
    expect(nativeBriefTemplate('zh-CN')).not.toContain('# Outcome\n');
    expect(nativeBriefTemplate('en')).toContain('# Outcome\n');
    expect(nativeHeadingKey('验收示例')).toBe('acceptanceExamples');
    expect(nativeHeadingKey('Acceptance examples')).toBe('acceptanceExamples');
  });

  it('renders the directory structure skeleton under Scope in both languages', () => {
    const zhTemplate = nativeBriefTemplate('zh-CN');
    expect(zhTemplate).toContain('## 目录结构\n');
    expect(zhTemplate).toContain('### 新建\n');
    expect(zhTemplate).toContain('### 修改\n');
    expect(zhTemplate).toContain('### 删除\n');
    expect(zhTemplate).toContain('### 明确不建\n');
    expect(zhTemplate).not.toContain('## Directory structure\n');
    const enTemplate = nativeBriefTemplate('en');
    expect(enTemplate).toContain('## Directory structure\n');
    expect(enTemplate).toContain('### Created\n');
    expect(enTemplate).toContain('### Modified\n');
    expect(enTemplate).toContain('### Deleted\n');
    expect(enTemplate).toContain('### Not created\n');
    const scopeStart = enTemplate.indexOf('# Scope\n');
    const nextHeading = enTemplate.indexOf('# Non-goals\n');
    expect(enTemplate.slice(scopeStart, nextHeading)).toContain('## Directory structure\n');
  });

  it('matches bilingual directory structure headings', () => {
    expect(isNativeBriefStructureHeading('目录结构')).toBe(true);
    expect(isNativeBriefStructureHeading('Directory structure')).toBe(true);
    expect(isNativeBriefStructureHeading('Directory Structure')).toBe(true);
    expect(isNativeBriefStructureHeading('其他章节')).toBe(false);
    expect(nativeBriefStructureSubsectionKey('新建')).toBe('created');
    expect(nativeBriefStructureSubsectionKey('Created')).toBe('created');
    expect(nativeBriefStructureSubsectionKey('修改')).toBe('modified');
    expect(nativeBriefStructureSubsectionKey('删除')).toBe('deleted');
    expect(nativeBriefStructureSubsectionKey('明确不建')).toBe('notCreated');
    expect(nativeBriefStructureSubsectionKey('Not created')).toBe('notCreated');
    expect(nativeBriefStructureSubsectionKey('其他')).toBeNull();
  });

  it('validates and derives acceptance criteria from Chinese brief headings', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-zh-artifact-'));
    roots.push(root);
    const source = nativeBriefTemplate('zh-CN')
      .replace('# 目标\n', '# 目标\n实现中文产物。\n')
      .replace('# 范围\n', '# 范围\nNative change 文档。\n')
      .replace('# 非目标\n', '# 非目标\n不改机器 schema。\n')
      .replace('# 验收示例\n', '# 验收示例\n- 中文模板可用。\n');
    await fs.writeFile(path.join(root, 'brief.md'), source);

    await expect(validateNativeBrief(root, 'brief.md')).resolves.toMatchObject({
      valid: true,
      findings: [],
    });
    expect(deriveBriefAcceptanceCriteria(source)).toHaveLength(1);
  });

  it('renders the verification report in the change language', () => {
    const state = createNativePortableState({ name: 'zh-report', language: 'zh-CN' });
    state.phase = 'verify';
    state.verification_result = 'pass';
    state.verification = {
      candidate_id: 'candidate',
      identity_provider: 'host-attested',
      verifier_execution_ref: 'verifier',
      iteration: 1,
      attempt: 1,
      assurance: 'host-attested',
      verdict: 'pass',
      checks: [],
      summary: { text: '通过', truncated: false },
      risks: [],
      risks_truncated: false,
      completed_at: '2026-08-15T00:00:00.000Z',
    };

    const report = renderNativeVerificationReport(state);
    expect(report).toContain('# 验证\n');
    expect(report).toContain('## 当前结果\n');
    expect(report).toContain('## 验收\n');
    expect(report).not.toContain('# Verification\n');
  });

  it('uses the configured artifact language when creating a portable change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-zh-create-'));
    roots.push(root);
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'zh-change', language: 'zh-CN' });

    await expect(
      fs.readFile(path.join(nativePortableChangeDir(paths, 'zh-change'), 'brief.md'), 'utf8'),
    ).resolves.toContain('# 目标\n');
  });

  it('inherits native.language when the CLI language override is omitted', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-zh-cli-'));
    roots.push(root);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    await writeProjectConfig(root, defaultProjectConfig('docs', 'zh-CN'));

    const result = await runNativeCli([
      'new',
      'configured-language',
      '--json',
      '--project-root',
      root,
    ]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout ?? '{}') as { data?: { language?: string } };
    expect(data.data?.language).toBe('zh-CN');
    await expect(
      fs.readFile(
        path.join(root, 'docs', 'comet', 'changes', 'configured-language', 'brief.md'),
        'utf8',
      ),
    ).resolves.toContain('# 目标\n');
  });

  it('localizes the human-readable evidence projection', () => {
    const projection = renderNativeEvidenceProjectionMarkdown({
      change: 'zh-change',
      phase: 'shape',
      revision: 1,
      language: 'zh-CN',
      scope: null,
      envelope: null,
      receipts: [],
      generatedAt: '2026-08-15T00:00:00.000Z',
    });

    expect(projection).toContain('# Comet Native 证据概览\n');
    expect(projection).toContain('## 实现范围\n');
    expect(projection).not.toContain('# Comet Native Evidence Projection\n');
  });
});
