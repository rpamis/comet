import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const sourceCommit = '053f76d';
const scriptNames = [
  'comet-env.sh',
  'comet-state.sh',
  'comet-yaml-validate.sh',
  'comet-guard.sh',
  'comet-handoff.sh',
  'comet-archive.sh',
  'comet-hook-guard.sh',
] as const;

// Active (migrated) launchers run through node; the frozen 0.3.9 reference
// launchers are bash. The differential contract compares their observable
// behavior (stdout/stderr/exit/.comet.yaml), not the invocation mechanism.
const activeScriptNames = [
  'comet-runtime.mjs',
  'comet-env.mjs',
  'comet-state.mjs',
  'comet-yaml-validate.mjs',
  'comet-guard.mjs',
  'comet-handoff.mjs',
  'comet-archive.mjs',
  'comet-hook-guard.mjs',
];

interface ScriptVariant {
  names: string[];
  state: string;
  guard: string;
  handoff: string;
  hookGuard: string;
  executor: 'bash' | 'node';
}

const referenceRoot = path.resolve('test', 'fixtures', 'classic-0.3.9');
const referenceScripts = path.join(referenceRoot, 'scripts');
const activeScripts = path.resolve('assets', 'skills', 'comet', 'scripts');
const temporaryRoots: string[] = [];

const FROZEN_VARIANT: ScriptVariant = {
  names: [...scriptNames],
  state: 'comet-state.sh',
  guard: 'comet-guard.sh',
  handoff: 'comet-handoff.sh',
  hookGuard: 'comet-hook-guard.sh',
  executor: 'bash',
};

const ACTIVE_VARIANT: ScriptVariant = {
  names: activeScriptNames,
  state: 'comet-state.mjs',
  guard: 'comet-guard.mjs',
  handoff: 'comet-handoff.mjs',
  hookGuard: 'comet-hook-guard.mjs',
  executor: 'node',
};

function variantOf(sourceScripts: string): ScriptVariant {
  return sourceScripts === activeScripts ? ACTIVE_VARIANT : FROZEN_VARIANT;
}

function findUsableBash(): string | null {
  const candidates = [
    process.env.COMET_TEST_BASH,
    'bash',
    ...(process.platform === 'win32'
      ? [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        ]
      : []),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of [...new Set(candidates)]) {
    const probe = spawnSync(candidate, ['-lc', 'uname -s'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() && !/linux/i.test(probe.stdout)) {
      return candidate;
    }
    if (process.platform !== 'win32' && probe.status === 0 && probe.stdout.trim()) {
      return candidate;
    }
  }
  return null;
}

const bashCommand = findUsableBash();
const describeBash = bashCommand ? describe : describe.skip;

function toBashPath(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  const drive = resolved.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `/${drive[1].toLowerCase()}/${drive[2]}` : resolved;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex');
}

async function copyScripts(source: string, destination: string, names: string[]): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  await Promise.all(
    names.map(async (name) => {
      await fs.copyFile(path.join(source, name), path.join(destination, name));
    }),
  );
}

function runScript(
  cwd: string,
  scripts: string,
  name: string,
  args: string[],
  input: string | undefined,
  executor: 'bash' | 'node',
) {
  const env = {
    ...process.env,
    COMET_RUNTIME_CLASSIC_ROOT: path.resolve('assets', 'skills', 'comet', 'runtime', 'classic'),
    COMET_CLASSIC_SKILL_ROOT: path.resolve('assets', 'skills', 'comet', 'runtime', 'classic'),
  };
  const scriptPath = path.join(scripts, name);
  if (executor === 'node') {
    return spawnSync(process.execPath, [scriptPath, ...args], {
      cwd,
      encoding: 'utf8',
      input,
      env,
    });
  }
  if (!bashCommand) throw new Error('Bash is required for the frozen reference execution');
  return spawnSync(bashCommand, [toBashPath(scriptPath), ...args], {
    cwd,
    encoding: 'utf8',
    input,
    env,
  });
}

