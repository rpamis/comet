export type Language = 'en' | 'zh';

export type TranslationKey =
  | 'settingUp'
  | 'installScope'
  | 'scopeProject'
  | 'scopeGlobal'
  | 'languagePrompt'
  | 'selectPlatforms'
  | 'selectedPlatforms'
  | 'noneSelected'
  | 'selectPlatformsRequired'
  | 'detected'
  | 'noPlatforms'
  | 'overwriteChoice'
  | 'overwrite'
  | 'skip'
  | 'bulkOverwrite'
  | 'overwriteAll'
  | 'skipAll'
  | 'choosePer'
  | 'installingOS'
  | 'osSkippedNoCli'
  | 'allSkipped'
  | 'installingSP'
  | 'spSkippedByUser'
  | 'alreadyExists'
  | 'rulesInstalled'
  | 'hooksInstalled'
  | 'hooksSkipped'
  | 'installCodegraph'
  | 'codegraphYes'
  | 'codegraphNo'
  | 'installingCG'
  | 'cgSkippedByUser'
  | 'setupComplete'
  | 'installed'
  | 'skippedLabel'
  | 'failedLabel'
  | 'failedStatus'
  | 'workingDirs'
  | 'nativeWorkingDir'
  | 'classicWorkingDirs'
  | 'getStarted'
  | 'getStartedComet'
  | 'getStartedHotfix'
  | 'getStartedTweak'
  | 'selectNpmDeps'
  | 'npmDepOpenSpec'
  | 'npmDepOpenSpecInstalled'
  | 'npmDepOpenSpecRequired'
  | 'npmDepSuperpowers'
  | 'npmDepSuperpowersInstalled'
  | 'npmDepSuperpowersHint'
  | 'npmDepCodegraph'
  | 'npmDepCodegraphInstalled'
  | 'npmDepNotInstalled'
  | 'updateTitle'
  | 'updatingNpmPackage'
  | 'npmLaunchFailed'
  | 'npmUpdateFailed'
  | 'npmNetworkHint'
  | 'npmPackageUpdated'
  | 'npmPackageFailed'
  | 'npmPackageFailedBlocking'
  | 'noInstallsFound'
  | 'updatingSkillsOnTargets'
  | 'copyingSkillsFiles'
  | 'skillsCopiedSkipped'
  | 'rulesUpdated'
  | 'rulesFailed'
  | 'hooksUpdated'
  | 'hooksFailed'
  | 'summary'
  | 'summaryNpm'
  | 'summarySkills'
  | 'summaryCodegraph'
  | 'summaryScope'
  | 'summaryLanguage'
  | 'updateComplete'
  | 'updateAllProjectsPrompt'
  | 'updateAllProjectsYes'
  | 'updateAllProjectsNo'
  | 'configMerged'
  | 'classicLayoutChoice'
  | 'classicLayoutLegacy'
  | 'classicLayoutDocs'
  | 'classicLayoutChoiceRequired'
  | 'cancelled'
  | 'installMode'
  | 'installModeCopy'
  | 'installModeSymlink'
  | 'symlinkCreated'
  | 'symlinkFailed'
  | 'updateScope'
  | 'uninstallScope'
  | 'allIndexedProjects'
  | 'currentProjectOnly'
  | 'uninstallTitle'
  | 'selectPlatformsToUninstall'
  | 'uninstallSelectedPlatforms'
  | 'uninstallNoneSelected'
  | 'uninstallPlatformsRequired'
  | 'noInstalledPlatformsSelected'
  | 'selectWorkflowsToUninstall'
  | 'nativeWorkflow'
  | 'classicWorkflow'
  | 'removeClassicCompanionSkills'
  | 'openSpecSkills'
  | 'superpowersSkills'
  | 'foundCometInstallations'
  | 'foundIndexedProjectCleanup'
  | 'globalScope'
  | 'projectScope'
  | 'pathLabel'
  | 'openSpecSkillsRemoved'
  | 'superpowersSkillsRemoved'
  | 'targetCleanupFailed'
  | 'projectInstructionsRemoved'
  | 'workingDirectoriesRemoved'
  | 'workingDirectoriesPreserved'
  | 'workingDirectoriesPreservedReason'
  | 'workingDirectoriesPreservedImpact'
  | 'workingDirectoriesCleanupFailed'
  | 'workingDirectoriesFailureReason'
  | 'projectConfigCleanupFailed'
  | 'uninstallAllProjectsPrompt'
  | 'uninstallAllProjectsYes'
  | 'uninstallAllProjectsNo'
  | 'uninstalledIndexedProjects'
  | 'noCometInstallationsFound'
  | 'summaryTargets'
  | 'summarySkillsRemoved'
  | 'summaryRules'
  | 'summaryHooks'
  | 'targetAssetsRemoved'
  | 'cleanupFailures'
  | 'uninstallIncomplete'
  | 'uninstallComplete';

