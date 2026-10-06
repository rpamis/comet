import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import os from 'node:os';
import process from 'node:process';
import { console } from 'node:console';
import { pathToFileURL, fileURLToPath } from 'node:url';

const executeFile = promisify(execFile);
const helperRoot = path.dirname(fileURLToPath(import.meta.url));
export const FORMAL_LEDGER_REF = path.join(
  os.tmpdir(),
  'comet-supervisor-sdk-20261005',
  'formal-eval-ledger.json',
);
export const FORMAL_CASE_IDS = [
  'native-normal',
  'native-supervisor',
  'classic-full',
  'classic-hotfix',
  'classic-tweak',
  'standalone',
].flatMap((flow) => [1, 2].map((repeat) => `${flow}-${repeat}`));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function formalCaseSpec(caseId, goal) {
  if (!FORMAL_CASE_IDS.includes(caseId)) throw new Error('caseId 必须属于冻结的 formal12 矩阵');
  const flow = caseId.replace(/-[12]$/u, '');
  const base = flow.startsWith('native')
    ? 'native'
    : flow.startsWith('classic')
      ? 'classic'
      : 'standalone';
  const defaultGoal =
    base === 'standalone'
      ? '创作每周报告流程：读取真实来源，生成报告草稿，实际审查内容，用户批准当前报告后本地发布；报告缺陷要回原流程修复，中断后冷恢复原 Run，并核对隔离外部操作的未知结果。'
      : `创作${flow === 'native-supervisor' ? ' Native Supervisor 父子协作' : base === 'native' ? ' Native 普通' : ` Classic ${flow.slice(8)}`}流程：保留原领域授权、工件和验收，追加读取 candidate.txt 实际内容的审查；pending 候选必须失败并修复为 approved，实际重新审查，再在新进程恢复原 Run。`;
  const domainAcceptance =
    base === 'native'
      ? [
          '真实 Native Shape、Build、独立 Verify 与修复轨迹；不能用编译通过替代 Native 验收。',
          'candidate.txt 初始 pending 被真实审查拒绝，修复到 approved 后同一候选重新审查成功。',
          ...(flow === 'native-supervisor'
            ? [
                '真实父 Run、child 工作、隔离工作区、child 验收与 integration；父流程仍须独立完成全部验收。',
              ]
            : ['普通 Native 的原领域推进与授权保持有效。']),
        ]
      : base === 'classic'
        ? [
            `真实 Classic ${flow.slice(8)} 领域流程及对应工件、授权和验证；不把 full/hotfix/tweak 变成同一个流程。`,
            'candidate.txt 实际读取结果参与新增 review，失败后走原领域修复并重新验证。',
            '替换执行 Skills，保留原 Classic checkpoint 和 SDK Run 推进权威；不得加载 Superpowers。',
          ]
        : [
            '报告读取真实 source.md，草稿内容必须含来源中的实际事实；真实内容审查能拒绝缺陷并要求原流程修复。',
            '只有 Root 确认当前报告 proposalHash 后才允许本地发布；本地发布读取经审查的实际文件。',
            '隔离服务 drop-after 查询原 Outcome 后回传；drop-before 提供 not-executed 证据后 retry；实际操作计数均为 1。',
          ];
  return {
    caseId,
    flow,
    base,
    goal: goal ?? defaultGoal,
    stages: [
      'Creator 启动和实际 Skill 调查',
      '模型回传真实 analyze 结果与具体方案',
      'Root 当前 confirm-plan 决定',
      'SDK 编译与实际加载验证',
      'Root 当前 confirm-install 决定及完整安装',
      '实际业务 Skill work、所需 handoff 和宿主 Hook',
      '失败及原领域修复',
      'Root 新进程冷恢复同一 Creator/业务 Run',
      '最终业务验收和证据核对',
    ],
    acceptance: [
      'Claude Code 实际版本 2.1.251；主 Agent 和全部实际子 Agent 的模型均为 glm-5.3[1M]，以宿主轨迹核对，未核对视为未完成。',
      '使用冻结 npm consumer 的公开 CLI、SDK 与已确认中文 comet-any；模型真实读取并加载所需 Skills。',
      'Creator 从 start 到 analyze、confirm-plan、compile、verify、preview、confirm-install、install 全链真实完成；fixture 不预写 outcome、批准或成功 Run。',
      '所有用户决定来自 Root 对当前 Wait/proposalHash 的明确决定；陈旧摘要、目标或依赖漂移不得沿用批准。',
      'installed application、固定依赖、宿主入口及业务 SDK Run 可实际执行；安装预览或编译通过不算业务完成。',
      'SDK Run 保存推进权威；实际 Skill 调用与至少一次独立工作单元的真实子 Agent handoff 有可复查宿主轨迹，不以自报调用记录替代。',
      '从真实 Claude PreToolUse Hook 记录核对一次合法写入和一次真实拒绝；不得手填 Hook 收据或把直接调用 Router 当成宿主 Hook。',
      '冷恢复使用新的宿主进程、相同原 Run ID、持久化当前 Action/attempt/inputHash/claim；不得另启 Run 绕过未知结果。',
      '所有动作只在本 fixture 和 evidence 内执行，不真实发信、部署、外部发布、GitHub 写入或加载 Superpowers。',
      '凭据只由 Root 当前进程注入；不得读取、输出或持久化到 fixture、包、Run、Agent 配置和报告。',
      ...domainAcceptance,
      '验收项逐项附实际证据路径；阻塞、未执行、失败和超时保持原状态，不能报告为 passed。',
    ],
  };
}

