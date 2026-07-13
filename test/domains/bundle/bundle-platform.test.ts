import { describe, expect, it } from 'vitest';
import path from 'path';
import { compileBundleForPlatform } from '../../../domains/bundle/platform.js';
import type { BundleCompilerIr } from '../../../domains/bundle/types.js';
import { listBundlePlatformTargets } from '../../../domains/bundle/bundle-platform.js';
import { PLATFORMS } from '../../../platform/install/platforms.js';

const projectRoot = path.resolve('test-project');
const homeDir = path.resolve('test-home');

function ir(overrides: Partial<BundleCompilerIr> = {}): BundleCompilerIr {
  return {
    bundle: {
      name: 'demo-bundle',
      version: '1.0.0',
      locale: 'zh',
      hash: 'a'.repeat(64),
    },
    capabilities: {
      requires: ['skills', 'hooks'],
      optional: ['rules', 'scripts', 'references', 'assets'],
    },
    skills: [
      {
        id: 'demo',
        logicalRoot: 'skills/demo',
        visibility: 'entry',
        sourceRoot: path.resolve('fixtures/skills/demo'),
        files: [
          {
            relativePath: 'SKILL.md',
            source: path.resolve('fixtures/skills/demo/SKILL.md'),
          },
        ],
      },
      {
        id: 'helper',
        logicalRoot: 'skills/helper',
        visibility: 'internal',
        sourceRoot: path.resolve('fixtures/skills/helper'),
        files: [
          {
            relativePath: 'SKILL.md',
            source: path.resolve('fixtures/skills/helper/SKILL.md'),
          },
        ],
      },
    ],
    rules: [
      {
        id: 'workflow',
        path: 'rules/workflow.md',
        mode: 'always',
        required: true,
        source: path.resolve('fixtures/rules/workflow.md'),
      },
    ],
    hooks: [
      {
        id: 'protect-write',
        source: path.resolve('fixtures/hooks/protect-write.yaml'),
        event: 'before_write',
        script: 'verify',
        failure: 'block',
        requiresConfirmation: false,
      },
    ],
    scripts: [
      {
        id: 'verify',
        path: 'scripts/verify.mjs',
        sideEffect: 'read',
        runtime: 'node',
        source: path.resolve('fixtures/scripts/verify.mjs'),
      },
    ],
    references: [
      {
        logicalPath: 'references/state.md',
        source: path.resolve('fixtures/references/state.md'),
      },
    ],
    assets: [
      {
        logicalPath: 'assets/icon.txt',
        source: path.resolve('fixtures/assets/icon.txt'),
      },
    ],
    agents: [],
    overrides: [],
    engine: null,
    ...overrides,
  };
}

