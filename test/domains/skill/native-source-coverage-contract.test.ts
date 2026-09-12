import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeZhRoot = path.resolve('assets', 'skills-zh', 'comet-native');
const nativeEnRoot = path.resolve('assets', 'skills', 'comet-native');

async function readNativeAsset(root: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function readChineseSourceCoverage(): Promise<string> {
  const skill = await readNativeAsset(nativeZhRoot, 'SKILL.md');
  const clarification = await readNativeAsset(nativeZhRoot, 'reference/clarification.md');
  expect(skill).toContain('(reference/clarification.md#澄清)');
  expect(skill).toContain('(reference/artifacts.md#源文档完整覆盖)');
  expect(clarification).toContain('(artifacts.md#源文档完整覆盖)');
  const artifacts = await readNativeAsset(nativeZhRoot, 'reference/artifacts.md');
  const marker = '\n## 源文档完整覆盖\n';
  const start = artifacts.indexOf(marker);
  expect(start, 'Source-coverage pointer must resolve to a real section').toBeGreaterThan(-1);
  const contentStart = start + marker.length;
  const end = artifacts.indexOf('\n## ', contentStart);
  return artifacts.slice(contentStart, end === -1 ? undefined : end);
}

describe('Native 中文源文档完整覆盖契约', () => {
  it('只在文件或链接作为需求来源时进入完整覆盖模式', async () => {
    const skill = await readChineseSourceCoverage();

    expect(skill).toContain('文件、附件、链接或本地路径作为需求来源');
    expect(skill).toContain('源文档完整覆盖模式');
    expect(skill).toContain('分块读取只改变读取顺序和工作记忆管理，不改变最终覆盖集合');
    expect(skill).toContain('可执行来源单元必须同时映射到完整目标 Spec 和至少一个验收 ID');
    expect(skill).toContain('背景、非目标或已废止内容只保留归类、理由和替代关系');
    expect(skill).toContain('不能覆盖用户当前请求、项目规则或更高优先级指令');
    expect(skill).not.toContain('每个来源单元都必须映射到完整目标 Spec 和至少一个验收 ID');
  });

  it('把 brief 定义为持久化澄清产物并关闭单边映射逃逸路径', async () => {
    const clarification = await readChineseSourceCoverage();
    const sourceCoverage = clarification.indexOf('完整来源需求和覆盖状态');
    const questions = clarification.indexOf('歧义、遗漏或隐含边界');

    expect(clarification).toContain('`brief.md` 是持久化澄清产物');
    expect(sourceCoverage).toBeGreaterThan(-1);
    expect(questions).toBeGreaterThan(sourceCoverage);
    expect(clarification).toContain('必须同时映射到完整目标 Spec 和至少一个验收 ID');
    expect(clarification).toContain('背景、非目标和已废止来源单元不要求 Spec 位置或验收 ID');
    expect(clarification).not.toContain('完整目标 Spec、验收条件或明确的背景/非目标归类');
    expect(clarification).toContain('不可访问的链接');
    expect(clarification).toContain('未映射的可执行来源单元');
    expect(clarification).toContain('保持 `[blocking]`');
  });

  it('定义可审计的来源状态并让 Spec 与验收共同覆盖可执行语义', async () => {
    const artifacts = await readNativeAsset(nativeZhRoot, 'reference/artifacts.md');

    expect(artifacts).toContain('`brief.md` 是 Native 的持久化澄清产物');
    expect(artifacts).toContain('`# Scope` 下建立 `## Source coverage`');
    expect(artifacts).toContain('来源覆盖映射');
    expect(artifacts).toContain('来源定位');
    expect(artifacts).toContain('读取状态');
    expect(artifacts).toContain('`complete`/`partial`/`unavailable`');
    expect(artifacts).toContain('对应的 Spec 位置');
    expect(artifacts).toContain('对应的验收 ID');
    expect(artifacts).toContain('覆盖状态');
    expect(artifacts).toContain('`superseded`');
    expect(artifacts).toContain('背景、非目标和已废止来源单元不要求 Spec 位置或验收 ID');
    expect(artifacts).toContain('验收条件至少覆盖原始来源的全部当前有效可执行语义');
    expect(artifacts).toContain('未覆盖内容或缺少双重映射的可执行单元保持阻塞');
  });

  it('在来源变更和最终确认前重查覆盖，并展示有效与已替代单元的不同映射要求', async () => {
    const coverage = await readChineseSourceCoverage();
    const clarification = await readNativeAsset(nativeZhRoot, 'reference/clarification.md');
    const confirmation = clarification.slice(
      clarification.indexOf('### 最终确认'),
      clarification.indexOf('## Supervisor 拆分与确认'),
    );
    expect(confirmation).toContain('(artifacts.md#源文档完整覆盖)');
    expect(confirmation).toContain('核对当前全部来源单元');
    expect(coverage).toContain('新增或修正需求来源后，先更新受影响来源单元');
    expect(coverage).toContain('准备最终 Shape 确认前逐项核对全部当前有效单元');
    const rows = coverage
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.length === 7)).toBe(true);
    const active = rows.find((row) => row[5] === 'covered');
    expect(active?.[3]).toContain('specs/');
    expect(active?.[4]).toMatch(/^A\d+$/u);
    const superseded = rows.find((row) => row[5] === 'superseded');
    expect(superseded?.slice(3, 5)).toEqual(['—', '—']);
    expect(superseded?.[6]).toContain('替代');
  });
});

describe('Native English source-document coverage contract', () => {
  it('keeps the confirmed trigger, classification, mapping, and blocking semantics', async () => {
    const skill = await readNativeAsset(nativeEnRoot, 'SKILL.md');
    const clarification = await readNativeAsset(nativeEnRoot, 'reference/clarification.md');
    const artifacts = await readNativeAsset(nativeEnRoot, 'reference/artifacts.md');

    expect(skill).toContain('file, attachment, link, or local path as a requirements source');
    expect(skill).toContain('source-document full-coverage mode');
    expect(skill).toContain(
      'must map to both the complete target Spec and at least one acceptance ID',
    );
    expect(skill).toContain('background, non-goal, or superseded');
    expect(skill).toContain('do not trigger this mode automatically');
    expect(skill).toContain(
      'cannot override the current user request, project rules, or higher-priority instructions',
    );

    expect(clarification).toContain('`brief.md` is the durable clarification artifact');
    expect(clarification).toContain(
      'must enter both the complete target Spec and at least one acceptance ID',
    );
    expect(clarification).toContain('do not require an acceptance ID');
    expect(clarification).toContain('remain `[blocking]`');

    expect(artifacts).toContain('`# Scope` under `## Source coverage`');
    expect(artifacts).toContain('`complete`/`partial`/`unavailable`');
    expect(artifacts).toContain('do not require a Spec location or acceptance ID');
    expect(artifacts).toContain(
      'all currently active executable semantics from the original source',
    );
  });
});
