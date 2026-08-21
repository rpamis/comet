import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';
import { compileBundleIr } from './compiler.js';
import { loadBundle } from './load.js';
import { compileBundleForPlatform } from './platform.js';
import { listBundlePlatformTargets } from './bundle-platform.js';
import { computeRuleDestPath } from '../skill/platform-install.js';
import { dshInstructionPath } from '../skill/dsh-adapter.js';

interface CurrentManifest {
  version: string;
  skills: string[];
  internalSkills?: string[];
  rules?: string[];
  hooks?: Record<string, { matcher: string; description: string }>;
}

interface BenchmarkCounter {
  passed: number;
  total: number;
}

export interface CometBundleCompatibilityResult {
  platforms: number;
  skillContractRate: number;
  ruleContractRate: number;
  hookContractRate: number;
  referenceContractRate: number;
  pathContractRate: number;
}

function rate(counter: BenchmarkCounter): number {
  return counter.total === 0 ? 1 : counter.passed / counter.total;
}

function record(counter: BenchmarkCounter, passed: boolean): void {
  counter.total++;
  if (passed) counter.passed++;
}

function compareBuffers(left: Buffer, right: Buffer): boolean {
  return left.equals(right);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function topLevelSkillNames(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths.flatMap((relative) => {
        const parts = relative.split('/');
        return parts.length === 2 && parts[1] === 'SKILL.md' ? [parts[0]] : [];
      }),
    ),
  ];
}

function resourceId(relative: string): string {
  return path
    .basename(relative)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-');
}

async function createCurrentCometBundle(repoRoot: string, root: string): Promise<CurrentManifest> {
  const assetsRoot = path.join(repoRoot, 'assets');
  const manifest = JSON.parse(
    await fs.readFile(path.join(assetsRoot, 'manifest.json'), 'utf8'),
  ) as CurrentManifest;
  const managed = [...manifest.skills, ...(manifest.internalSkills ?? [])];
  const entryNames = topLevelSkillNames(manifest.skills);
  const internalNames = topLevelSkillNames(manifest.internalSkills ?? []);
  const skillNames = [...new Set([...entryNames, ...internalNames])];

  for (const name of skillNames) {
    await fs.cp(path.join(assetsRoot, 'skills', name), path.join(root, 'skills', name), {
      recursive: true,
    });
    const localized = path.join(assetsRoot, 'skills-zh', name);
    if (await exists(localized)) {
      await fs.cp(localized, path.join(root, 'locales', 'zh', 'skills', name), {
        recursive: true,
      });
    }
  }

  const scriptPaths = manifest.skills.filter((relative) => relative.includes('/scripts/'));
  const referencePaths = manifest.skills.filter((relative) => relative.includes('/reference/'));
  const rulePaths = manifest.rules ?? [];
  const hookEntries = Object.entries(manifest.hooks ?? {});
  const hookScript = hookEntries[0]?.[0];
  const hookScriptId = hookScript ? resourceId(hookScript) : null;
  if (hookScript && hookScriptId) {
    await fs.mkdir(path.join(root, 'hooks'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'hooks', 'comet-phase-guard.yaml'),
      stringify({
        event: 'before_write',
        matcher: manifest.hooks![hookScript].matcher,
        script: hookScriptId,
        failure: 'block',
        requiresConfirmation: false,
      }),
    );
  }

  const bundleManifest = {
    apiVersion: 'comet/v1alpha1',
    kind: 'SkillBundle',
    metadata: {
      name: 'comet-current',
      version: manifest.version,
      description: 'Current Comet managed asset compatibility fixture',
      defaultLocale: 'en',
      locales: ['en', 'zh'],
    },
    skills: [
      ...entryNames.map((name) => ({
        id: name,
        path: `skills/${name}`,
        visibility: 'entry',
      })),
      ...internalNames.map((name) => ({
        id: name,
        path: `skills/${name}`,
        visibility: 'internal',
      })),
    ],
    resources: {
      rules: rulePaths.map((relative) => ({
        id: resourceId(relative),
        path: `skills/${relative}`,
        mode: 'always',
        required: true,
      })),
      hooks:
        hookScript && hookScriptId
          ? [{ id: 'comet-phase-guard', path: 'hooks/comet-phase-guard.yaml' }]
          : [],
      references: referencePaths.map((relative) => `skills/${relative}`),
      scripts: scriptPaths.map((relative) => ({
        id: resourceId(relative),
        path: `skills/${relative}`,
        sideEffect: 'read',
        runtime: relative.endsWith('.mjs') ? 'node' : 'bash',
      })),
      assets: [],
    },
    platforms: {
      requires: ['skills'],
      optional: ['rules', 'hooks', 'scripts', 'references'],
      overrides: [],
    },
    engine: { enabled: false },
  };
  await fs.writeFile(path.join(root, 'bundle.yaml'), stringify(bundleManifest));
  return { ...manifest, skills: managed };
}