function safePreparationEnvironment(home) {
  const environment = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TMP', 'TEMP'])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    CODEX_HOME: path.join(home, '.codex'),
  };
}

async function absent(directory) {
  try {
    await fs.lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`fixture 已存在，拒绝重复准备或覆盖：${directory}`);
}
async function snapshot(directory) {
  const files = {};
  async function visit(root, relative = '') {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`冻结 Skill 不允许符号链接：${name}`);
      if (entry.isDirectory()) await visit(path.join(root, entry.name), name);
      else if (entry.isFile()) files[name] = sha256(await fs.readFile(path.join(root, entry.name)));
    }
  }
  await visit(directory);
  return files;
}

function initialPrompt(manifest) {
  return (
    `用户目标：${manifest.goal}\n\n` +
    `本次案例 ${manifest.caseId}，工作目录 ${manifest.paths.projectRoot}，证据目录 ${manifest.paths.evidenceRoot}。公开 CLI 为 node "${manifest.consumer.cli}"；包解析来自冻结 consumer 的 node_modules，不得修改冻结包。\n` +
    '立即读取并加载 .claude/skills/comet-any/SKILL.md，依据实际 Skill 和公开 SDK 调查、提出并完成具体方案。读取安装入口需要的 Native 或 Classic 领域 Skill；不得加载 Superpowers。不能用 fixture 预置 schema 或成功字符串冒充 Creator 分析和真实 work。\n' +
    'Creator 的名字采用本次 caseId；每个业务 Run 的名称由实际生成应用确定并记录，后续冷恢复保留原名称。先真实执行 creator guide/start/analyze。确认方案和安装时展示当前步骤、产物、固定依赖、失败路径、proposalHash 和预览文件，等待 Root 的当前决定。禁止自己选择 approved。\n' +
    '实际业务执行必须通过生成应用的 SDK Action/Wait；按当前 claim 身份加载 Skill、完成真实 work，必要时交接给相同模型的子 Agent，并保留宿主轨迹。candidate.txt 初始缺陷或报告缺陷需要真实失败、修复、复验。\n' +
    '只在 fixture 及 Runtime 指定的隔离子工作树内操作；允许必要的本地候选 commit，禁止 push、GitHub 写入、真实仓库提交、发信、部署、联网发布或修改真实 HOME。凭据只接受 Root 的当前进程注入，禁止打印环境、读取凭据文件或把凭据放进方案/模块/Run/报告。\n' +
    '需要用户决定或未知能力时保留现场并报告，Root 将提供当前 hash 的决定或冷恢复指令；新的宿主进程不能重新创建已存在的 Creator/业务 Run。\n\n' +
    `全部验收条件：\n${manifest.acceptance.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\n` +
    `隔离服务接口：${manifest.paths.externalHelper}；只可连接 127.0.0.1。Root 独立调度服务并注入 endpoint/认证环境；服务未提供时明确阻塞，不能改成真实外部服务。详见 ${manifest.paths.manifest} externalFixture。\n`
  );
}

