import path from 'path';
import { inspectCometProjectStatus } from '../../domains/comet-entry/project-status.js';
import type { ChangeStatus, CometProjectStatus } from '../../domains/comet-entry/types.js';
import { requiresBranchBinding } from '../../domains/comet-classic/classic-branch-binding.js';
import {
  classicLocale,
  classicStatusSummaryLine,
} from '../../domains/comet-classic/classic-output-language.js';
import type { RecordedCommandCheck } from '../../domains/comet-classic/classic-command-checks.js';
import type { NativePortableStatusProjection } from '../../domains/comet-native/native-portable-status.js';
import { nativeStatusSummaryLine } from '../../domains/comet-native/native-output-language.js';
import { resolveProjectLanguage } from './resume-probe.js';
import type { CliOutputLocale } from '../../domains/workflow-contract/output-envelope.js';

function formatMissingEvidence(missingEvidence: readonly string[]): string {
  return missingEvidence.join(', ');
}

function displayCommandArgs(args: readonly string[]): string {
  return args
    .map((value) => (/^[A-Za-z0-9_./:=+@-]+$/u.test(value) ? value : JSON.stringify(value)))
    .join(' ');
}

function formatRuntimeCheckRecovery(
  nextCommand: string | null,
  missingEvidence: readonly string[],
): string {
  const missing = formatMissingEvidence(missingEvidence);
  if (nextCommand) {
    return `run ${nextCommand} or restore missing evidence (${missing}), then rerun comet doctor`;
  }
  return `restore missing evidence (${missing}) and rerun comet doctor`;
}

function formatCommandCheck(check: RecordedCommandCheck): string {
  const result = check.exitCode === 0 ? 'pass' : `fail exit=${check.exitCode}`;
  return `${result} (${check.command}; cwd: ${check.cwd}; recorded: ${check.timestamp})`;
}

function displayChangeSection(
  title: string,
  changes: ChangeStatus[],
  locale: CliOutputLocale,
): void {
  console.log(`${title}:\n`);
  if (changes.length === 0) {
    console.log('  No active changes.\n');
    return;
  }

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const taskStr = c.tasksTotal > 0 ? ` [${c.tasksCompleted}/${c.tasksTotal} tasks]` : '';
    const classification = c.cometManaged ? 'Comet' : 'OpenSpec';
    const phase = c.phase ? `phase: ${c.phase}` : 'plain change';
    console.log(`  ${i + 1}. ${c.name} [${classification}] [${phase}${taskStr}]`);
    console.log(
      `     ${classicStatusSummaryLine({
        name: c.name,
        phase: c.phase,
        tasksCompleted: c.tasksCompleted,
        tasksTotal: c.tasksTotal,
        error: Boolean(c.error),
        managed: c.cometManaged,
        locale,
      })}`,
    );
    if (c.error) {
      console.log(`     error: ${c.error}`);
      console.log('     next: inspect .comet.yaml and rerun comet doctor');
      console.log();
      continue;
    }
    if (!c.cometManaged) {
      if (c.archiveReady) console.log(`     recommended archive: ${c.recommendedArchiveCommand}`);
      console.log();
      continue;
    }
    console.log(`     workflow: ${c.workflow} | build_mode: ${c.buildMode}`);
    if (c.isolation) {
      const branchSuffix =
        requiresBranchBinding(c.isolation) && c.boundBranch ? ` (bound: ${c.boundBranch})` : '';
      console.log(`     isolation: ${c.isolation}${branchSuffix}`);
    }
    if (c.currentStep) console.log(`     run_step: ${c.currentStep}`);
    console.log(`     runtime_mode: ${c.runtimeMode}`);
    if (c.runtimeEval) {
      const suffix = c.runtimeEval.passed
        ? `(${c.runtimeEval.stepId})`
        : `(${c.runtimeEval.stepId}; missing: ${formatMissingEvidence(c.runtimeEval.missingEvidence)})`;
      console.log(`     runtime_check: ${c.runtimeEval.passed ? 'pass' : 'fail'} ${suffix}`);
    }
    if (c.commandChecks?.build) {
      console.log(`     build_check: ${formatCommandCheck(c.commandChecks.build)}`);
    }
    if (c.commandChecks?.verify) {
      console.log(`     verify_check: ${formatCommandCheck(c.commandChecks.verify)}`);
    }
    if (c.designDoc) console.log(`     design: ${c.designDoc}`);
    if (c.plan) console.log(`     plan:   ${c.plan}`);
    if (c.phase === 'verify') console.log(`     verify_result: ${c.verifyResult}`);
    if (c.runtimeEval && !c.runtimeEval.passed) {
      console.log(
        `     next: ${formatRuntimeCheckRecovery(c.nextCommand, c.runtimeEval.missingEvidence)}`,
      );
    } else if (c.nextCommand) {
      console.log(`     next: ${c.nextCommand}`);
    }
    if (c.archiveReady) console.log(`     recommended archive: ${c.recommendedArchiveCommand}`);
    console.log();
  }
}

