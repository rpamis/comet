import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: execute }),
}));

import {
  FORMAL_CASE_IDS,
  FORMAL_LEDGER_REF,
  formalCaseSpec,
  prepareSdkFormalCase,
} from '../helpers/sdk-formal-case.mjs';

describe('formal12 preparation without model execution', () => {
  it('loads the actual ESM entry with Node without Vitest transformation', () => {
    const helper = path.resolve('test/helpers/sdk-formal-case.mjs');
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const module=await import(process.argv[1]);console.log(JSON.stringify({cases:module.FORMAL_CASE_IDS.length,prepare:typeof module.prepareSdkFormalCase}));',
        pathToFileURL(helper).href,
      ],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(output)).toEqual({ cases: 12, prepare: 'function' });
  });
  let root: string;
  let consumerRoot: string;
  let fixtureRoot: string;
  let evidenceRoot: string;
  const provenance = { candidateCommit: 'b'.repeat(40), tarballHash: 'c'.repeat(64) };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-formal-prepare-'));
    consumerRoot = path.join(root, 'consumer');
    fixtureRoot = path.join(root, 'fixture');
    evidenceRoot = path.join(root, 'evidence');
    const pkgRoot = path.join(consumerRoot, 'node_modules', '@rpamis', 'comet');
    await fs.mkdir(path.join(pkgRoot, 'dist'), { recursive: true });
    await fs.mkdir(path.join(pkgRoot, 'bin'));
    await fs.writeFile(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@rpamis/comet', version: '0.4.5', bin: { comet: 'bin/comet.js' } }),
    );
    await fs.writeFile(
      path.join(pkgRoot, 'bin', 'comet.js'),
      '// Mock consumer CLI, never executed.\n',
    );
    for (const skill of [
      'comet-any',
      'comet',
      'comet-native',
      'comet-classic',
      'comet-open',
      'comet-design',
      'comet-build',
      'comet-verify',
      'comet-archive',
      'comet-hotfix',
      'comet-tweak',
    ]) {
      const destination = path.join(pkgRoot, 'assets', 'skills-zh', skill);
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'SKILL.md'), `# ${skill}\n冻结中文内容\n`);
    }
    const yamlRoot = path.join(consumerRoot, 'node_modules', 'yaml');
    await fs.mkdir(yamlRoot, { recursive: true });
    await fs.writeFile(path.join(yamlRoot, 'package.json'), '{"name":"yaml","main":"index.cjs"}');
    await fs.writeFile(
      path.join(yamlRoot, 'index.cjs'),
      'exports.parse=JSON.parse; exports.stringify=value=>JSON.stringify(value,null,2);',
    );
    const originalRead = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation((file, ...args) => {
      if (file === FORMAL_LEDGER_REF)
        return Promise.resolve(
          JSON.stringify({
            cases: FORMAL_CASE_IDS.map((caseId) => ({ caseId, status: 'pending', stages: [] })),
          }),
        ) as never;
      return originalRead(file, ...(args as [never])) as never;
    });
    execute.mockImplementation(async (command, args, options) => {
      if (command === 'git')
        return { stdout: args.includes('rev-parse') ? 'a'.repeat(40) + '\n' : '', stderr: '' };
      expect(command).toBe(process.execPath);
      expect(args[1]).toBe('init');
      expect(options.windowsHide).toBe(true);
      if (args.includes('--help'))
        return {
          stdout: '--platform --scope --language --workflow --codegraph --json',
          stderr: '',
        };
      const project = args[2];
      await fs.mkdir(path.join(project, '.claude'), { recursive: true });
      await fs.mkdir(path.join(project, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(project, '.gitignore'),
        '# Public init managed state\n!/.comet/config.yaml\n',
      );
      await fs.writeFile(
        path.join(project, '.claude', 'settings.local.json'),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Write|Edit',
                hooks: [{ type: 'command', command: 'node comet-hook-router.mjs' }],
              },
            ],
          },
        }),
      );
      await fs.writeFile(
        path.join(project, '.comet', 'config.yaml'),
        JSON.stringify({
          default_workflow: 'native',
          workflows: ['native'],
          native: { artifact_root: 'docs' },
        }),
      );
      return {
        stdout: JSON.stringify({
          status: 'complete',
          results: [{ openspec: 'skipped', superpowers: 'skipped', codegraph: 'skipped' }],
        }),
        stderr: '',
      };
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('maps exactly six flows twice and keeps host, cold recovery, work and approval requirements explicit', () => {
    expect(FORMAL_CASE_IDS).toHaveLength(12);
    expect(new Set(FORMAL_CASE_IDS).size).toBe(12);
    for (const id of FORMAL_CASE_IDS) {
      const spec = formalCaseSpec(id);
      expect(spec.goal).toBeTruthy();
      expect(spec.stages.join('\n')).toContain('confirm-plan');
      expect(spec.acceptance.join('\n')).toContain('2.1.251');
      expect(spec.acceptance.join('\n')).toContain('glm-5.3[1M]');
      expect(spec.acceptance.join('\n')).toContain('handoff');
      expect(spec.acceptance.join('\n')).toContain('冷恢复');
      expect(spec.acceptance.join('\n')).toContain('Root');
    }
    expect(() => formalCaseSpec('standalone-3')).toThrow('formal12');
  });

  it('prepares a fresh Native fixture using only public safe init and local baseline Git commands', async () => {
    const manifest = await prepareSdkFormalCase({
      ...provenance,
      consumerRoot,
      fixtureRoot,
      evidenceRoot,
      caseId: 'native-supervisor-2',
      goal: '用户给出的候选审查目标',
    });
    expect(manifest.status).toBe('prepared-not-executed');
    expect(manifest.candidateCommit).toBe(provenance.candidateCommit);
    expect(manifest.consumer.tarballHash).toBe(provenance.tarballHash);
    expect(manifest.ledgerRef).toMatchObject({
      caseId: 'native-supervisor-2',
      readOnly: true,
      historicalEvidenceAppliesToCurrentCandidate: false,
    });
    expect(manifest.goal).toBe('用户给出的候选审查目标');
    expect(manifest.decisions.supplied).toEqual([]);
    expect(manifest.host.observed).toBeNull();
    expect(manifest.initialization.git).toMatchObject({
      branch: 'main',
      baseline: 'a'.repeat(40),
      pushAllowed: false,
    });
    expect(manifest.consumer.packageFiles['bin/comet.js']).toMatch(/^[a-f0-9]{64}$/u);
    expect(await fs.readFile(path.join(fixtureRoot, 'candidate.txt'), 'utf8')).toBe('pending\n');
    const commands = execute.mock.calls;
    expect(commands.filter(([command]) => command === process.execPath)).toHaveLength(2);
    expect(commands.every(([command]) => command === process.execPath || command === 'git')).toBe(
      true,
    );
    expect(commands[1][1]).toEqual(
      expect.arrayContaining(['--workflow', 'native', '--codegraph', 'skip', '--json']),
    );
    expect(commands[1][2].env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(commands[1][2].env).not.toHaveProperty('OPENAI_API_KEY');
    expect(commands[1][2].env.USERPROFILE).toBe(path.join(fixtureRoot, '.isolated-home'));
    const prompt = await fs.readFile(manifest.paths.prompt, 'utf8');
    expect(prompt).toContain('用户给出的候选审查目标');
    expect(prompt).toContain('禁止自己选择 approved');
    await expect(fs.access(path.join(fixtureRoot, '.comet', 'runtime'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    // 这里只运行 fixture 的真实只读审查脚本，不调用模型或生成业务 Outcome。
    const review = path.join(
      fixtureRoot,
      '.claude',
      'skills',
      'formal-candidate-review',
      'scripts',
      'review.mjs',
    );
    expect(() =>
      execFileSync(process.execPath, [review, fixtureRoot], { stdio: 'pipe' }),
    ).toThrow();
    await fs.writeFile(path.join(fixtureRoot, 'candidate.txt'), 'approved\n');
    expect(
      JSON.parse(execFileSync(process.execPath, [review, fixtureRoot], { encoding: 'utf8' })),
    ).toMatchObject({ accepted: true });
  });

  it('enables the supported Classic fixture configuration and copies its own Comet entries without Classic init', async () => {
    const manifest = await prepareSdkFormalCase({
      ...provenance,
      consumerRoot,
      fixtureRoot,
      evidenceRoot,
      caseId: 'classic-hotfix-1',
    });
    expect(manifest.initialization.skillIds).toContain('comet-hotfix');
    expect(manifest.initialization.classicInit).toContain('未执行 Classic init');
    const config = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, '.comet', 'config.yaml'), 'utf8'),
    );
    expect(config).toMatchObject({
      workflows: ['native', 'classic'],
      default_workflow: 'classic',
      classic: { artifact_layout: 'docs' },
    });
    expect(
      execute.mock.calls
        .filter(([, args]) => args.includes('--workflow'))
        .every(([, args]) => args[args.indexOf('--workflow') + 1] === 'native'),
    ).toBe(true);
    expect(manifest.acceptance.join('\n')).toContain('hotfix');
  });

  it('prepares standalone source and reusable external recovery interface without starting its service or a model', async () => {
    const manifest = await prepareSdkFormalCase({
      ...provenance,
      consumerRoot,
      fixtureRoot,
      evidenceRoot,
      caseId: 'standalone-2',
    });
    expect(await fs.readFile(path.join(fixtureRoot, 'source.md'), 'utf8')).toContain('3 项工作');
    expect(manifest.externalFixture.faults).toEqual(['drop-after', 'drop-before']);
    expect(manifest.externalFixture.expectedExecutionCount).toBe(1);
    expect(await fs.readFile(manifest.paths.externalHelper, 'utf8')).toContain('127.0.0.1');
    expect(
      execute.mock.calls.some(([, args]) => args.includes(manifest.paths.externalHelper)),
    ).toBe(false);
    const review = path.join(
      fixtureRoot,
      '.claude',
      'skills',
      'formal-report-review',
      'scripts',
      'review.mjs',
    );
    await fs.writeFile(path.join(fixtureRoot, 'report.md'), '本周完成 3 项工作。\n');
    expect(() =>
      execFileSync(process.execPath, [review, fixtureRoot], { stdio: 'pipe' }),
    ).toThrow();
    await fs.writeFile(
      path.join(fixtureRoot, 'report.md'),
      '本周完成 3 项工作，发现 1 项待处理问题。\n',
    );
    expect(
      JSON.parse(execFileSync(process.execPath, [review, fixtureRoot], { encoding: 'utf8' })),
    ).toMatchObject({ accepted: true });
  });

  it('refuses an existing fixture and rejects credential-shaped input before running any preparation command', async () => {
    await fs.mkdir(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, 'user.txt'), '保留旧现场');
    await expect(
      prepareSdkFormalCase({
        ...provenance,
        consumerRoot,
        fixtureRoot,
        evidenceRoot,
        caseId: 'standalone-1',
      }),
    ).rejects.toThrow('拒绝重复');
    expect(await fs.readFile(path.join(fixtureRoot, 'user.txt'), 'utf8')).toBe('保留旧现场');
    await expect(
      prepareSdkFormalCase({
        consumerRoot,
        fixtureRoot,
        evidenceRoot,
        caseId: 'standalone-1',
        credential: 'do-not-read',
      }),
    ).rejects.toThrow('不得向此接口传入凭据');
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires frozen candidate and tarball provenance before reading or executing a consumer', async () => {
    await expect(
      prepareSdkFormalCase({ consumerRoot, fixtureRoot, evidenceRoot, caseId: 'native-normal-1' }),
    ).rejects.toThrow('tarballHash');
    await expect(
      prepareSdkFormalCase({
        consumerRoot,
        fixtureRoot,
        evidenceRoot,
        caseId: 'native-normal-1',
        tarballHash: 'c'.repeat(64),
      }),
    ).rejects.toThrow('candidateCommit');
    expect(execute).not.toHaveBeenCalled();
    await expect(fs.access(fixtureRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