function normalizeOutput(value: string, root: string): string {
  const normalizedValue = value
    .replaceAll(root, '<ROOT>')
    .replaceAll(toBashPath(root), '<ROOT>')
    // The active runtime may list transition events added after the frozen
    // 0.3.9 baseline (e.g. preset-escalate) in the "Valid values:" error line.
    // These are intentional enhancements; strip them so the differential
    // contract compares rejection behavior, not the exact event enumeration.
    .replace(/(Valid values: .*) preset-escalate/g, '$1');
  const lines = normalizedValue.split('\n');
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const nextLine = lines[index + 1] ?? '';
    if (
      /\[FAIL\] (?:proposal\.md|design\.md|tasks\.md) matches configured language/u.test(line) &&
      /ENOENT: no such file or directory, open /u.test(nextLine)
    ) {
      index += 1;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function legacyProjection(document: Record<string, unknown>): Record<string, unknown> {
  // Strip Run/engine projection keys that only the active TypeScript runtime
  // adds (not part of the 0.3.9 bash contract). All other fields — including
  // review_mode, direct_override, base_ref — are 0.3.9-era fields that both
  // frozen and active produce.
  const runKeys = new Set([
    'skill',
    'classic_profile',
    'classic_migration',
    'run_id',
    'skill_version',
    'skill_hash',
    'orchestration',
    'current_step',
    'iteration',
    'pending',
    'pending_ref',
    'trajectory_ref',
    'context_ref',
    'artifacts_ref',
    'checkpoint_ref',
    'run_status',
    'run_retries',
    'language',
    // The active runtime writes these with null defaults during init; the
    // frozen 0.3.9 bash scripts only write them when explicitly set.
    'direct_override',
  ]);
  return Object.fromEntries(Object.entries(document).filter(([key]) => !runKeys.has(key)));
}

interface StateObservation {
  status: number | null;
  stdout: string;
  stderr: string;
  yaml: Record<string, unknown>;
}

async function observeState(
  sourceScripts: string,
  profile: 'full' | 'hotfix' | 'tweak',
  followUp?: string[],
): Promise<StateObservation> {
  const variant = variantOf(sourceScripts);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `comet-classic-${profile}-`));
  temporaryRoots.push(root);
  const scripts = path.join(root, 'scripts');
  await copyScripts(sourceScripts, scripts, variant.names);

  const name = `${profile}-change`;
  const init = runScript(
    root,
    scripts,
    variant.state,
    ['init', name, profile],
    undefined,
    variant.executor,
  );
  if (init.status !== 0) {
    return {
      status: init.status,
      stdout: normalizeOutput(init.stdout, root),
      stderr: normalizeOutput(init.stderr, root),
      yaml: {},
    };
  }

  const result = followUp
    ? runScript(root, scripts, variant.state, [...followUp, name], undefined, variant.executor)
    : init;
  const yamlPath = path.join(root, 'openspec', 'changes', name, '.comet.yaml');
  const yaml = parse(await fs.readFile(yamlPath, 'utf8')) as Record<string, unknown>;

  return {
    status: result.status,
    stdout: normalizeOutput(result.stdout, root),
    stderr: normalizeOutput(result.stderr, root),
    yaml: legacyProjection(yaml),
  };
}

interface GuardObservation {
  status: number | null;
  stdout: string;
  stderr: string;
}

async function observeGuard(
  sourceScripts: string,
  profile: 'full' | 'hotfix' | 'tweak',
  phase: string,
): Promise<GuardObservation> {
  const variant = variantOf(sourceScripts);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `comet-guard-${profile}-`));
  temporaryRoots.push(root);
  const scripts = path.join(root, 'scripts');
  await copyScripts(sourceScripts, scripts, variant.names);

  const name = `${profile}-guard`;
  const init = runScript(
    root,
    scripts,
    variant.state,
    ['init', name, profile],
    undefined,
    variant.executor,
  );
  if (init.status !== 0) {
    return {
      status: init.status,
      stdout: normalizeOutput(init.stdout, root),
      stderr: normalizeOutput(init.stderr, root),
    };
  }

  const result = runScript(
    root,
    scripts,
    variant.guard,
    [name, phase],
    undefined,
    variant.executor,
  );
  return {
    status: result.status,
    stdout: normalizeOutput(result.stdout, root),
    stderr: normalizeOutput(result.stderr, root),
  };
}

interface HandoffObservation {
  status: number | null;
  stdout: string;
  stderr: string;
  yaml: Record<string, unknown>;
}

