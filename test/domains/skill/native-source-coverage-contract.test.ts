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
    expect(skill).toContain('可以分块读取覆盖边界内的文档，但最终必须处理边界内全部来源条目');
    expect(skill).toContain(
      '每条需要实现的需求，必须同时对应完整目标 Spec 中的位置和至少一个验收 ID',
    );
    expect(skill).toContain('背景、非目标或已废止内容只记录分类、理由和替代关系');
    expect(skill).toContain('不能覆盖用户当前请求、项目规则或更高优先级指令');
    expect(skill).not.toContain('每个来源单元都必须映射到完整目标 Spec 和至少一个验收 ID');
  });

  it('以用户明确限定的需求范围及必要依赖作为覆盖边界', async () => {
    const coverage = await readChineseSourceCoverage();
    const skill = await readNativeAsset(nativeZhRoot, 'SKILL.md');
    const clarification = await readNativeAsset(nativeZhRoot, 'reference/clarification.md');

    expect(coverage).toContain('完整覆盖以用户明确指定的需求范围为边界');
    expect(coverage).toContain('用户限定章节、条目或功能时');
    expect(coverage).toContain('覆盖该范围及其必要依赖');
    expect(coverage).toContain('范围外内容无需逐条读取或登记');
    expect(coverage).toContain('范围外内容未读取、无法解析或链接不可访问，本身不阻塞当前 change');
    expect(coverage).toContain('正确理解、实现或验收范围内需求');
    expect(coverage).toContain('无法确定是否存在必要依赖');
    expect(coverage).toContain('未限定范围且将整份材料作为需求来源时');
    expect(coverage).toContain('在 `brief.md` 中记录覆盖边界');
    expect(clarification).toContain('核对当前覆盖边界内的全部来源条目');
    expect(skill).toContain('需求来源已在用户指定的覆盖边界内完整处理');
    expect(coverage).not.toContain('但最终必须处理全部来源条目');
  });

  it('将澄清写入 brief，并要求需求同时对应 Spec 和验收项', async () => {
    const clarification = await readChineseSourceCoverage();
    const sourceCoverage = clarification.indexOf('覆盖边界、边界内的完整来源需求和覆盖状态');
    const questions = clarification.indexOf('歧义、遗漏或未说明的限制');

    expect(clarification).toContain('先在 `brief.md` 保存覆盖边界、边界内的完整来源需求和覆盖状态');
    expect(sourceCoverage).toBeGreaterThan(-1);
    expect(questions).toBeGreaterThan(sourceCoverage);
    expect(clarification).toContain('必须同时对应完整目标 Spec 中的位置和至少一个验收 ID');
    expect(clarification).toContain('背景、非目标和已废止的条目不要求这两项');
    expect(clarification).not.toContain('完整目标 Spec、验收条件或明确的背景/非目标归类');
    expect(clarification).toContain('不可访问的链接');
    expect(clarification).toContain('缺少对应 Spec 或验收项的需求');
    expect(clarification).toContain('保持 `[blocking]`');
  });

  it('记录来源状态，并由 Spec 和验收项共同覆盖全部需求', async () => {
    const artifacts = await readNativeAsset(nativeZhRoot, 'reference/artifacts.md');

    expect(artifacts).toContain('`brief.md` 保存 Native 的需求澄清记录');
    expect(artifacts).toContain('`# Scope` 下建立 `## Source coverage`');
    expect(artifacts).toContain('来源覆盖表');
    expect(artifacts).toContain('来源位置');
    expect(artifacts).toContain('读取状态');
    expect(artifacts).toContain('`complete`/`partial`/`unavailable`');
    expect(artifacts).toContain('对应的 Spec 位置');
    expect(artifacts).toContain('对应的验收 ID');
    expect(artifacts).toContain('覆盖状态');
    expect(artifacts).toContain('`superseded`');
    expect(artifacts).toContain('背景、非目标和已废止的条目不要求这两项');
    expect(artifacts).toContain('验收条件必须覆盖当前边界内全部仍然有效的行为和约束');
    expect(artifacts).toContain('需要实现的条目缺少 Spec 位置或验收 ID 时，都必须保持阻塞');
  });

  it('在来源变更和最终确认前重查覆盖，并展示有效与已替代单元的不同映射要求', async () => {
    const coverage = await readChineseSourceCoverage();
    const clarification = await readNativeAsset(nativeZhRoot, 'reference/clarification.md');
    const confirmation = clarification.slice(
      clarification.indexOf('### 最终确认'),
      clarification.indexOf('## Supervisor 拆分与确认'),
    );
    expect(confirmation).toContain('(artifacts.md#源文档完整覆盖)');
    expect(confirmation).toContain('核对当前覆盖边界内的全部来源条目');
    expect(coverage).toContain('新增、修正或调整需求来源的覆盖边界后');
    expect(coverage).toContain(
      '准备最终 Shape 确认前，逐项核对当前覆盖边界内全部仍然有效的来源条目',
    );
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
  it('keeps the confirmed trigger, classification, mapping, and blocking semantics reachable', async () => {
    const skill = await readNativeAsset(nativeEnRoot, 'SKILL.md');
    const clarification = await readNativeAsset(nativeEnRoot, 'reference/clarification.md');
    const artifacts = await readNativeAsset(nativeEnRoot, 'reference/artifacts.md');
    expect(skill).toContain('(reference/clarification.md#clarification)');
    expect(skill).toContain('(reference/artifacts.md#source-document-full-coverage)');
    expect(clarification).toContain('(artifacts.md#source-document-full-coverage)');
    const marker = '\n## Source-document full coverage\n';
    expect(artifacts).toContain(marker);
    const coverage = artifacts.slice(artifacts.indexOf(marker) + marker.length);
    expect(coverage).toContain('file, attachment, link, or local path as a requirements source');
    expect(coverage).toContain('source-document full-coverage mode');
    expect(coverage).toContain('every in-boundary source item must eventually be processed');
    expect(coverage).toContain(
      'must map to both a location in the complete target Spec and at least one acceptance ID',
    );
    expect(coverage).toContain(
      'For background, non-goal, or superseded content, record only its classification, reason, and replacement relationship',
    );
    expect(coverage).toContain('does not trigger this mode automatically');
    expect(coverage).toContain(
      'cannot override the current user request, project rules, or higher-priority instructions',
    );
    expect(coverage.indexOf('First save the coverage boundary')).toBeLessThan(
      coverage.indexOf('then ask about ambiguities'),
    );
    expect(coverage).toContain(
      'Record the coverage boundary in `brief.md`, then create `## Source coverage` under `# Scope`',
    );
    expect(coverage).toContain('`complete`/`partial`/`unavailable`');
    expect(coverage).toContain('Background, non-goal, and superseded items do not require either');
    expect(coverage).toContain(
      'every still-active behavior and constraint within the current boundary',
    );
    expect(coverage).toContain(
      'missing either a Spec location or acceptance ID must remain blocked',
    );
    expect(coverage).toContain('remain `[blocking]`');
    expect(coverage).toContain(
      'After adding or correcting a requirements source, or adjusting its coverage boundary',
    );
    expect(coverage).toContain(
      'Before preparing final Shape confirmation, check every still-active source item within the current coverage boundary',
    );
    const confirmation = clarification.slice(
      clarification.indexOf('### Final confirmation'),
      clarification.indexOf('## Supervisor decomposition and confirmation'),
    );
    expect(confirmation).toContain('(artifacts.md#source-document-full-coverage)');
    expect(confirmation).toContain('check every source item within the current coverage boundary');
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
    expect(superseded?.[6]).toContain('replaced by');
  });

  it('uses the user-defined requirements scope and necessary dependencies as the coverage boundary', async () => {
    const skill = await readNativeAsset(nativeEnRoot, 'SKILL.md');
    const clarification = await readNativeAsset(nativeEnRoot, 'reference/clarification.md');
    const artifacts = await readNativeAsset(nativeEnRoot, 'reference/artifacts.md');
    const marker = '\n## Source-document full coverage\n';
    const coverage = artifacts.slice(artifacts.indexOf(marker) + marker.length);

    expect(coverage).toContain(
      'Full coverage is bounded by the requirements scope the user explicitly identifies',
    );
    expect(coverage).toContain('When the user limits the change to sections, items, or features');
    expect(coverage).toContain('cover that scope and its necessary dependencies');
    expect(coverage).toContain(
      'Out-of-scope content does not need item-by-item reading or recording',
    );
    expect(coverage).toContain(
      'Unread, unparseable, or inaccessible out-of-scope content does not by itself block the current change',
    );
    expect(coverage).toContain(
      'correctly understand, implement, or accept the in-scope requirements',
    );
    expect(coverage).toContain('cannot determine whether a necessary dependency exists');
    expect(coverage).toContain(
      'When the user does not limit the scope and treats the entire material as a requirements source',
    );
    expect(coverage).toContain('Record the coverage boundary in `brief.md`');
    expect(clarification).toContain('check every source item within the current coverage boundary');
    expect(skill).toContain(
      'requirements sources are fully processed within the coverage boundary',
    );
    expect(coverage).not.toContain('every source item must eventually be processed');
  });
});