function displayNativeChanges(
  section: CometProjectStatus['workflows']['native'],
  locale: CliOutputLocale,
): void {
  console.log('Native Changes:\n');
  if (section.error) {
    console.log(`     ${nativeSummaryLocaleText('section-error', locale)}`);
    console.log(`  error: ${section.error}\n`);
    return;
  }
  if (section.changes.length === 0) {
    console.log('  No active changes.\n');
    return;
  }
  for (let index = 0; index < section.changes.length; index++) {
    const change = section.changes[index];
    if (!('phase' in change)) {
      console.log(`  ${index + 1}. ${change.name} [Native] [phase: invalid]`);
      console.log(
        `     ${classicStatusSummaryLine({ name: change.name, phase: null, error: true, managed: true, locale })}`,
      );
      console.log(`     error: ${change.error}`);
      console.log(
        `     next: inspect the change state or rerun comet native doctor ${change.name}`,
      );
      console.log();
      continue;
    }
    if ('stateVersion' in change) {
      displayPortableNativeChange(change, index + 1, locale);
      continue;
    }
    console.log(`  ${index + 1}. ${change.name} [Native] [phase: ${change.phase}]`);
    console.log(`     ${nativeSummaryLocaleText('legacy', locale, change.name)}`);
    console.log(
      `     approval: ${change.approval ?? 'pending'} | verification: ${change.verificationResult} | spec_changes: ${change.specChanges}`,
    );
    if (change.selected) console.log('     selected: true');
    if (change.error) console.log(`     error: ${change.error}`);
    if (change.nextCommand) console.log(`     next: ${change.nextCommand}`);
    console.log();
  }
}

function nativeSummaryLocaleText(
  kind: 'section-error' | 'legacy',
  locale: CliOutputLocale,
  name?: string,
): string {
  if (kind === 'section-error') {
    return locale === 'zh-CN'
      ? '→ Native 状态暂时读取失败，原因见下方。'
      : '→ Native status could not be read right now; see the error below.';
  }
  return locale === 'zh-CN'
    ? `→ ${name}：旧格式 Native 需求，首次推进时会自动升级到当前格式。`
    : `→ ${name}: a legacy-format Native change; it upgrades automatically on the next advancing command.`;
}

function displayPortableNativeChange(
  change: NativePortableStatusProjection,
  index: number,
  locale: CliOutputLocale,
): void {
  console.log(`  ${index}. ${change.name} [Native] [phase: ${change.phase}]`);
  console.log(
    `     ${nativeStatusSummaryLine({
      name: change.name,
      phase: change.phase,
      status: change.status,
      acceptance: change.acceptance,
      locale,
    })}`,
  );
  console.log(
    `     status: ${change.status} | verification: ${change.verificationResult} | acceptance: ${change.acceptance.passed}/${change.acceptance.total}`,
  );
  if (change.workspace.bindingState !== 'aligned') {
    console.log(`     workspace: ${change.workspace.message ?? change.workspace.bindingState}`);
  }
  if (change.continuation.commandArgs) {
    console.log(`     next: ${displayCommandArgs(change.continuation.commandArgs)}`);
  }
  console.log();
}

function displayDefaultEntry(defaultEntry: CometProjectStatus['defaultEntry']): void {
  if ('error' in defaultEntry) {
    console.log(`Default Entry: error (${defaultEntry.error})\n`);
    return;
  }
  console.log(
    `Default Entry: ${defaultEntry.workflow} -> /${defaultEntry.skill} [${defaultEntry.source}]\n`,
  );
}

function displayStatus(status: CometProjectStatus, locale: CliOutputLocale): void {
  displayDefaultEntry(status.defaultEntry);
  displayNativeChanges(status.workflows.native, locale);
  displayChangeSection('Classic Changes', status.workflows.classic.changes, locale);
  displayChangeSection('Unmanaged OpenSpec Changes', status.unmanagedOpenSpec, locale);
}

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(
  targetPath: string,
  options: StatusOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const status = await inspectCometProjectStatus(projectPath);
  const changes = [...status.workflows.classic.changes, ...status.unmanagedOpenSpec].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (options.json) {
    console.log(JSON.stringify({ ...status, changes }, null, 2));
    return;
  }

  const locale = classicLocale(await resolveProjectLanguage(projectPath));
  displayStatus(status, locale);
}
