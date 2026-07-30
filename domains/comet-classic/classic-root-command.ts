import type { ClassicCommandHandler } from './classic-cli.js';
import {
  applyClassicRootMove,
  planClassicRootMove,
  type ClassicRootMovePlan,
} from './classic-root-move.js';
import {
  assertClassicLayoutReadable,
  classicProjectRelative,
  discoverClassicProject,
  type ClassicLayoutPaths,
} from './classic-layout.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';

type RootMoveLanguage = 'en' | 'zh-CN';
type RootMoveMode = 'dry-run' | 'complete';

function usage(language: RootMoveLanguage = 'en') {
  return {
    exitCode: 64,
    stderr:
      language === 'zh-CN'
        ? '用法：comet classic root show | comet classic root move docs --dry-run | comet classic root move docs --apply'
        : 'Usage: comet classic root show | comet classic root move docs --dry-run | comet classic root move docs --apply',
  };
}

function rootMoveLanguage(
  config: Awaited<ReturnType<typeof readWorkflowProjectConfig>>,
): RootMoveLanguage {
  return config?.classic?.language === 'en' ? 'en' : 'zh-CN';
}
function formatClassicRootMoveError(error: unknown, language: RootMoveLanguage): string {
  const message = error instanceof Error ? error.message : String(error);
  if (language === 'en') return message;
  if (message === 'invalid Classic root move journal: manifest paths must be unique and sorted') {
    return 'Classic 根目录迁移失败：迁移记录中的清单路径必须唯一且按顺序排列';
  }
  if (message.startsWith('invalid Classic root move journal:')) {
    return 'Classic 根目录迁移失败：迁移记录格式或内容无效，请运行 comet doctor 检查恢复状态';
  }
  return 'Classic 根目录迁移失败：迁移过程中发生错误，请运行 comet doctor 检查迁移状态';
}

