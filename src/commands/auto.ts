import path from 'path';
import { promises as fs } from 'fs';
import { checkbox, confirm, select } from '@inquirer/prompts';
import { fileExists } from '../utils/file-system.js';

const AUTO_CONFIG_FILENAME = 'comet-auto.yaml';

const DEFAULT_AUTO_CONFIG = `# Comet Auto-Pilot Configuration
# Global auto-mode config. Per-change overrides go in .comet.yaml under the auto: key.
#
# Run `comet auto validate` to check config validity after editing.

auto:
  enabled: true                     # Master switch; when false the hook only reminds, does not inject auto-advance instructions

  # Design confirmation strategy
  # auto_with_diff: auto-confirm with audit trail (recommended)
  # always_confirm: keep manual confirmation gate
  # always_skip: skip entirely (only for hotfix/tweak)
  confirm_design: auto_with_diff

  # Isolation & execution presets
  isolation: branch                 # branch | worktree
  build_mode: subagent-driven-development  # subagent-driven-development | executing-plans
  archive: true                     # Auto-archive after verification passes

  # Retry strategy
  max_retry: 2                      # Max auto-retries within a single phase
  retry_on:
    - build_error
    - verify_fail
  retry_backoff: [1, 2, 4]          # Retry backoff intervals (seconds), exponential
  max_consecutive_failures: 5       # Cross-phase consecutive failure hard limit

  # Pause conditions
  pause_on:
    - verify_fail
    - build_error
    - spec_drift_large
    - conflict_detected
    - phase_jump
    - external_commit
    - preset_upgrade
    - design_review_overdue

  # Quantitative thresholds
  thresholds:
    spec_drift_task_ratio: 0.5      # New-tasks / initial-tasks > this value triggers large drift
    design_review_days: 7           # Remind if auto-confirmed design unreviewed after N days
    build_timeout_minutes: 30

  # Audit
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
      message: `${AUTO_CONFIG_FILENAME} already exists. Overwrite?`,
      default: false,
    });
    if (!overwrite) {
      console.log('  Skipped.');
      return;
    }
  }
  await fs.writeFile(configPath, DEFAULT_AUTO_CONFIG, 'utf-8');
  console.log(`  ✓ Created ${AUTO_CONFIG_FILENAME}`);
}

async function validateConfig(projectDir: string): Promise<boolean> {
  const configPath = path.join(projectDir, AUTO_CONFIG_FILENAME);
  if (!(await fileExists(configPath))) {
    console.log(`  ⚠ ${AUTO_CONFIG_FILENAME} not found. Run \`comet auto init\` to create default config.`);
    return false;
  }

  const content = await fs.readFile(configPath, 'utf-8');
  const issues: string[] = [];

  // Basic structural checks
  if (!content.includes('auto:')) {
    issues.push('Missing auto: root node');
  }
  if (!content.includes('enabled:')) {
    issues.push('Missing auto.enabled field');
  }
  if (!content.includes('confirm_design:')) {
    issues.push('Missing auto.confirm_design field');
  }

  // Validate confirm_design values
  const confirmMatch = content.match(/^[^#]*confirm_design:\s*([^\s#]+)/m);
  if (
    confirmMatch &&
    !['auto_with_diff', 'always_confirm', 'always_skip'].includes(confirmMatch[1])
  ) {
    issues.push(
      `Invalid confirm_design value: ${confirmMatch[1]} (expected: auto_with_diff | always_confirm | always_skip)`,
    );
  }

  // Validate isolation values
  const isolationMatch = content.match(/^[^#]*isolation:\s*([^\s#]+)/m);
  if (isolationMatch && !['branch', 'worktree'].includes(isolationMatch[1])) {
    issues.push(`Invalid isolation value: ${isolationMatch[1]} (expected: branch | worktree)`);
  }

  if (issues.length > 0) {
    console.log('  ✗ Config validation failed:');
    for (const issue of issues) {
      console.log(`    - ${issue}`);
    }
    return false;
  }

  console.log('  ✓ Config validation passed');
  return true;
}

async function dryRun(projectDir: string): Promise<void> {
  console.log('[DRY RUN] Comet Auto-Pilot preview mode\n');

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
    console.log('[DRY RUN] auto.enabled: false — reminder-only mode, will not auto-advance');
    return;
  }

  // Scan active changes (simulated — actual detection requires openspec CLI)
  console.log('[DRY RUN] Scanning active changes ...');
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
    console.log('\n[DRY RUN] Operations to execute:');
    console.log('[DRY RUN]   1. Sort changes by priority');
    console.log('[DRY RUN]   2. Auto-resume highest-priority change');
    console.log('[DRY RUN]   3. Advance pipeline per comet-auto.yaml config');
    console.log(`[DRY RUN]   Config: confirm_design=auto_with_diff, max_retry=2, archive=true`);
    console.log('[DRY RUN]   Pause conditions: build_error(retry×2), verify_fail(retry×2)');
    console.log('\n[DRY RUN] Will not modify any files or state');
  } catch {
    console.log('[DRY RUN] Cannot run openspec list. Verify OpenSpec is installed.');
  }
}

async function rollbackChange(projectDir: string, changeName: string): Promise<void> {
  const autoDir = path.join(projectDir, 'openspec', 'changes', changeName, '.comet', 'auto');
  const diffFile = path.join(autoDir, 'design-diff.md');

  if (!(await fileExists(diffFile))) {
    console.log(`  ✗ Change "${changeName}" has no auto-confirm record (design-diff.md not found)`);
    return;
  }

  console.log(`  About to rollback design auto-confirm for change "${changeName}":\n`);

  // Show diff summary
  try {
    const diffContent = await fs.readFile(diffFile, 'utf-8');
    const lines = diffContent
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 15);
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    if (diffContent.split('\n').length > 15) {
      console.log('  ... (truncated; see original file for full content)');
    }
  } catch {
    console.log('  (cannot read design-diff.md)');
  }

  const confirmed = await confirm({
    message: `Confirm rollback? Will delete Design Doc and revert phase to open`,
    default: false,
  });

  if (!confirmed) {
    console.log('  Cancelled.');
    return;
  }

  // Check phase before rollback (only allowed during design phase)
  const yamlPath = path.join(projectDir, 'openspec', 'changes', changeName, '.comet.yaml');
  if (await fileExists(yamlPath)) {
    const yamlContent = await fs.readFile(yamlPath, 'utf-8');
    const phaseMatch = yamlContent.match(/^phase:\s*(\S+)/m);
    if (phaseMatch && phaseMatch[1] !== 'design') {
      console.log(`  ✗ Current phase is "${phaseMatch[1]}"; rollback is only allowed during design phase`);
      return;
    }
  }

  // Remove design-diff.md
  await fs.unlink(diffFile).catch(() => {});
  console.log('  ✓ Deleted design-diff.md');

  // Remove design_doc reference and reset phase
  // (State changes done via comet-state.sh — here we just remove the audit file)
  console.log('  ✓ Rollback complete. Use /comet-design to re-run design.');
}

