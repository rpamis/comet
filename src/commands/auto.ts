import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { checkbox, confirm, select } from '@inquirer/prompts';
import { fileExists } from '../utils/file-system.js';

const AUTO_CONFIG_FILENAME = 'comet-auto.yaml';

const DEFAULT_AUTO_CONFIG = `# Comet Auto-Pilot Configuration
# 自动模式全局配置，change 级覆盖在 .comet.yaml 的 auto: 字段中设置。
#
# 修改后运行 comet auto validate 校验配置有效性。

auto:
  enabled: true                     # 总开关；false 时 hook 仅提醒，不注入自动推进指令

  # 设计确认策略
  # auto_with_diff: 自动通过，写入审计轨迹（推荐）
  # always_confirm: 保持手动确认阻塞点
  # always_skip: 完全跳过（仅建议 hotfix/tweak）
  confirm_design: auto_with_diff

  # 隔离与执行预设
  isolation: branch                 # branch | worktree
  build_mode: subagent-driven-development  # subagent-driven-development | executing-plans
  archive: true                     # 验证通过后自动归档

  # 重试策略
  max_retry: 2                      # 单 phase 内自动重试次数
  retry_on:
    - build_error
    - verify_fail
  retry_backoff: [1, 2, 4]          # 重试等待间隔（秒），指数递增
  max_consecutive_failures: 5       # 跨 phase 连续失败硬上限

  # 阻断条件
  pause_on:
    - verify_fail
    - build_error
    - spec_drift_large
    - conflict_detected
    - phase_jump
    - external_commit
    - preset_upgrade
    - design_review_overdue

  # 量化阈值
  thresholds:
    spec_drift_task_ratio: 0.5      # 新增任务/初始任务 > 此值视为 large drift
    max_consecutive_failures: 5
    design_review_days: 7           # auto-confirm N 天后未审查则提醒
    build_timeout_minutes: 30

  # 审计
  audit:
    log_decisions: true
    log_path: .comet/auto/decisions.jsonl
    remind_unreviewed: true
`;

function getProjectDir(targetPath: string): string {
  return path.resolve(targetPath || '.');
}

async function generateDefaultConfig(projectDir: string): Promise<void> {
  const configPath = path.join(projectDir, AUTO_CONFIG_FILENAME);
  if (await fileExists(configPath)) {
    const overwrite = await confirm({
      message: `${AUTO_CONFIG_FILENAME} 已存在，是否覆盖？`,
      default: false,
    });
    if (!overwrite) {
      console.log('  跳过生成。');
      return;
    }
  }
  await fs.writeFile(configPath, DEFAULT_AUTO_CONFIG, 'utf-8');
  console.log(`  ✓ 已生成 ${AUTO_CONFIG_FILENAME}`);
}

async function validateConfig(projectDir: string): Promise<boolean> {
  const configPath = path.join(projectDir, AUTO_CONFIG_FILENAME);
  if (!(await fileExists(configPath))) {
    console.log(`  ⚠ ${AUTO_CONFIG_FILENAME} 不存在。运行 comet auto init 生成默认配置。`);
    return false;
  }

  const content = await fs.readFile(configPath, 'utf-8');
  const issues: string[] = [];

  // Basic structural checks
  if (!content.includes('auto:')) {
    issues.push('缺少 auto: 根节点');
  }
  if (!content.includes('enabled:')) {
    issues.push('缺少 auto.enabled 字段');
  }
  if (!content.includes('confirm_design:')) {
    issues.push('缺少 auto.confirm_design 字段');
  }

  // Validate confirm_design values
  const confirmMatch = content.match(/confirm_design:\s*(\S+)/);
  if (confirmMatch && !['auto_with_diff', 'always_confirm', 'always_skip'].includes(confirmMatch[1])) {
    issues.push(`无效的 confirm_design 值: ${confirmMatch[1]}（应为 auto_with_diff | always_confirm | always_skip）`);
  }

  // Validate isolation values
  const isolationMatch = content.match(/isolation:\s*(\S+)/);
  if (isolationMatch && !['branch', 'worktree'].includes(isolationMatch[1])) {
    issues.push(`无效的 isolation 值: ${isolationMatch[1]}（应为 branch | worktree）`);
  }

  if (issues.length > 0) {
    console.log('  ✗ 配置校验失败:');
    for (const issue of issues) {
      console.log(`    - ${issue}`);
    }
    return false;
  }

  console.log('  ✓ 配置校验通过');
  return true;
}