export function formatClassicRootMoveReport(
  plan: ClassicRootMovePlan,
  mode: RootMoveMode,
  language: RootMoveLanguage = 'en',
): string {
  const zh = language === 'zh-CN';
  const list = (values: string[]) => (values.length > 0 ? values.join('; ') : zh ? '无' : 'none');
  const localizedReason = (value: string) => {
    if (!zh) return value;
    const pending = /^pending Classic root move: (.+) at (.+)$/u.exec(value);
    if (pending) return `存在待恢复的 Classic 根目录迁移：${pending[1]}，阶段 ${pending[2]}`;
    return (
      {
        'Classic docs target is not empty': 'docs 目标目录非空',
        'the locked apply preflight was not approved for execution': '已锁定的迁移预检尚未获准执行',
        'Classic legacy root changed after migration preflight': '迁移预检后 legacy 根目录发生变化',
        'Classic docs target changed after migration preflight': '迁移预检后 docs 目标目录发生变化',
        'Classic staging changed after migration preflight': '迁移预检后暂存目录发生变化',
        'Classic quarantine contains unknown or changed content': '隔离目录包含未知或已变化的内容',
        'project config does not match the expected post-switch config hash':
          '项目配置与切换后的预期配置哈希不一致',
        'the configured migration trees are incomplete': '已切换配置对应的迁移目录不完整',
        'project config changed after migration preflight': '迁移预检后项目配置发生变化',
        'the migration trees are not recoverable': '迁移目录当前无法安全恢复',
      }[value] ?? '迁移状态存在无法识别的冲突，请运行 comet doctor 检查恢复状态'
    );
  };
  const reasonLines = (label: string, values: string[]) =>
    values.length === 0
      ? [`${label}: ${zh ? '无' : 'none'}`]
      : [`${label}:`, ...values.map((value) => `- ${localizedReason(value)}`)];
  const targetState = zh
    ? { missing: '缺失', empty: '空目录', 'non-empty': '非空目录' }[plan.targetInitialState]
    : plan.targetInitialState;
  const historicalPointers = zh
    ? 'handoff 哈希；运行状态；检查点；轨迹；已归档证据与产物指针'
    : plan.historicalPointersPreserved.join('; ');
  const applyPreconditions = zh
    ? '内部迁移身份仍与布局、源目录、清单、目标目录和配置一致；不存在待恢复的根迁移事务；目标仍然缺失或为已绑定的空目录；所有迁移路径仍受保护'
    : plan.applyPreconditions.join('; ');
  const recoveryStrategies = zh
    ? plan.allowedRecoveryStrategies.map((strategy) => (strategy === 'continue' ? '继续' : '回滚'))
    : plan.allowedRecoveryStrategies;
  const lines = [
    mode === 'dry-run'
      ? zh
        ? 'Classic 根目录迁移现状'
        : 'Classic root move status'
      : zh
        ? 'Classic 根目录迁移完成'
        : 'Classic root move complete',
    ...(mode === 'dry-run'
      ? [
          zh
            ? '说明：仅查看现状，未修改任何文件。'
            : 'Note: Inspection only; no files were changed.',
        ]
      : []),
    `${zh ? '源目录' : 'source'}: ${plan.source}`,
    `${zh ? '目标目录' : 'target'}: ${plan.target}`,
    `${zh ? '暂存目录' : 'staging'}: ${plan.staging}`,
    `${zh ? '当前布局' : 'artifact layout'}: ${plan.artifactLayout}`,
    `${zh ? '源目录身份' : 'source identity'}: ${JSON.stringify(plan.sourceIdentity)}`,
    `${zh ? '目标初始身份' : 'target initial identity'}: ${plan.targetInitialIdentity ? JSON.stringify(plan.targetInitialIdentity) : zh ? '缺失' : 'missing'}`,
    `${zh ? '文件数' : 'files'}: ${plan.fileCount}`,
    `${zh ? '目录数' : 'directories'}: ${plan.directoryCount}`,
    `${zh ? '总字节数' : 'bytes'}: ${plan.totalBytes}`,
    `${zh ? '清单哈希' : 'manifest'}: ${plan.manifestHash}`,
    ...plan.fileSummary.map(
      (file) => `${zh ? '文件' : 'file'}: ${file.path} ${file.size} ${file.hash}`,
    ),
    `${zh ? '配置变更' : 'config change'}: ${plan.configChange.from} -> ${plan.configChange.to}`,
    `${zh ? '配置路径' : 'config path'}: ${plan.configPath}`,
    `${zh ? '配置哈希' : 'config'}: ${plan.configHash}`,
    `${zh ? '原配置哈希' : 'original config'}: ${plan.originalConfigHash}`,
    `${zh ? '预期配置哈希' : 'expected config'}: ${plan.expectedConfigHash}`,
    `${zh ? '目标初始状态' : 'target initial state'}: ${targetState}`,
    ...reasonLines(zh ? '冲突' : 'conflicts', plan.conflicts),
    ...reasonLines(zh ? '阻塞项' : 'blockers', plan.blockers),
    `${zh ? '待恢复事务' : 'pending recovery'}: ${plan.pendingRecovery ? `${plan.pendingRecovery.id} ${zh ? '位于阶段' : 'at'} ${plan.pendingRecovery.stage}` : zh ? '无' : 'none'}`,
    `${zh ? '保留历史指针' : 'historical pointers preserved'}: ${historicalPointers}`,
    `${zh ? '执行前提' : 'apply preconditions'}: ${applyPreconditions}`,
    `${zh ? '允许的恢复策略' : 'allowed recovery strategies'}: ${list(recoveryStrategies)}`,
    `${zh ? '可执行迁移' : 'ready to apply'}: ${plan.readyToApply ? (zh ? '是' : 'yes') : zh ? '否' : 'no'}`,
  ];
  if (mode === 'dry-run') {
    lines.push(
      plan.readyToApply
        ? zh
          ? '下一步：运行 comet classic root move docs --apply 执行迁移。'
          : 'Next: run comet classic root move docs --apply to apply the migration.'
        : zh
          ? '下一步：请先解决上述冲突或阻塞项。'
          : 'Next: resolve the conflicts or blockers above before applying.',
    );
  } else {
    lines.push(zh ? '结果：迁移已完成。' : 'Result: Migration completed.');
  }
  return `${lines.join('\n')}\n`;
}