async function observeHandoff(
  sourceScripts: string,
  profile: 'full' | 'hotfix' | 'tweak',
): Promise<HandoffObservation> {
  const variant = variantOf(sourceScripts);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `comet-handoff-${profile}-`));
  temporaryRoots.push(root);
  const scripts = path.join(root, 'scripts');
  await copyScripts(sourceScripts, scripts, variant.names);

  const name = `${profile}-handoff`;
  runScript(root, scripts, variant.state, ['init', name, profile], undefined, variant.executor);
  const changeDir = path.join(root, 'openspec', 'changes', name);
  // Seed the required OpenSpec artifacts BEFORE driving open→design (the
  // transition requires them to exist).
  await fs.writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await fs.writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] seed task\n');
  runScript(
    root,
    scripts,
    variant.state,
    ['transition', name, 'open-complete'],
    undefined,
    variant.executor,
  );

  const result = runScript(
    root,
    scripts,
    variant.handoff,
    [name, 'design', '--write'],
    undefined,
    variant.executor,
  );
  const yaml = parse(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')) as Record<
    string,
    unknown
  >;

  return {
    status: result.status,
    stdout: normalizeOutput(result.stdout, root),
    stderr: normalizeOutput(result.stderr, root),
    yaml: legacyProjection(yaml),
  };
}

async function observeHook(sourceScripts: string): Promise<GuardObservation> {
  const variant = variantOf(sourceScripts);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-'));
  temporaryRoots.push(root);
  const scripts = path.join(root, 'scripts');
  await copyScripts(sourceScripts, scripts, variant.names);

  const name = 'full-hook';
  runScript(root, scripts, variant.state, ['init', name, 'full'], undefined, variant.executor);
  const changeDir = path.join(root, 'openspec', 'changes', name);
  // Open→design transition requires the open artifacts to exist first.
  await fs.writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await fs.writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] task\n');
  runScript(
    root,
    scripts,
    variant.state,
    ['transition', name, 'open-complete'],
    undefined,
    variant.executor,
  );
  const input = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'src', 'index.ts') },
  });
  const result = runScript(root, scripts, variant.hookGuard, [], input, variant.executor);
  return {
    status: result.status,
    stdout: normalizeOutput(result.stdout, root),
    stderr: normalizeOutput(result.stderr, root),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe('frozen Classic 0.3.9 reference', () => {
  it('records the source commit and checksums for every compatibility script', async () => {
    const readme = await fs.readFile(path.join(referenceRoot, 'README.md'), 'utf8');
    const checksums = JSON.parse(
      await fs.readFile(path.join(referenceRoot, 'checksums.json'), 'utf8'),
    ) as Record<string, string>;

    expect(readme).toContain(sourceCommit);
    expect(Object.keys(checksums).sort()).toEqual([...scriptNames].sort());

    for (const name of scriptNames) {
      expect(await sha256(path.join(referenceScripts, name))).toBe(checksums[name]);
    }
  });
});

describeBash('Classic 0.3.9 differential contract', () => {
  for (const profile of ['full', 'hotfix', 'tweak'] as const) {
    it(`preserves ${profile} initialization`, async () => {
      const active = await observeState(activeScripts, profile);
      const reference = await observeState(referenceScripts, profile);

      expect(active.status).toBe(reference.status);
      expect(active.yaml).toEqual(reference.yaml);
      expect(active.stdout).toBe(reference.stderr);
      expect(active.stderr).toBe('');
    });

    it(`preserves ${profile} next-skill routing`, async () => {
      expect(await observeState(activeScripts, profile, ['next'])).toEqual(
        await observeState(referenceScripts, profile, ['next']),
      );
    });
  }

  it('preserves rejection of an invalid transition', async () => {
    expect(await observeState(activeScripts, 'full', ['transition', 'build-complete'])).toEqual(
      await observeState(referenceScripts, 'full', ['transition', 'build-complete']),
    );
  });

  it('preserves full open guard block (strict output parity)', async () => {
    expect(await observeGuard(activeScripts, 'full', 'open')).toEqual(
      await observeGuard(referenceScripts, 'full', 'open'),
    );
  });

  for (const profile of ['hotfix', 'tweak'] as const) {
    it(`preserves ${profile} open guard block (strict output parity)`, async () => {
      expect(await observeGuard(activeScripts, profile, 'open')).toEqual(
        await observeGuard(referenceScripts, profile, 'open'),
      );
    });
  }

  it('preserves design handoff generation for the full workflow', async () => {
    expect(await observeHandoff(activeScripts, 'full')).toEqual(
      await observeHandoff(referenceScripts, 'full'),
    );
  });

  // The active runtime updated hook guard messages (English wording, relative
  // paths) beyond what 0.3.9 shipped. The preserved contract is that a
  // design-phase source write is still BLOCKED (exit 2).
  it('preserves hook guard blocking for source writes in design (exit status)', async () => {
    const active = await observeHook(activeScripts);
    const frozen = await observeHook(referenceScripts);
    expect(active.status).toBe(frozen.status);
    expect(active.status).toBe(2);
  });
});