describe('Bundle platform compiler', () => {
  const targets = listBundlePlatformTargets({
    projectRoot,
    homeDir,
    scope: 'project',
  });

  it('derives one dry-run target from every registered platform', async () => {
    expect(targets).toHaveLength(PLATFORMS.length);
    expect(targets).toHaveLength(33);

    for (const target of targets) {
      const report = await compileBundleForPlatform(ir(), target, {
        projectRoot,
        scope: 'project',
        locale: 'zh',
      });

      expect(report.platform).toBe(target.id);
      expect(report.files.some((file) => file.kind === 'skill')).toBe(true);
      expect(report.entrySkills).toEqual(['demo']);
      expect(report.unsupported).toEqual(expect.any(Array));
    }
  });

  it('plans native rules and hooks for a capable platform', async () => {
    const claude = targets.find((target) => target.id === 'claude')!;

    const report = await compileBundleForPlatform(ir(), claude, {
      projectRoot,
      scope: 'project',
      locale: 'zh',
    });

    expect(report.files.some((file) => file.kind === 'rule')).toBe(true);
    expect(report.files.some((file) => file.kind === 'hook')).toBe(true);
    expect(report.unsupported).toEqual([]);
    expect(report.executableDisclosures).toEqual([
      expect.objectContaining({
        id: 'protect-write',
        sideEffect: 'read',
        command: expect.stringContaining('verify.mjs'),
        destination: path.join(projectRoot, '.claude', 'settings.local.json'),
      }),
    ]);
  });

  it('plans Codex hooks in .codex/hooks.json while scripts remain under .agents', async () => {
    const codex = targets.find((target) => target.id === 'codex')!;

    const report = await compileBundleForPlatform(ir(), codex, {
      projectRoot,
      scope: 'project',
      locale: 'zh',
    });

    expect(report.executableDisclosures).toEqual([
      expect.objectContaining({
        id: 'protect-write',
        destination: path.join(projectRoot, '.codex', 'hooks.json'),
        command: expect.stringContaining('.agents/skills'),
      }),
    ]);
  });

  it('reports every required and optional capability gap without dropping it silently', async () => {
    const kimi = targets.find((target) => target.id === 'kimicode')!;

    const report = await compileBundleForPlatform(ir(), kimi, {
      projectRoot,
      scope: 'project',
      locale: 'zh',
    });

    expect(report.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'hooks', required: true }),
        expect.objectContaining({ capability: 'rules', required: false }),
      ]),
    );
    expect(report.files.some((file) => file.kind === 'hook')).toBe(false);
    expect(report.files.some((file) => file.kind === 'rule')).toBe(false);
  });

  it('uses an explicit platform override to replace an unsupported hook', async () => {
    const cursor = targets.find((target) => target.id === 'cursor')!;
    const bundleIr = ir({
      overrides: [
        {
          platform: 'cursor',
          replaces: 'hooks.protect-write',
          path: 'overrides/cursor/hooks/protect-write.json',
          source: path.resolve('fixtures/overrides/cursor/hooks/protect-write.json'),
        },
      ],
    });

    const report = await compileBundleForPlatform(bundleIr, cursor, {
      projectRoot,
      scope: 'project',
      locale: 'zh',
    });

    expect(report.unsupported).not.toContainEqual(expect.objectContaining({ capability: 'hooks' }));
    expect(report.files).toContainEqual(
      expect.objectContaining({
        kind: 'hook',
        source: expect.stringContaining('protect-write.json'),
        destination: expect.stringContaining(path.join('.cursor', 'hooks', 'protect-write.json')),
      }),
    );
  });

  it('derives global paths from the same platform registry', () => {
    const globalTargets = listBundlePlatformTargets({
      projectRoot,
      homeDir,
      scope: 'global',
    });
    const opencode = globalTargets.find((target) => target.id === 'opencode')!;

    expect(opencode.layout.skillsRoot).toBe(path.join(homeDir, '.config', 'opencode', 'skills'));
  });

  it('reuses Skill-local script destinations without creating duplicate shared copies', async () => {
    const claude = targets.find((target) => target.id === 'claude')!;
    const bundleIr = ir({
      skills: [
        {
          id: 'demo',
          logicalRoot: 'skills/demo',
          visibility: 'entry',
          sourceRoot: path.resolve('fixtures/skills/demo'),
          files: [
            {
              relativePath: 'SKILL.md',
              source: path.resolve('fixtures/skills/demo/SKILL.md'),
            },
            {
              relativePath: 'scripts/verify.mjs',
              source: path.resolve('fixtures/skills/demo/scripts/verify.mjs'),
            },
          ],
        },
      ],
      scripts: [
        {
          id: 'verify',
          path: 'skills/demo/scripts/verify.mjs',
          sideEffect: 'read',
          runtime: 'node',
          source: path.resolve('fixtures/skills/demo/scripts/verify.mjs'),
        },
      ],
    });

    const report = await compileBundleForPlatform(bundleIr, claude, {
      projectRoot,
      scope: 'project',
      locale: 'zh',
    });

    expect(report.files.filter((file) => file.source.endsWith('verify.mjs'))).toHaveLength(1);
    expect(report.executableDisclosures[0]).toMatchObject({
      id: 'protect-write',
      sideEffect: 'read',
      destination: path.join(projectRoot, '.claude', 'settings.local.json'),
    });
    expect(report.executableDisclosures[0].command.replaceAll('\\', '/')).toContain(
      '.claude/skills/demo/scripts/verify.mjs',
    );
  });

  it('quotes hook commands that reference script paths with spaces', async () => {
    const claude = {
      ...targets.find((target) => target.id === 'claude')!,
      layout: {
        ...targets.find((target) => target.id === 'claude')!.layout,
        baseDir: path.join(projectRoot, 'project with spaces'),
        skillsRoot: path.join(projectRoot, 'project with spaces', '.claude', 'skills'),
        rulesRoot: path.join(projectRoot, 'project with spaces', '.claude', 'rules'),
        scriptsRoot: path.join(
          projectRoot,
          'project with spaces',
          '.claude',
          'skills',
          '.comet-bundles',
        ),
      },
    };
    const bundleIr = ir({
      skills: [
        {
          id: 'demo',
          logicalRoot: 'skills/demo',
          visibility: 'entry',
          sourceRoot: path.resolve('fixtures/skills/demo'),
          files: [
            {
              relativePath: 'SKILL.md',
              source: path.resolve('fixtures/skills/demo/SKILL.md'),
            },
            {
              relativePath: 'scripts/verify with space.mjs',
              source: path.resolve('fixtures/skills/demo/scripts/verify with space.mjs'),
            },
          ],
        },
      ],
      hooks: [
        {
          id: 'protect-write',
          source: path.resolve('fixtures/hooks/protect-write.yaml'),
          event: 'before_write',
          script: 'verify',
          failure: 'block',
          requiresConfirmation: false,
        },
      ],
      scripts: [
        {
          id: 'verify',
          path: 'skills/demo/scripts/verify with space.mjs',
          sideEffect: 'read',
          runtime: 'node',
          source: path.resolve('fixtures/skills/demo/scripts/verify with space.mjs'),
        },
      ],
    });

    const report = await compileBundleForPlatform(bundleIr, claude, {
      projectRoot,
      scope: 'project',
      locale: 'zh',
    });

    expect(report.executableDisclosures[0].command).toMatch(
      /^node "[^"]*verify with space\.mjs"$/u,
    );
  });
});