async function sameFile(left: string, right: string): Promise<boolean> {
  return compareBuffers(await fs.readFile(left), await fs.readFile(right));
}

export async function runCometBundleCompatibilityBenchmark(options: {
  repoRoot: string;
}): Promise<CometBundleCompatibilityResult> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bundle-compat-'));
  const bundleRoot = path.join(temporary, 'bundle');
  const targetRoot = path.join(temporary, 'target');
  await fs.mkdir(bundleRoot, { recursive: true });
  try {
    const current = await createCurrentCometBundle(options.repoRoot, bundleRoot);
    const bundle = await loadBundle(bundleRoot);
    const irByLocale = {
      en: await compileBundleIr(bundle, { locale: 'en' }),
      zh: await compileBundleIr(bundle, { locale: 'zh' }),
    };
    const targets = listBundlePlatformTargets({
      projectRoot: targetRoot,
      homeDir: path.join(temporary, 'home'),
      scope: 'project',
    });
    const skill = { passed: 0, total: 0 };
    const rule = { passed: 0, total: 0 };
    const hook = { passed: 0, total: 0 };
    const reference = { passed: 0, total: 0 };
    const paths = { passed: 0, total: 0 };
    const referencePaths = current.skills.filter((relative) => relative.includes('/reference/'));

    for (const target of targets) {
      for (const locale of ['en', 'zh'] as const) {
        const report = await compileBundleForPlatform(irByLocale[locale], target, {
          projectRoot: targetRoot,
          scope: 'project',
          locale,
        });
        const languageDir = locale === 'zh' ? 'skills-zh' : 'skills';
        for (const relative of current.skills) {
          const sourceDir = relative.includes('/scripts/') ? 'skills' : languageDir;
          const expectedSource = path.join(options.repoRoot, 'assets', sourceDir, relative);
          const destination = path.join(target.layout.skillsRoot, ...relative.split('/'));
          const actual = report.files.find(
            (file) => file.kind === 'skill' && path.normalize(file.destination) === destination,
          );
          record(paths, Boolean(actual));
          record(skill, Boolean(actual) && (await sameFile(actual!.source, expectedSource)));
        }
        for (const relative of referencePaths) {
          const expectedSource = path.join(options.repoRoot, 'assets', languageDir, relative);
          const destination = path.join(target.layout.skillsRoot, ...relative.split('/'));
          const actual = report.files.find(
            (file) => file.kind === 'skill' && path.normalize(file.destination) === destination,
          );
          record(reference, Boolean(actual) && (await sameFile(actual!.source, expectedSource)));
        }
      }

      const report = await compileBundleForPlatform(irByLocale.en, target, {
        projectRoot: targetRoot,
        scope: 'project',
        locale: 'en',
      });
      for (const relative of current.rules ?? []) {
        if (target.platform.rulesFormat === 'dsh') {
          const destination = dshInstructionPath(
            target.layout.baseDir,
            target.platform,
            target.layout.scope,
          );
          const actual = report.files.find(
            (file) => file.kind === 'rule' && path.normalize(file.destination) === destination,
          );
          record(
            rule,
            Boolean(actual) &&
              actual!.operation?.type === 'rule' &&
              actual!.operation.format === target.platform.rulesFormat,
          );
        } else if (target.layout.rulesRoot && target.platform.rulesFormat) {
          const destination = computeRuleDestPath(
            target.layout.rulesRoot,
            path.basename(relative),
            target.platform.rulesFormat,
          );
          const actual = report.files.find(
            (file) => file.kind === 'rule' && path.normalize(file.destination) === destination,
          );
          record(
            rule,
            Boolean(actual) &&
              actual!.operation?.type === 'rule' &&
              actual!.operation.format === target.platform.rulesFormat,
          );
        } else {
          record(
            rule,
            report.unsupported.some((item) => item.capability === 'rules') &&
              !report.files.some((file) => file.kind === 'rule'),
          );
        }
      }

      const hookScript = Object.keys(current.hooks ?? {})[0];
      if (hookScript) {
        if (target.layout.hooksSupported) {
          const expectedScript = path
            .relative(
              target.layout.baseDir,
              path.join(target.layout.skillsRoot, ...hookScript.split('/')),
            )
            .replaceAll('\\', '/');
          record(
            hook,
            report.files.some((file) => file.kind === 'hook') &&
              report.executableDisclosures.some((item) =>
                item.command.replaceAll('\\', '/').endsWith(expectedScript),
              ),
          );
        } else {
          record(
            hook,
            report.unsupported.some((item) => item.capability === 'hooks') &&
              !report.files.some((file) => file.kind === 'hook'),
          );
        }
      }
    }

    return {
      platforms: targets.length,
      skillContractRate: rate(skill),
      ruleContractRate: rate(rule),
      hookContractRate: rate(hook),
      referenceContractRate: rate(reference),
      pathContractRate: rate(paths),
    };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
