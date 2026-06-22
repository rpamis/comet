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
  | 'workingDirs'
  | 'getStarted'
  | 'getStartedComet'
  | 'getStartedHotfix'
  | 'getStartedTweak'
  | 'selectNpmDeps'
  | 'npmDepOpenSpec'
  | 'npmDepOpenSpecInstalled'
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
  | 'cancelled';

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
    workingDirs: 'Working directories: docs/superpowers/specs/, docs/superpowers/plans/',
    getStarted: 'Get started:',
    getStartedComet: '/comet "your idea"  — Start a new change with full workflow',
    getStartedHotfix: '/comet-hotfix       — Quick bug fix (skip brainstorming)',
    getStartedTweak: '/comet-tweak        — Small change (skip brainstorming and plan)',
    selectNpmDeps: 'Select npm dependencies to install/upgrade:',
    npmDepOpenSpec: 'OpenSpec CLI (@fission-ai/openspec@latest)',
    npmDepOpenSpecInstalled: 'OpenSpec CLI (already installed — upgrade to latest)',
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
    cancelled: 'Cancelled.',
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
    hooksInstalled: '阶段守卫钩子已安装',
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
    workingDirs: '工作目录：docs/superpowers/specs/, docs/superpowers/plans/',
    getStarted: '开始使用：',
    getStartedComet: '/comet "你的想法"  — 启动完整工作流',
    getStartedHotfix: '/comet-hotfix       — 快速修复（跳过 brainstorming）',
    getStartedTweak: '/comet-tweak        — 小改动（跳过 brainstorming 和完整 plan）',
    selectNpmDeps: '选择要安装/升级的 npm 依赖：',
    npmDepOpenSpec: 'OpenSpec CLI (@fission-ai/openspec@latest)',
    npmDepOpenSpecInstalled: 'OpenSpec CLI（已安装 — 升级到最新版本）',
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
    noInstallsFound: '未检测到已安装 comet skills 的平台。请先运行 `comet init`。',
    updatingSkillsOnTargets: '正在更新 comet skills，覆盖',
    copyingSkillsFiles: '正在复制',
    skillsCopiedSkipped: '已复制，',
    rulesUpdated: '个规则已更新',
    rulesFailed: '失败',
    hooksUpdated: '阶段守卫钩子已更新',
    hooksFailed: '失败',
    summary: '摘要：',
    summaryNpm: 'npm：',
    summarySkills: 'skills：',
    summaryCodegraph: 'codegraph：',
    summaryScope: '范围：',
    summaryLanguage: '语言：',
    updateComplete: '更新完成。',
    cancelled: '已取消。',
  },
};

function normalizeLanguage(lang: string | undefined): Language {
  return lang === 'zh' ? 'zh' : 'en';
}

export function t(lang: string | undefined, key: TranslationKey): string {
  const language = normalizeLanguage(lang);
  return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key];
}