const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = {
  en: {
    settingUp: 'Setting up Comet in',
    installScope: 'Install scope:',
    scopeProject: 'Project (current directory)',
    scopeGlobal: 'Global (home directory)',
    languagePrompt: 'Language for Comet skills:',
    selectPlatforms: 'Select platforms to set up:',
    selectedPlatforms: 'Selected:',
    noneSelected: 'none',
    selectPlatformsRequired: 'Select at least one platform.',
    detected: 'detected',
    noPlatforms: 'No platforms selected. Exiting.',
    overwriteChoice: 'What to do?',
    overwrite: 'Overwrite',
    skip: 'Skip',
    bulkOverwrite: 'already has',
    overwriteAll: 'Overwrite all existing components',
    skipAll: 'Skip all existing components',
    choosePer: 'Choose per component',
    installingOS: 'Installing OpenSpec for:',
    osSkippedNoCli: 'OpenSpec CLI not installed, skipping OpenSpec setup',
    allSkipped: 'all skipped',
    installingSP: 'Installing Superpowers for:',
    spSkippedByUser: 'Superpowers install skipped by user',
    alreadyExists: 'already exists',
    rulesInstalled: 'rule(s) installed',
    hooksInstalled: 'phase guard hook installed',
    hooksSkipped: 'skipped',
    installCodegraph: 'Install CodeGraph for semantic code intelligence?',
    codegraphYes: 'Yes (recommended — saves ~16% cost · cuts ~58% tool calls)',
    codegraphNo: 'No',
    installingCG: 'Installing CodeGraph...',
    cgSkippedByUser: 'CodeGraph install skipped by user',
    setupComplete: 'Comet setup complete!',
    installed: 'Installed:',
    skippedLabel: 'Skipped:',
    failedLabel: 'Failed:',
    failedStatus: 'failed',
    workingDirs: 'Working directories:',
    nativeWorkingDir: 'Native:',
    classicWorkingDirs: 'Classic: docs/superpowers/specs/, docs/superpowers/plans/',
    getStarted: 'Get started:',
    getStartedComet: '/comet "your idea"  — Start a new change with full workflow',
    getStartedHotfix: '/comet-hotfix       — Quick bug fix (skip brainstorming)',
    getStartedTweak: '/comet-tweak        — Small change (skip brainstorming and plan)',
    selectNpmDeps: 'Select npm dependencies to install/upgrade:',
    npmDepOpenSpec: 'OpenSpec CLI (global, @fission-ai/openspec@latest)',
    npmDepOpenSpecInstalled: 'OpenSpec CLI (already installed globally — upgrade to latest)',
    npmDepOpenSpecRequired: 'Classic setup requires a compatible OpenSpec CLI.',
    npmDepSuperpowers: 'Superpowers (npx skills add obra/superpowers)',
    npmDepSuperpowersInstalled: 'Superpowers (already installed — re-run install)',
    npmDepSuperpowersHint: 'v6.0.0+ recommended — ~2× faster, ~50% fewer tokens',
    npmDepCodegraph: 'CodeGraph CLI (@colbymchenry/codegraph)',
    npmDepCodegraphInstalled: 'CodeGraph CLI (already installed — upgrade to latest)',
    npmDepNotInstalled: 'not installed',
    updateTitle: 'Comet Update',
    updatingNpmPackage: 'Updating npm package',
    npmLaunchFailed: 'npm package: failed to launch npm',
    npmUpdateFailed: 'npm package: update failed (exit code',
    npmNetworkHint: 'Check your network connection or firewall settings and try again.',
    npmPackageUpdated: 'npm package: updated to latest',
    npmPackageFailed: 'npm package: update failed, continuing with bundled skills',
    npmPackageFailedBlocking: 'npm package: update failed',
    noInstallsFound: 'No platforms with comet skills installed. Run `comet init` first.',
    updatingSkillsOnTargets: 'Updating comet skills on',
    copyingSkillsFiles: 'Copying',
    skillsCopiedSkipped: 'copied,',
    rulesUpdated: 'rule(s) updated',
    rulesFailed: 'failed',
    hooksUpdated: 'phase guard hook updated',
    hooksFailed: 'failed',
    summary: 'Summary:',
    summaryNpm: 'npm:',
    summarySkills: 'skills:',
    summaryCodegraph: 'codegraph:',
    summaryScope: 'scope:',
    summaryLanguage: 'language:',
    updateComplete: 'Update complete.',
    updateAllProjectsPrompt: 'Proceed with updating all indexed projects?',
    updateAllProjectsYes: 'Yes, update all indexed projects',
    updateAllProjectsNo: 'No, cancel',
    configMerged:
      'Project config merged (.comet/config.yaml): preserved your values, added any missing fields',
    classicLayoutChoice:
      'Both Classic roots exist. Choose the root Comet should record for this project:',
    classicLayoutLegacy: 'Legacy layout — openspec/',
    classicLayoutDocs: 'Docs layout — docs/openspec/',
    classicLayoutChoiceRequired:
      'Both Classic roots exist. Run `comet update` interactively, or pass --classic-layout legacy|docs.',
    cancelled: 'Cancelled.',
    installMode: 'Installation mode:',
    installModeCopy: 'Copy (traditional, independent copies per platform)',
    installModeSymlink: 'Symlink (shared central store, saves space)',
    symlinkCreated: 'symlink created',
    symlinkFailed: 'symlink creation failed',
    updateScope: 'Update scope:',
    uninstallScope: 'Uninstall scope:',
    allIndexedProjects: 'All indexed projects',
    currentProjectOnly: 'Current project only',
    uninstallTitle: 'Comet Uninstall',
    selectPlatformsToUninstall: 'Select platforms to uninstall:',
    uninstallSelectedPlatforms: 'Selected platforms:',
    uninstallNoneSelected: 'None',
    uninstallPlatformsRequired: 'Select at least one platform.',
    noInstalledPlatformsSelected: 'No installed platforms selected. Cancelled.',
    selectWorkflowsToUninstall: 'Select workflows to uninstall:',
    nativeWorkflow: 'Native workflow',
    classicWorkflow: 'Classic workflow',
    removeClassicCompanionSkills: 'Also remove Classic companion Skills?',
    openSpecSkills: 'OpenSpec Skills',
    superpowersSkills: 'Superpowers Skills',
    foundCometInstallations: 'Found Comet installations on the following targets:',
    foundIndexedProjectCleanup: 'Found an indexed project with follow-on cleanup still pending.',
    globalScope: 'global',
    projectScope: 'project',
    pathLabel: 'Path:',
    openSpecSkillsRemoved: 'OpenSpec Skills removed',
    superpowersSkillsRemoved:
      'Superpowers companion Skills ({platforms}; {scope}): {count} removed',
    targetCleanupFailed: 'cleanup failed; uninstall incomplete and follow-on cleanup skipped',
    projectInstructionsRemoved: 'Project instructions removed: {count}',
    workingDirectoriesRemoved: 'Working directories: {count} removed',
    workingDirectoriesPreserved: 'Working directories: existing content preserved:',
    workingDirectoriesPreservedReason:
      'Reason: Comet does not manage the listed content, so it was left unchanged.',
    workingDirectoriesPreservedImpact:
      'Impact: Comet was uninstalled successfully; the preserved content remains unchanged.',
    workingDirectoriesCleanupFailed: 'Working directories: cleanup failed ({count})',
    workingDirectoriesFailureReason: 'Reason:',
    projectConfigCleanupFailed:
      'Project config: cleanup failed; selected workflow remains configured',
    uninstallAllProjectsPrompt: 'Proceed with uninstalling all indexed projects?',
    uninstallAllProjectsYes: 'Yes, uninstall all indexed projects',
    uninstallAllProjectsNo: 'No, cancel',
    uninstalledIndexedProjects: 'Uninstalled indexed projects:',
    noCometInstallationsFound: 'No Comet installations found. Nothing to uninstall.',
    summaryTargets: 'Targets:',
    summarySkillsRemoved: 'Skills removed:',
    summaryRules: 'Rules removed:',
    summaryHooks: 'Hooks removed:',
    targetAssetsRemoved: '{skills} skills, {rules} rules, {hooks} hooks removed',
    cleanupFailures: 'Cleanup failures:',
    uninstallIncomplete: 'Uninstall incomplete. Preserved remaining project state.',
    uninstallComplete: 'Uninstall complete.',
  },
  zh: {
    settingUp: '正在设置 Comet：',
    installScope: '安装范围：',
    scopeProject: '项目（当前目录）',
    scopeGlobal: '全局（主目录）',
    languagePrompt: 'Comet 技能语言：',
    selectPlatforms: '选择要配置的平台：',
    selectedPlatforms: '已选择：',
    noneSelected: '无',
    selectPlatformsRequired: '请至少选择一个平台。',
    detected: '已检测到',
    noPlatforms: '未选择任何平台，退出。',
    overwriteChoice: '如何处理？',
    overwrite: '覆盖',
    skip: '跳过',
    bulkOverwrite: '已安装',
    overwriteAll: '覆盖所有已有组件',
    skipAll: '跳过所有已有组件',
    choosePer: '逐个选择',
    installingOS: '正在安装 OpenSpec：',
    osSkippedNoCli: '未安装 OpenSpec CLI，跳过 OpenSpec 配置',
    allSkipped: '全部跳过',
    installingSP: '正在安装 Superpowers：',
    spSkippedByUser: '用户跳过 Superpowers 安装',
    alreadyExists: '已存在',
    rulesInstalled: '个规则已安装',
    hooksInstalled: 'Phase guard hook 已安装',
    hooksSkipped: '已跳过',
    installCodegraph: '是否安装 CodeGraph（语义代码智能）？',
    codegraphYes: '是（推荐 — 节省约 16% 成本，减少约 58% 工具调用）',
    codegraphNo: '否',
    installingCG: '正在安装 CodeGraph...',
    cgSkippedByUser: '用户跳过 CodeGraph 安装',
    setupComplete: 'Comet 设置完成！',
    installed: '已安装：',
    skippedLabel: '已跳过：',
    failedLabel: '失败：',
    failedStatus: '失败',
    workingDirs: '工作目录：',
    nativeWorkingDir: 'Native：',
    classicWorkingDirs: 'Classic：docs/superpowers/specs/, docs/superpowers/plans/',
    getStarted: '开始使用：',
    getStartedComet: '/comet "你的想法"  — 启动完整工作流',
    getStartedHotfix: '/comet-hotfix       — 快速修复（跳过 brainstorming）',
    getStartedTweak: '/comet-tweak        — 小改动（跳过 brainstorming 和完整 plan）',
    selectNpmDeps: '选择要安装/升级的 npm 依赖：',
    npmDepOpenSpec: 'OpenSpec CLI（全局安装，@fission-ai/openspec@latest）',
    npmDepOpenSpecInstalled: 'OpenSpec CLI（已全局安装 — 升级到最新版本）',
    npmDepOpenSpecRequired: 'Classic 初始化需要兼容版本的 OpenSpec CLI。',
    npmDepSuperpowers: 'Superpowers (npx skills add obra/superpowers)',
    npmDepSuperpowersInstalled: 'Superpowers（已安装 — 重新运行安装）',
    npmDepSuperpowersHint: '推荐 v6.0.0+ — 速度快约 2 倍，节省约 50% token',
    npmDepCodegraph: 'CodeGraph CLI (@colbymchenry/codegraph)',
    npmDepCodegraphInstalled: 'CodeGraph CLI（已安装 — 升级到最新版本）',
    npmDepNotInstalled: '未安装',
    updateTitle: 'Comet 更新',
    updatingNpmPackage: '正在更新 npm 包',
    npmLaunchFailed: 'npm 包：启动 npm 失败',
    npmUpdateFailed: 'npm 包：更新失败（退出码',
    npmNetworkHint: '请检查网络连接或防火墙设置后重试。',
    npmPackageUpdated: 'npm 包：已更新到最新版本',
    npmPackageFailed: 'npm 包：更新失败，继续使用已打包的 skills',
    npmPackageFailedBlocking: 'npm 包：更新失败',
    noInstallsFound: '未检测到已安装 comet skills 的平台。请先运行 `comet init`。',
    updatingSkillsOnTargets: '正在更新 comet skills，覆盖',
    copyingSkillsFiles: '正在复制',
    skillsCopiedSkipped: '已复制，',
    rulesUpdated: '个规则已更新',
    rulesFailed: '失败',
    hooksUpdated: 'Phase guard hook 已更新',
    hooksFailed: '失败',
    summary: '摘要：',
    summaryNpm: 'npm：',
    summarySkills: 'skills：',
    summaryCodegraph: 'codegraph：',
    summaryScope: '范围：',
    summaryLanguage: '语言：',
    updateComplete: '更新完成。',
    updateAllProjectsPrompt: '继续更新所有已索引项目？',
    updateAllProjectsYes: '是，更新所有已索引项目',
    updateAllProjectsNo: '否，取消',
    configMerged: '项目配置已合并 (.comet/config.yaml)：已保留你的设置，补齐缺失字段',
    classicLayoutChoice: '检测到两个 Classic 产物根目录。请选择要写入项目配置的根目录：',
    classicLayoutLegacy: '旧布局 — openspec/',
    classicLayoutDocs: '文档布局 — docs/openspec/',
    classicLayoutChoiceRequired:
      '检测到两个 Classic 产物根目录。请交互式运行 `comet update`，或传入 --classic-layout legacy|docs。',
    cancelled: '已取消。',
    installMode: '安装模式：',
    installModeCopy: 'Copy（传统方式，每个平台独立副本）',
    installModeSymlink: 'Symlink（共享中央存储，节省空间）',
    symlinkCreated: 'Symlink 已创建',
    symlinkFailed: 'Symlink 创建失败',
    updateScope: '更新范围：',
    uninstallScope: '卸载范围：',
    allIndexedProjects: '所有已索引项目',
    currentProjectOnly: '仅当前项目',
    uninstallTitle: 'Comet 卸载',
    selectPlatformsToUninstall: '选择要卸载的平台：',
    uninstallSelectedPlatforms: '已选择的平台：',
    uninstallNoneSelected: '无',
    uninstallPlatformsRequired: '请至少选择一个平台。',
    noInstalledPlatformsSelected: '未选择已安装的平台，已取消。',
    selectWorkflowsToUninstall: '选择要卸载的工作流：',
    nativeWorkflow: 'Native 工作流',
    classicWorkflow: 'Classic 工作流',
    removeClassicCompanionSkills: '同时移除 Classic 配套 Skills？',
    openSpecSkills: 'OpenSpec Skills',
    superpowersSkills: 'Superpowers Skills',
    foundCometInstallations: '检测到以下平台已安装 Comet：',
    foundIndexedProjectCleanup: '检测到已索引项目仍有后续清理待处理。',
    globalScope: '全局',
    projectScope: '项目',
    pathLabel: '路径：',
    openSpecSkillsRemoved: '个 OpenSpec Skills 已移除',
    superpowersSkillsRemoved: '已移除 Superpowers 配套 Skills（{platforms}；{scope}）：{count} 个',
    targetCleanupFailed: '清理失败；卸载未完成，已跳过后续清理',
    projectInstructionsRemoved: '已移除项目说明：{count}',
    workingDirectoriesRemoved: '工作目录：已移除 {count} 个',
    workingDirectoriesPreserved: '工作目录：已保留已有内容：',
    workingDirectoriesPreservedReason: '原因：这些内容不由 Comet 管理，因此未删除。',
    workingDirectoriesPreservedImpact: '影响：不影响 Comet 卸载完成，保留内容未被修改。',
    workingDirectoriesCleanupFailed: '工作目录：清理失败（{count}）',
    workingDirectoriesFailureReason: '原因：',
    projectConfigCleanupFailed: '项目配置清理失败；所选工作流仍保留在配置中',
    uninstallAllProjectsPrompt: '继续卸载所有已索引项目？',
    uninstallAllProjectsYes: '是，卸载所有已索引项目',
    uninstallAllProjectsNo: '否，取消',
    uninstalledIndexedProjects: '已卸载的已索引项目：',
    noCometInstallationsFound: '未找到 Comet 安装项，无需卸载。',
    summaryTargets: '目标：',
    summarySkillsRemoved: '已移除 Skills：',
    summaryRules: '已移除 Rules：',
    summaryHooks: '已移除 Hooks：',
    targetAssetsRemoved: '已移除 {skills} 个 Skills、{rules} 个 Rules、{hooks} 个 Hooks',
    cleanupFailures: '清理失败：',
    uninstallIncomplete: '卸载未完成，已保留剩余项目状态。',
    uninstallComplete: '卸载完成。',
  },
};

function normalizeLanguage(lang: string | undefined): Language {
  return lang === 'zh' ? 'zh' : 'en';
}

export function t(lang: string | undefined, key: TranslationKey): string {
  const language = normalizeLanguage(lang);
  return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key];
}
