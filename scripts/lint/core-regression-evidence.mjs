import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCoreRegressionResult,
  coreRegressionArgs,
  CORE_REGRESSIONS,
} from './core-regressions.mjs';

const WINDOWS_GROUP = 'registered-classic-short-timeout-supervisor-startup';
const INPUT_ROOTS = [
  'app',
  'domains',
  'platform',
  'assets',
  'bin',
  'dist',
  'scripts',
  'config',
  'test',
  'eval/scaffold',
  'eval/local/tasks',
  'eval/local/treatments',
  'eval/local/skills',
  'eval/local/scripts',
  'eval/local/tests',
];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(sortObject(value));
async function assertNewEvidenceFile(file) {
  try {
    await fs.lstat(file);
    throw new Error(`Core regression evidence already exists: ${file}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  return value;
}

export function createCoreRegressionExecutionPlan(entries, options = {}) {
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    entries.some((entry) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(entry.id ?? ''))
  )
    throw new Error('Core regression execution plan must contain unique complete groups');
  if (
    options.singlePlatform !== undefined &&
    !['win32', 'linux', 'darwin'].includes(options.singlePlatform)
  )
    throw new Error('Invalid single-platform core execution plan');
  const groups = entries.map((entry) => ({
    id: entry.id,
    platform: options.singlePlatform ?? (entry.id === WINDOWS_GROUP ? 'win32' : 'linux'),
  }));
  return {
    schema: 'comet.core-regression-plan.v1',
    ...(options.singlePlatform ? { singlePlatform: options.singlePlatform } : {}),
    planHash: sha256(canonical({ entries, groups })),
    groups,
  };
}

/** 读取产品、测试及运行器的实际内容；失败或变化时不复用以前的身份。 */
export async function coreRegressionCandidateIdentity(projectRoot) {
  const root = path.resolve(projectRoot);
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const revision = git('rev-parse', 'HEAD');
  const assertClean = () => {
    if (git('status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=dirty'))
      throw new Error(
        'Core regression candidate has dirty or untracked inputs; commit the reviewed candidate first',
      );
  };
  assertClean();
  const files = [];
  const directories = new Set();
  const gitlinks = [];
  const visit = async (relative) => {
    const skillPath = relative.startsWith('eval/local/skills/');
    if (skillPath && /\/\.comet\/eval(?:\/|$)/u.test(relative)) return;
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Linked core regression input: ${relative}`);
    if (stat.isDirectory()) {
      // 只忽略生成输出的容器目录；其中其他正式配置和文件仍正常读取。
      if (!(skillPath && relative.endsWith('/.comet'))) directories.add(relative);
      for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
        if (
          ['node_modules', '.git', '__pycache__'].includes(entry.name) ||
          /\.py[co]$/u.test(entry.name)
        )
          continue;
        await visit(path.posix.join(relative, entry.name));
      }
    } else if (stat.isFile()) files.push(relative);
    else throw new Error(`Unreadable core regression input: ${relative}`);
  };
  const collect = async () => {
    files.length = 0;
    gitlinks.length = 0;
    directories.clear();
    for (const relative of INPUT_ROOTS) {
      try {
        await fs.lstat(path.join(root, relative));
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      await visit(relative);
    }
    for (const entry of await fs.readdir(root))
      if (
        /^(?:tsconfig.*\.json|vitest.*config\.[cm]?[jt]s|package(?:-lock)?\.json|pnpm-lock\.yaml|build\.js|\.npmignore|\.gitattributes)$/u.test(
          entry,
        )
      )
        await visit(entry);
    for (const relative of ['eval/pyproject.toml', 'eval/uv.lock']) {
      try {
        await fs.lstat(path.join(root, relative));
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      await visit(relative);
    }
    const tracked = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const item of tracked.split('\0').filter(Boolean)) {
      const separator = item.indexOf('\t');
      const metadata = /^([0-9]{6}) ([a-f0-9]+) 0$/u.exec(item.slice(0, separator));
      const relative = item.slice(separator + 1);
      if (
        !metadata ||
        separator < 0 ||
        path.isAbsolute(relative) ||
        relative.split('/').includes('..')
      )
        throw new Error('Invalid tracked core regression input');
      if (metadata[1] === '160000') gitlinks.push({ path: relative, object: metadata[2] });
      else files.push(relative);
    }
    const observedFiles = [];
    for (const relative of [...new Set(files)].sort()) {
      const stat = await fs.lstat(path.join(root, relative));
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Unstable core regression input: ${relative}`);
      observedFiles.push({
        path: relative,
        size: stat.size,
        modified: stat.mtimeMs,
        inode: stat.ino,
        mode: stat.mode,
      });
    }
    return canonical({ files: observedFiles, directories: [...directories].sort(), gitlinks });
  };
  const observation = await collect();
  const input = createHash('sha256');
  for (const relative of [...new Set(files)].sort()) {
    const absolute = path.join(root, relative);
    const before = await fs.lstat(absolute);
    if (!before.isFile() || before.isSymbolicLink())
      throw new Error(`Unstable core regression input: ${relative}`);
    const content = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) content.update(chunk);
    const after = await fs.lstat(absolute);
    if (
      !after.isFile() ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    )
      throw new Error(`Unstable core regression input: ${relative}`);
    input.update(`${relative}\0${before.size}\0${content.digest('hex')}\n`);
  }
  input.update(canonical(gitlinks));
  input.update(canonical([...directories].sort()));
  if ((await collect()) !== observation)
    throw new Error('Core regression inputs changed during observation');
  assertClean();
  if (git('rev-parse', 'HEAD') !== revision)
    throw new Error('Core regression candidate changed during observation');
  return { revision, inputHash: input.digest('hex'), inputFileCount: new Set(files).size };
}

/** 两个平台保留完整原报告；只在校验时按各自根目录解释绝对路径。 */
export function assertCoreRegressionEvidence(entries, identity, records, options = {}) {
  if (
    !identity ||
    !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(identity.revision ?? '') ||
    !/^[a-f0-9]{64}$/u.test(identity.inputHash ?? '') ||
    !Number.isInteger(identity.inputFileCount) ||
    identity.inputFileCount <= 0
  )
    throw new Error('Invalid core regression candidate identity');
  const plan = createCoreRegressionExecutionPlan(entries, options);
  const platforms = [...new Set(plan.groups.map((group) => group.platform))].sort();
  if (
    !Array.isArray(records) ||
    records.length !== platforms.length ||
    new Set(records.map((record) => record?.platform)).size !== records.length
  )
    throw new Error('Missing or duplicate core regression platform evidence');
  let tests = 0;
  for (const record of records) {
    if (
      record?.schema !== 'comet.core-regression-platform.v1' ||
      !platforms.includes(record.platform) ||
      record.planHash !== plan.planHash ||
      canonical(record.identity) !== canonical(identity)
    )
      throw new Error('Stale or mismatched core regression platform evidence');
    const api = record.platform === 'win32' ? path.win32 : path.posix;
    if (typeof record.projectRoot !== 'string' || !api.isAbsolute(record.projectRoot))
      throw new Error('Platform evidence requires its original absolute project root');
    const expected = plan.groups.filter((group) => group.platform === record.platform);
    if (
      !Array.isArray(record.groups) ||
      record.groups.length !== expected.length ||
      new Set(record.groups.map((group) => group.id)).size !== record.groups.length
    )
      throw new Error('Incomplete platform regression groups');
    for (const group of record.groups) {
      const entry = entries.find((item) => item.id === group.id);
      if (
        !entry ||
        !expected.some((item) => item.id === group.id) ||
        group.exitCode !== 0 ||
        typeof group.reportFile !== 'string' ||
        !api.isAbsolute(group.reportFile)
      )
        throw new Error('Missing, failed or misplaced core regression group');
      if (
        !Array.isArray(group.command) ||
        group.command.length < 3 ||
        !api.isAbsolute(group.command[0]) ||
        !api.isAbsolute(group.command[1]) ||
        api.basename(group.command[1]) !== 'vitest.mjs' ||
        canonical(group.command.slice(2)) !== canonical(coreRegressionArgs(entry, group.reportFile))
      )
        throw new Error('Core regression command does not match the complete group');
      if (typeof group.reportText !== 'string' || group.reportHash !== sha256(group.reportText))
        throw new Error('Core regression original report digest mismatch');
      tests += assertCoreRegressionResult(entry, JSON.parse(group.reportText), {
        platform: record.platform,
        projectRoot: record.projectRoot,
      });
    }
  }
  return {
    schema: 'comet.core-regression-evidence.v1',
    identity,
    executionPlan: plan,
    planHash: plan.planHash,
    groups: entries.length,
    tests,
    evidenceHash: sha256(
      canonical([...records].sort((left, right) => left.platform.localeCompare(right.platform))),
    ),
  };
}

/** 只能记录本进程实际执行的整组；失败或输入变化时不产生完成记录。 */
export async function recordCoreRegressionPlatform(projectRoot, entries, outputFile, options = {}) {
  const root = path.resolve(projectRoot);
  const output = path.resolve(outputFile);
  const plan = createCoreRegressionExecutionPlan(
    entries,
    options.singlePlatform ? { singlePlatform: process.platform } : {},
  );
  const selected = plan.groups.filter((group) => group.platform === process.platform);
  if (!selected.length) throw new Error(`No core regression partition for ${process.platform}`);
  await assertNewEvidenceFile(output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const reports = `${output}.reports`;
  await fs.mkdir(reports);
  const identity = await coreRegressionCandidateIdentity(root);
  const require = createRequire(path.join(root, 'package.json'));
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const groups = [];
  for (const selectedGroup of selected) {
    const entry = entries.find((item) => item.id === selectedGroup.id);
    const reportFile = path.join(reports, `${entry.id}.json`);
    const command = [process.execPath, vitest, ...coreRegressionArgs(entry, reportFile)];
    console.log(`${entry.id}: ${entry.invariant ?? entry.id}`);
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => {
        const name = key.toUpperCase();
        return (
          !/^(?:ANTHROPIC_|OPENAI_|BENCH_JUDGE_)/u.test(name) &&
          !['BENCH_API_KEY', 'BENCH_AUTH_TOKEN'].includes(name)
        );
      }),
    );
    environment.PYTHON_DOTENV_DISABLED = '1';
    const result = spawnSync(command[0], command.slice(1), {
      cwd: root,
      stdio: 'inherit',
      env: environment,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${entry.id}: command failed (${result.signal ?? result.status})`);
    const raw = await fs.readFile(reportFile);
    const reportText = raw.toString('utf8');
    if (!raw.equals(Buffer.from(reportText)))
      throw new Error(`${entry.id}: report is not valid UTF-8`);
    assertCoreRegressionResult(entry, JSON.parse(reportText), {
      platform: process.platform,
      projectRoot: root,
    });
    groups.push({
      id: entry.id,
      command,
      exitCode: result.status,
      reportFile,
      reportText,
      reportHash: sha256(raw),
    });
  }
  if (canonical(identity) !== canonical(await coreRegressionCandidateIdentity(root)))
    throw new Error('Core regression inputs changed during platform execution');
  const record = {
    schema: 'comet.core-regression-platform.v1',
    identity,
    planHash: plan.planHash,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    projectRoot: root,
    groups,
  };
  await fs.writeFile(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}

async function persistCoreRegressionReceipt(
  output,
  entries,
  identity,
  records,
  executor,
  options = {},
) {
  const proof = assertCoreRegressionEvidence(entries, identity, records, options);
  const recordsFile = `${output}.records.json`;
  const recordText = JSON.stringify(records);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(recordsFile, recordText, { flag: 'wx' });
  const receipt = {
    ...proof,
    recordsFile: path.basename(recordsFile),
    recordsHash: sha256(recordText),
    executor,
    executorHash: sha256(canonical(executor)),
  };
  await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

/** 单平台仍执行全部组，任何必需案例被跳过都会由原校验器拒绝。 */
export async function runSinglePlatformCoreRegressions(projectRoot, entries, outputFile) {
  const output = path.resolve(outputFile);
  await assertNewEvidenceFile(output);
  await assertNewEvidenceFile(`${output}.records.json`);
  const record = await recordCoreRegressionPlatform(
    projectRoot,
    entries,
    `${output}.platform.json`,
    { singlePlatform: true },
  );
  return persistCoreRegressionReceipt(
    output,
    entries,
    record.identity,
    [record],
    { platform: process.platform, nodeVersion: process.version },
    { singlePlatform: process.platform },
  );
}

/** 汇总固定 CI 工作流实际执行的两个平台分区；不改写报告或补充通过项。 */
export async function combineCoreRegressionPlatforms(
  projectRoot,
  entries,
  platformFiles,
  outputFile,
) {
  const output = path.resolve(outputFile);
  await assertNewEvidenceFile(output);
  await assertNewEvidenceFile(`${output}.records.json`);
  const identity = await coreRegressionCandidateIdentity(projectRoot);
  const records = [];
  for (const file of platformFiles) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('CI platform evidence must be an original regular file');
    records.push(JSON.parse(await fs.readFile(file, 'utf8')));
  }
  assertCoreRegressionEvidence(entries, identity, records);
  if (canonical(identity) !== canonical(await coreRegressionCandidateIdentity(projectRoot)))
    throw new Error('Candidate changed while combining CI platform records');
  return persistCoreRegressionReceipt(output, entries, identity, records, {
    platform: process.platform,
    nodeVersion: process.version,
    platformFiles: platformFiles.map((file) => path.resolve(file)),
  });
}

/** 只复核可信运行器已生成的原记录；摘要校验本身不认证任意上传记录的执行来源。 */
export async function verifyCoreRegressionReceipt(projectRoot, entries, file) {
  const output = path.resolve(file);
  const read = async (target) => {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Linked or missing core regression evidence');
    return fs.readFile(target, 'utf8');
  };
  const receipt = JSON.parse(await read(output));
  const name = receipt.recordsFile;
  if (
    typeof name !== 'string' ||
    !name.endsWith('.records.json') ||
    path.posix.basename(name) !== name ||
    path.win32.basename(name) !== name
  )
    throw new Error('Core regression report reference must remain beside its receipt');
  const text = await read(path.join(path.dirname(output), name));
  if (
    sha256(text) !== receipt.recordsHash ||
    sha256(canonical(receipt.executor)) !== receipt.executorHash
  )
    throw new Error('Core regression receipt or original records changed');
  const identity = await coreRegressionCandidateIdentity(projectRoot);
  const proof = assertCoreRegressionEvidence(entries, identity, JSON.parse(text), {
    singlePlatform: receipt.executionPlan?.singlePlatform,
  });
  for (const [key, value] of Object.entries(proof))
    if (canonical(receipt[key]) !== canonical(value))
      throw new Error(`Core regression receipt differs from original evidence: ${key}`);
  return receipt;
}

/** 在 Windows 亲自执行两个平台；Linux 只读绑定同一候选，不能导入自填的执行记录。 */
export async function runCrossPlatformCoreRegressions(projectRoot, entries, options) {
  const root = path.resolve(projectRoot);
  const codeRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  if (normalize(root) !== normalize(codeRoot) || canonical(entries) !== canonical(CORE_REGRESSIONS))
    throw new Error('The coordinator must execute the complete plan from the same candidate');
  if (process.platform !== 'win32')
    throw new Error(
      'Cross-platform local core regressions require Windows with a prepared Linux Docker runner',
    );
  const output = path.resolve(options.outputFile);
  const relativeOutput = path.relative(path.join(root, 'coverage'), output);
  if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput))
    throw new Error(
      'Cross-platform evidence must be written inside this candidate coverage directory',
    );
  await assertNewEvidenceFile(output);
  await assertNewEvidenceFile(`${output}.records.json`);
  for (const directory of [options.linuxNodeModules, options.linuxVenv])
    if (
      typeof directory !== 'string' ||
      !path.isAbsolute(directory) ||
      !(await fs.stat(directory)).isDirectory()
    )
      throw new Error(
        'Prepare the locked Linux Node dependencies and Python virtual environment first',
      );
  if (typeof options.linuxImage !== 'string' || !options.linuxImage)
    throw new Error('Select a prepared Linux Docker image with Node, pnpm, Python, uv and Git');
  const image = execFileSync(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', options.linuxImage],
    { encoding: 'utf8' },
  ).trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(image))
    throw new Error('Docker did not resolve an immutable runner image');
  const identity = await coreRegressionCandidateIdentity(root);
  const directory = path.join(root, 'coverage', 'core-platform', randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const windowsFile = path.join(directory, 'win32.json');
  const linuxFile = path.join(directory, 'linux.json');
  const linuxOutput = '/repo/' + path.relative(root, linuxFile).replaceAll('\\', '/');
  const mount = (source, target, mode) => [
    '-v',
    `${path.resolve(source).replaceAll('\\', '/')}:${target}:${mode}`,
  ];
  const docker = [
    'run',
    '--rm',
    '--user',
    '0:0',
    '--label',
    'comet.validation=core-regressions',
    ...mount(root, '/repo', 'ro'),
    ...mount(options.linuxNodeModules, '/repo/node_modules', 'rw'),
    ...mount(options.linuxVenv, '/repo/eval/.venv', 'rw'),
    ...mount(path.join(root, 'coverage'), '/repo/coverage', 'rw'),
    '-e',
    'PATH=/repo/node_modules/.cache/python-tools/bin:/usr/local/bin:/usr/bin:/bin',
    '-e',
    'COREPACK_ENABLE_NETWORK=0',
    '-e',
    'UV_PYTHON_DOWNLOADS=never',
    '-e',
    'PYTHON_DOTENV_DISABLED=1',
    '-e',
    'GIT_OPTIONAL_LOCKS=0',
    '-e',
    'GIT_CONFIG_COUNT=2',
    '-e',
    'GIT_CONFIG_KEY_0=safe.directory',
    '-e',
    'GIT_CONFIG_VALUE_0=/repo',
    '-e',
    'GIT_CONFIG_KEY_1=core.fsmonitor',
    '-e',
    'GIT_CONFIG_VALUE_1=false',
    '-w',
    '/repo',
    '--entrypoint',
    'node',
    image,
  ];
  const probe = spawnSync(
    'docker',
    [
      ...docker,
      '-e',
      'const{spawnSync}=require("node:child_process");for(const tool of["pnpm","python3","uv","git"]){const r=spawnSync(tool,["--version"],{stdio:"inherit"});if(r.error||r.status!==0)process.exit(1)}require("node:fs").accessSync("/repo/eval/.venv/bin/python");',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (probe.error || probe.status !== 0)
    throw new Error('Linux core runner is not ready; no platform regression has started');
  const windows = await recordCoreRegressionPlatform(root, entries, windowsFile);
  const linuxCommand = [
    ...docker,
    'scripts/lint/core-regressions.mjs',
    '--record-platform',
    linuxOutput,
  ];
  const linuxExecution = spawnSync('docker', linuxCommand, { cwd: root, stdio: 'inherit' });
  if (linuxExecution.error) throw linuxExecution.error;
  if (linuxExecution.status !== 0)
    throw new Error(
      `Linux core regression execution failed (${linuxExecution.signal ?? linuxExecution.status})`,
    );
  const linux = JSON.parse(await fs.readFile(linuxFile, 'utf8'));
  if (canonical(identity) !== canonical(await coreRegressionCandidateIdentity(root)))
    throw new Error('Candidate changed during cross-platform core regressions');
  const records = [windows, linux];
  return persistCoreRegressionReceipt(output, entries, identity, records, {
    platform: process.platform,
    linuxImage: image,
    linuxCommand,
  });
}