/** 只准备新目录和公开 init；不调用模型、不提交用户决定、不写 Creator/业务 Run。 */
export async function prepareSdkFormalCase(options) {
  const allowedInputs = [
    'consumerRoot',
    'caseId',
    'fixtureRoot',
    'evidenceRoot',
    'goal',
    'tarballHash',
    'candidateCommit',
  ];
  if (!options || Object.keys(options).some((key) => !allowedInputs.includes(key)))
    throw new Error('准备输入含未声明字段；不得向此接口传入凭据');
  if (options.goal !== undefined && (typeof options.goal !== 'string' || !options.goal.trim()))
    throw new Error('goal 必须是用户的非空目标');
  if (!/^[a-f0-9]{64}$/u.test(options.tarballHash ?? ''))
    throw new Error('tarballHash 必须是 Root 冻结包的 64 位 SHA-256');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(options.candidateCommit ?? ''))
    throw new Error('candidateCommit 必须是 Root 冻结候选的完整 commit 身份');
  const spec = formalCaseSpec(options.caseId, options.goal);
  for (const field of ['consumerRoot', 'fixtureRoot', 'evidenceRoot'])
    if (typeof options[field] !== 'string' || !path.isAbsolute(options[field]))
      throw new Error(`${field} 必须是显式绝对路径`);
  const consumerRoot = await fs.realpath(options.consumerRoot);
  const projectRoot = path.resolve(options.fixtureRoot);
  const evidenceRoot = path.resolve(options.evidenceRoot);
  for (const target of [projectRoot, evidenceRoot]) {
    const relative = path.relative(consumerRoot, target);
    if (
      !relative ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw new Error('fixture/evidence 不能位于冻结 consumer 内');
    await absent(target);
  }
  if (projectRoot === evidenceRoot) throw new Error('fixture 与证据目录必须分开');
  const ledgerSource = await fs.readFile(FORMAL_LEDGER_REF, 'utf8');
  const ledger = JSON.parse(ledgerSource);
  const ledgerCase = ledger.cases?.find((item) => item.caseId === spec.caseId);
  if (!ledgerCase) throw new Error('原 formal12 账本缺少本次 caseId；不创建替代账本');
  const packageRoot = await fs.realpath(
    path.join(consumerRoot, 'node_modules', '@rpamis', 'comet'),
  );
  const packageRelative = path.relative(consumerRoot, packageRoot);
  if (
    !packageRelative ||
    packageRelative === '..' ||
    packageRelative.startsWith('..' + path.sep) ||
    path.isAbsolute(packageRelative)
  )
    throw new Error('冻结 npm 包不能链接到 consumer 外的源码目录');
  const packageJson = await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(packageJson);
  if (pkg.name !== '@rpamis/comet') throw new Error('consumer 不包含冻结 Comet npm 包');
  const cli = path.join(packageRoot, pkg.bin?.comet ?? 'bin/comet.js');
  const chineseSkillRoot = path.join(packageRoot, 'assets', 'skills-zh', 'comet-any');
  const chineseFiles = await snapshot(chineseSkillRoot);
  const packageFiles = { 'package.json': sha256(packageJson) };
  for (const directory of ['dist', 'bin', 'assets']) {
    for (const [file, digest] of Object.entries(await snapshot(path.join(packageRoot, directory))))
      packageFiles[`${directory}/${file}`] = digest;
  }
  const environment = safePreparationEnvironment(path.join(projectRoot, '.isolated-home'));
  const help = await executeFile(process.execPath, [cli, 'init', '--help'], {
    cwd: consumerRoot,
    env: environment,
    timeout: 30000,
    windowsHide: true,
  });
  for (const flag of ['--platform', '--scope', '--language', '--workflow', '--codegraph', '--json'])
    if (!help.stdout.includes(flag)) throw new Error(`冻结 init 缺少安全初始化参数：${flag}`);
  await fs.mkdir(projectRoot, { recursive: false });
  await fs.mkdir(evidenceRoot, { recursive: false });
  await fs.mkdir(path.join(projectRoot, '.isolated-home'), { recursive: true });
  const initArgs = [
    cli,
    'init',
    projectRoot,
    '--platform',
    'claude',
    '--scope',
    'project',
    '--language',
    'zh',
    '--workflow',
    'native',
    '--codegraph',
    'skip',
    '--json',
  ];
  const initialized = await executeFile(process.execPath, initArgs, {
    cwd: projectRoot,
    env: environment,
    timeout: 90000,
    windowsHide: true,
  });
  await fs.writeFile(path.join(evidenceRoot, 'init-help.txt'), help.stdout, { flag: 'wx' });
  await fs.writeFile(
    path.join(evidenceRoot, 'init-output.txt'),
    initialized.stdout + initialized.stderr,
    { flag: 'wx' },
  );
  const initResult = JSON.parse(initialized.stdout);
  if (initResult.status !== 'complete' && initResult.status !== 'completed')
    throw new Error('公开 init 未报告完整安装；保留现场供 Root 核对');
  if (
    initResult.results?.some(
      (result) =>
        result.openspec !== 'skipped' ||
        result.superpowers !== 'skipped' ||
        result.codegraph !== 'skipped',
    )
  )
    throw new Error('本机 fixture 初始化包含非预期第三方操作；保留现场供 Root 核对');
  if (spec.base === 'classic') {
    const yaml = createRequire(path.join(packageRoot, 'package.json'))('yaml');
    const configFile = path.join(projectRoot, '.comet', 'config.yaml');
    const config = yaml.parse(await fs.readFile(configFile, 'utf8'));
    config.workflows = ['native', 'classic'];
    config.default_workflow = 'classic';
    config.classic = {
      artifact_layout: 'docs',
      language: 'zh-CN',
      context_compression: 'off',
      review_mode: 'standard',
      auto_transition: true,
    };
    await fs.writeFile(configFile, yaml.stringify(config));
  }
  const skillIds = [
    'comet-any',
    'comet',
    ...(spec.base === 'classic'
      ? [
          'comet-classic',
          'comet-open',
          'comet-design',
          'comet-build',
          'comet-verify',
          'comet-archive',
          'comet-hotfix',
          'comet-tweak',
        ]
      : ['comet-native']),
  ];
  const skillSnapshots = {};
  for (const id of skillIds) {
    const source = path.join(packageRoot, 'assets', 'skills-zh', id);
    const destination = path.join(projectRoot, '.claude', 'skills', id);
    await fs.cp(source, destination, { recursive: true });
    const scripts = path.join(packageRoot, 'assets', 'skills', id, 'scripts');
    try {
      await fs.access(scripts);
      await fs.cp(scripts, path.join(destination, 'scripts'), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    skillSnapshots[id] = await snapshot(destination);
  }
  if (
    JSON.stringify(await snapshot(path.join(projectRoot, '.claude', 'skills', 'comet-any'))) !==
    JSON.stringify(chineseFiles)
  )
    throw new Error('comet-any 中文 Skill 与冻结源不一致');
  const settingsFile = path.join(projectRoot, '.claude', 'settings.json');
  const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  if (!JSON.stringify(settings.hooks?.PreToolUse).includes('comet-hook-router.mjs'))
    throw new Error('公开 init 没有安装真实 Claude PreToolUse Router Hook');
  await fs.symlink(
    path.join(consumerRoot, 'node_modules'),
    path.join(projectRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: `formal-${spec.caseId}`, private: true, type: 'module' }, null, 2) +
      '\n',
    { flag: 'wx' },
  );
  if (spec.base === 'standalone')
    await fs.writeFile(
      path.join(projectRoot, 'source.md'),
      '# 每周来源\n\n本周完成 3 项工作，发现 1 项待处理问题，下周先修复该问题。\n',
      { flag: 'wx' },
    );
  else await fs.writeFile(path.join(projectRoot, 'candidate.txt'), 'pending\n', { flag: 'wx' });
  const reviewSkill =
    spec.base === 'standalone' ? 'formal-report-review' : 'formal-candidate-review';
  const reviewRoot = path.join(projectRoot, '.claude', 'skills', reviewSkill);
  await fs.mkdir(path.join(reviewRoot, 'scripts'), { recursive: true });
  await fs.writeFile(
    path.join(reviewRoot, 'SKILL.md'),
    `---\nname: ${reviewSkill}\ndescription: '只读审查本 fixture 的实际${spec.base === 'standalone' ? '报告与来源' : 'candidate.txt'}内容；供 SDK 绑定和独立子 Agent 调用。'\n---\n\n加载后读取 scripts/review.mjs，并以项目目录为参数实际执行。只能读取本次 fixture；不写文件、不批准方案、不发布、不操作外部服务。输入是项目目录${spec.base === 'standalone' ? '和项目内报告相对路径' : ''}，输出 accepted、reason 和文件摘要；accepted 为 false 时必须沿原领域恢复流程修复实际内容并重新审查，退出码非零不算通过。SDK Run 与用户决定保持原权威，审查结果不能替代完整独立验收。\n`,
    { flag: 'wx' },
  );
  const reviewCode =
    spec.base === 'standalone'
      ? `const relative = process.argv[3] ?? 'report.md';\nconst reportFile = path.resolve(root, relative);\nconst within = path.relative(root, reportFile);\nif (!within || within === '..' || within.startsWith('..'+path.sep) || path.isAbsolute(within)) throw new Error('报告路径必须在 fixture 内');\nconst source = await readFile(path.join(root,'source.md'),'utf8');\nconst report = await readFile(reportFile,'utf8');\nconst accepted = ['3 项工作','1 项待处理问题'].every(fact => source.includes(fact) && report.includes(fact));\nconst result = {accepted, reason: accepted ? '报告包含实际来源事实' : '报告缺少实际来源事实', sourceHash: hash(source), reportHash: hash(report)};`
      : `const candidate = await readFile(path.join(root,'candidate.txt'),'utf8');\nconst accepted = candidate.trim() === 'approved';\nconst result = {accepted, reason: accepted ? '实际候选符合已声明内容要求' : '实际候选尚未修复', candidateHash: hash(candidate)};`;
  await fs.writeFile(
    path.join(reviewRoot, 'scripts', 'review.mjs'),
    `import {readFile} from 'node:fs/promises';\nimport path from 'node:path';\nimport {createHash} from 'node:crypto';\nconst root = path.resolve(process.argv[2] ?? '.');\nconst hash = value => createHash('sha256').update(value).digest('hex');\n${reviewCode}\nconsole.log(JSON.stringify(result));\nif (!result.accepted) process.exitCode = 1;\n`,
    { flag: 'wx' },
  );
  skillIds.push(reviewSkill);
  skillSnapshots[reviewSkill] = await snapshot(reviewRoot);
  await fs.writeFile(
    path.join(projectRoot, '.gitignore'),
    'node_modules/\n.isolated-home/\n.claude/\n.comet/\n',
    { flag: 'wx' },
  );
  await fs.mkdir(path.join(projectRoot, '.isolated-home', 'empty-git-hooks'), { recursive: true });
  const gitArgs = [
    '-c',
    'commit.gpgsign=false',
    '-c',
    `core.hooksPath=${path.join(projectRoot, '.isolated-home', 'empty-git-hooks')}`,
    '-C',
    projectRoot,
  ];
  const git = (args) =>
    executeFile('git', [...gitArgs, ...args], {
      cwd: projectRoot,
      env: {
        ...environment,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: path.join(projectRoot, '.isolated-home', 'empty-git-config'),
      },
      timeout: 30000,
      windowsHide: true,
    });
  await git(['init', '--initial-branch=main']);
  await git(['config', '--local', 'user.name', 'Comet Formal Fixture']);
  await git(['config', '--local', 'user.email', 'formal-fixture@example.invalid']);
  await git([
    'add',
    '--',
    '.gitignore',
    'package.json',
    spec.base === 'standalone' ? 'source.md' : 'candidate.txt',
  ]);
  await git(['commit', '-m', 'test: establish isolated formal fixture baseline']);
  const baseline = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const externalHelper = path.join(evidenceRoot, 'isolated-external-service.mjs');
  await fs.copyFile(path.join(helperRoot, 'isolated-external-service.mjs'), externalHelper, 1);
  const manifest = {
    schema: 'comet.formal.case.v1',
    ...spec,
    candidateCommit: options.candidateCommit,
    status: 'prepared-not-executed',
    consumer: {
      root: consumerRoot,
      packageRoot,
      cli,
      version: pkg.version,
      packageJsonHash: sha256(packageJson),
      packageFiles,
      chineseSkillFiles: chineseFiles,
      tarballHash: options.tarballHash,
    },
    paths: {
      projectRoot,
      evidenceRoot,
      settingsFile,
      externalHelper,
      manifest: path.join(evidenceRoot, 'case-manifest.json'),
      prompt: path.join(evidenceRoot, 'model-prompt.md'),
      coldResumePrompt: path.join(evidenceRoot, 'cold-resume-prompt.md'),
    },
    host: {
      requiredVersion: '2.1.251',
      mainModel: 'glm-5.3[1M]',
      subagentModel: 'glm-5.3[1M]',
      observed: null,
      requiredRawAudit:
        'Root 必须核对原始主会话及每个子 Agent 的宿主轨迹、真实模型 ID 和 1M 配置；Agent 自报模型或模型环境变量不足以证明实际执行模型。',
      scheduler: 'Root safe host-process-v2；本 helper 不启动模型',
    },
    initialization: {
      command: [process.execPath, ...initArgs],
      hookBase: 'native',
      businessBase: spec.base,
      skillIds,
      skillSnapshots,
      hookSettingsHash: sha256(await fs.readFile(settingsFile)),
      configFile: path.join(projectRoot, '.comet', 'config.yaml'),
      isolatedHome: path.join(projectRoot, '.isolated-home'),
      prependPath: path.join(consumerRoot, 'node_modules', '.bin'),
      git: {
        branch: 'main',
        baseline,
        sourceFiles: [spec.base === 'standalone' ? 'source.md' : 'candidate.txt'],
        localCandidateCommitsAllowed: true,
        pushAllowed: false,
      },
      classicInit:
        spec.base === 'classic'
          ? '未执行 Classic init；缺少依赖时它会安装 OpenSpec/Superpowers，无独立 skip 参数。已按支持的项目配置结构启用 workflows=[native,classic] 与 Classic docs 工件布局，复制固定 Comet Classic 入口，业务走真实 SDK Classic composition。'
          : null,
    },
    decisions: { authority: 'Root 提供当前 Wait 与 proposalHash 的明确决定', supplied: [] },
    ledgerRef: {
      path: FORMAL_LEDGER_REF,
      caseId: spec.caseId,
      readOnly: true,
      sourceHash: sha256(ledgerSource),
      priorStatus: ledgerCase.status,
      historicalStages: (ledgerCase.stages ?? []).map(
        ({ eventId, stage, status, hostErrorRetained }) => ({
          eventId,
          stage,
          status,
          ...(hostErrorRetained ? { hostErrorRetained } : {}),
        }),
      ),
      historicalEvidenceAppliesToCurrentCandidate: false,
      stageStops: [
        'confirm-plan',
        'confirm-install',
        ...(spec.base === 'standalone'
          ? ['current-report-approval', 'external-unknown']
          : ['failed-candidate-review']),
        'cold-recovery',
      ],
      faults:
        spec.base === 'standalone'
          ? ['invalid-report-content', 'drop-after', 'drop-before']
          : ['candidate.txt starts pending and actual content review must reject it'],
      writer:
        '只有 Root 在真实阶段完成、原始模型/Hook/work 审计和 current-hash 决定核对后更新原 caseId；本 helper 不写账本或通过状态。',
    },
    externalFixture: {
      command: [process.execPath, externalHelper],
      requiredEnvironmentNames: ['COMET_EXTERNAL_FIXTURE_TOKEN'],
      optionalEnvironmentNames: ['COMET_EXTERNAL_FIXTURE_FAULT'],
      faults: ['drop-after', 'drop-before'],
      bind: '127.0.0.1',
      endpoints: {
        execute: 'POST /operations/<encoded actionId>',
        query: 'GET /operations/<encoded actionId>',
        stats: 'GET /stats',
      },
      commandFields: ['actionId', 'attempt', 'inputHash', 'claimToken', 'topic'],
      expectedExecutionCount: 1,
      shutdown: 'Root 结束本机服务进程；不要重启同一服务后把旧操作缺失视为未执行。',
    },
    requiredEvidence: [
      '冻结包及 Skill 字节身份',
      'Creator 与业务原 Run ID/Action 身份',
      '每个阶段的真实 CLI 输出',
      '当前 hash 的 Root 用户决定',
      '实际 Skill/handoff/工具/Hook 宿主轨迹',
      '主子模型与宿主版本',
      '冷恢复前后状态及产物内容',
      '失败、修复与完整独立验收',
      '外部服务原 Outcome/not-executed 证据及计数',
      '凭据未落盘审计',
    ],
    unresolvedRequirements: [
      'Root 尚需实际提供全部当前用户决定、业务冷恢复时机、宿主轨迹及正式主子模型身份。',
      ...(spec.base === 'classic'
        ? [
            'Root 核对按支持结构启用的 Classic 配置及 Router 对该 Classic SDK 应用的真实路由；此准备不构成真实 Classic init 或业务验收证据。',
          ]
        : []),
    ],
  };
  await fs.writeFile(
    path.join(evidenceRoot, 'case-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  await fs.writeFile(manifest.paths.prompt, initialPrompt(manifest), { flag: 'wx' });
  await fs.writeFile(
    manifest.paths.coldResumePrompt,
    `Root 已启动新的真实宿主进程。先读取 ${manifest.paths.manifest}、Root 本次提供的原 Creator/业务 Run ID 与阶段证据，然后查询原 status/next。保留原 Action/attempt/inputHash/claim；未知执行先核对实际文件或同一隔离服务结果。不能新建 Run、重派已执行动作、填入成功 Outcome 或自己批准当前决定。凭据只由本进程注入，不能输出或落盘。继续满足原目标与全部验收条件；能力缺失明确阻塞。\n`,
    { flag: 'wx' },
  );
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      '用法：node sdk-formal-case.mjs <仅含目录/caseId/goal 的 preparation-input.json>',
    );
  const input = JSON.parse(await fs.readFile(file, 'utf8'));
  const allowed = [
    'consumerRoot',
    'caseId',
    'fixtureRoot',
    'evidenceRoot',
    'goal',
    'tarballHash',
    'candidateCommit',
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error('准备输入包含未声明字段；不得传入或持久化凭据');
  const manifest = await prepareSdkFormalCase(input);
  console.log(
    JSON.stringify({ status: manifest.status, caseId: manifest.caseId, paths: manifest.paths }),
  );
}