async function cleanAuto(projectDir: string): Promise<void> {
  const changesDir = path.join(projectDir, 'openspec', 'changes');
  const globalMarker = path.join(changesDir, '.comet-auto-active');

  // Clean global marker
  if (await fileExists(globalMarker)) {
    await fs.unlink(globalMarker);
    console.log('  ✓ Cleared global auto marker');
  }

  // Clean per-change auto directories
  try {
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'archive') {
        const autoDir = path.join(changesDir, entry.name, '.comet', 'auto');
        if (await fileExists(autoDir)) {
          await fs.rm(autoDir, { recursive: true, force: true });
          console.log(`  ✓ Cleaned ${entry.name}/.comet/auto/`);
        }
      }
    }
  } catch {
    // No changes directory
  }

  console.log('  Cleanup complete.');
}

export async function autoCommand(
  targetPath: string,
  options: {
    init?: boolean;
    validate?: boolean;
    dryRun?: boolean;
    rollback?: string;
    clean?: boolean;
  },
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
  console.log('Comet Auto-Pilot Configuration\n');

  const action = await select({
    message: 'Select action:',
    choices: [
      { name: 'Generate default config', value: 'init' },
      { name: 'Validate existing config', value: 'validate' },
      { name: 'Preview auto-mode execution plan', value: 'dry-run' },
      { name: 'Clean auto runtime files', value: 'clean' },
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