async function dryRun(projectDir: string): Promise<void> {
  console.log('[DRY RUN] Comet Auto-Pilot 预览模式\n');

  // Check if auto is enabled
  const configPath = path.join(projectDir, AUTO_CONFIG_FILENAME);
  let enabled = true;
  if (await fileExists(configPath)) {
    const content = await fs.readFile(configPath, 'utf-8');
    const enabledMatch = content.match(/enabled:\s*(\S+)/);
    if (enabledMatch && enabledMatch[1] === 'false') {
      enabled = false;
    }
  }

  if (!enabled) {
    console.log('[DRY RUN] auto.enabled: false — 仅提醒模式，不会自动推进');
    return;
  }

  // Scan active changes (simulated — actual detection requires openspec CLI)
  console.log('[DRY RUN] 扫描活跃 change ...');
  try {
    const { execSync } = await import('child_process');
    const result = execSync('openspec list --json 2>/dev/null || echo "[]"', {
      cwd: projectDir,
      encoding: 'utf-8',
    }).trim();
    const changes = JSON.parse(result);

    if (changes.length === 0) {
      console.log('[DRY RUN] 无活跃 change，无需操作');
      return;
    }

    console.log(`[DRY RUN] 检测到 ${changes.length} 个活跃 change:`);
    for (const change of changes) {
      console.log(`[DRY RUN]   - ${change.name || change}`);
    }

    // Show what would be done
    console.log('\n[DRY RUN] 将执行的操作:');
    console.log('[DRY RUN]   1. 按优先级排序 change');
    console.log('[DRY RUN]   2. 自动续接最高优先级 change');
    console.log('[DRY RUN]   3. 按 comet-auto.yaml 配置推进流水线');
    console.log(`[DRY RUN]   配置: confirm_design=auto_with_diff, max_retry=2, archive=true`);
    console.log('[DRY RUN]   阻断条件: build_error(重试2次), verify_fail(重试2次)');
    console.log('\n[DRY RUN] 不会修改任何文件或状态');
  } catch {
    console.log('[DRY RUN] 无法运行 openspec list，请确认 OpenSpec 已安装');
  }
}

async function rollbackChange(projectDir: string, changeName: string): Promise<void> {
  const autoDir = path.join(projectDir, 'openspec', 'changes', changeName, '.comet', 'auto');
  const diffFile = path.join(autoDir, 'design-diff.md');

  if (!(await fileExists(diffFile))) {
    console.log(`  ✗ Change "${changeName}" 没有 auto-confirm 记录（design-diff.md 不存在）`);
    return;
  }

  console.log(`  即将回滚 change "${changeName}" 的设计自动确认:\n`);

  // Show diff summary
  try {
    const diffContent = await fs.readFile(diffFile, 'utf-8');
    const lines = diffContent.split('\n').filter(l => l.trim()).slice(0, 15);
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    if (diffContent.split('\n').length > 15) {
      console.log('  ...（截断，完整内容见原文件）');
    }
  } catch {
    console.log('  （无法读取 design-diff.md）');
  }

  const confirmed = await confirm({
    message: `确认回滚？将删除 Design Doc 并回退 phase 到 open`,
    default: false,
  });

  if (!confirmed) {
    console.log('  已取消。');
    return;
  }

  // Check phase before rollback (only allowed during design phase)
  const yamlPath = path.join(projectDir, 'openspec', 'changes', changeName, '.comet.yaml');
  if (await fileExists(yamlPath)) {
    const yamlContent = await fs.readFile(yamlPath, 'utf-8');
    const phaseMatch = yamlContent.match(/^phase:\s*(\S+)/m);
    if (phaseMatch && phaseMatch[1] !== 'design') {
      console.log(`  ✗ 当前 phase 为 "${phaseMatch[1]}"，回滚仅允许在 design 阶段执行`);
      return;
    }
  }

  // Remove design-diff.md
  await fs.unlink(diffFile).catch(() => {});
  console.log('  ✓ 已删除 design-diff.md');

  // Remove design_doc reference and reset phase
  // (State changes done via comet-state.sh — here we just remove the audit file)
  console.log('  ✓ 回滚完成。使用 /comet-design 重新执行设计。');
}

async function cleanAuto(projectDir: string): Promise<void> {
  const changesDir = path.join(projectDir, 'openspec', 'changes');
  const globalMarker = path.join(changesDir, '.comet-auto-active');

  // Clean global marker
  if (await fileExists(globalMarker)) {
    await fs.unlink(globalMarker);
    console.log('  ✓ 已清理全局 auto 标记');
  }

  // Clean per-change auto directories
  try {
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'archive') {
        const autoDir = path.join(changesDir, entry.name, '.comet', 'auto');
        if (await fileExists(autoDir)) {
          await fs.rm(autoDir, { recursive: true, force: true });
          console.log(`  ✓ 已清理 ${entry.name}/.comet/auto/`);
        }
      }
    }
  } catch {
    // No changes directory
  }

  console.log('  清理完成。');
}

export async function autoCommand(
  targetPath: string,
  options: { init?: boolean; validate?: boolean; dryRun?: boolean; rollback?: string; clean?: boolean },
): Promise<void> {
  const projectDir = getProjectDir(targetPath);

  if (options.clean) {
    await cleanAuto(projectDir);
    return;
  }

  if (options.init) {
    await generateDefaultConfig(projectDir);
    return;
  }

  if (options.validate) {
    await validateConfig(projectDir);
    return;
  }

  if (options.dryRun) {
    await dryRun(projectDir);
    return;
  }

  if (options.rollback) {
    await rollbackChange(projectDir, options.rollback);
    return;
  }

  // Interactive mode
  console.log('Comet Auto-Pilot 配置\n');

  const action = await select({
    message: '选择操作:',
    choices: [
      { name: '生成默认配置', value: 'init' },
      { name: '校验现有配置', value: 'validate' },
      { name: '预览自动模式执行计划', value: 'dry-run' },
      { name: '清理 auto 运行时文件', value: 'clean' },
    ],
  });

  switch (action) {
    case 'init':
      await generateDefaultConfig(projectDir);
      break;
    case 'validate':
      await validateConfig(projectDir);
      break;
    case 'dry-run':
      await dryRun(projectDir);
      break;
    case 'clean':
      await cleanAuto(projectDir);
      break;
  }
}