function formatAlreadyMigratedReport(
  layout: ClassicLayoutPaths,
  mode: RootMoveMode,
  language: RootMoveLanguage,
): string {
  const root = classicProjectRelative(layout.projectRoot, layout.openSpecRoot);
  if (language === 'zh-CN') {
    return (
      [
        mode === 'dry-run' ? 'Classic 根目录迁移现状' : 'Classic 根目录迁移完成',
        `当前布局: ${layout.artifactLayout}`,
        `Classic 根目录: ${root}`,
        mode === 'dry-run'
          ? '说明：项目已经使用 docs/openspec，仅查看现状，未修改任何文件。'
          : '结果：项目已经使用 docs/openspec，无需重复迁移，未修改任何文件。',
      ].join('\n') + '\n'
    );
  }
  return (
    [
      mode === 'dry-run' ? 'Classic root move status' : 'Classic root move complete',
      `current layout: ${layout.artifactLayout}`,
      `Classic root: ${root}`,
      mode === 'dry-run'
        ? 'Note: The project already uses docs/openspec. Inspection only; no files were changed.'
        : 'Result: The project already uses docs/openspec. No migration was needed and no files were changed.',
    ].join('\n') + '\n'
  );
}

export const classicRootCommand: ClassicCommandHandler = async (args) => {
  const [action, target, mode, ...extra] = args;
  if (action === 'show' && target === undefined) {
    const projectRoot = await discoverClassicProject(process.cwd());
    const layout = await assertClassicLayoutReadable(projectRoot);
    return {
      exitCode: 0,
      stdout:
        JSON.stringify({
          schema: 'comet.classic-layout.v1',
          artifactLayout: layout.artifactLayout,
          openSpecRoot: classicProjectRelative(projectRoot, layout.openSpecRoot),
          changesRoot: classicProjectRelative(projectRoot, layout.changesDir),
          archiveRoot: classicProjectRelative(projectRoot, layout.archiveDir),
          specsRoot: classicProjectRelative(projectRoot, layout.specsDir),
          superpowersRoot: classicProjectRelative(projectRoot, layout.superpowersRoot),
        }) + '\n',
    };
  }
  if (action !== 'move' || target !== 'docs') return usage();

  const projectRoot = await discoverClassicProject(process.cwd());
  const config = await readWorkflowProjectConfig(projectRoot);
  const language = rootMoveLanguage(config);
  if ((mode !== '--dry-run' && mode !== '--apply') || extra.length > 0) {
    return usage(language);
  }

  const layout = await assertClassicLayoutReadable(projectRoot);
  const reportMode: RootMoveMode = mode === '--dry-run' ? 'dry-run' : 'complete';
  if (layout.artifactLayout === 'docs') {
    return {
      exitCode: 0,
      stdout: formatAlreadyMigratedReport(layout, reportMode, language),
    };
  }

  try {
    if (mode === '--dry-run') {
      const plan = await planClassicRootMove(projectRoot);
      return {
        exitCode: 0,
        stdout: formatClassicRootMoveReport(plan, 'dry-run', language),
      };
    }

    const plan = await applyClassicRootMove(projectRoot);
    return {
      exitCode: 0,
      stdout: formatClassicRootMoveReport(plan, 'complete', language),
    };
  } catch (error) {
    return {
      exitCode: 70,
      stderr: formatClassicRootMoveError(error, language),
    };
  }
};
