import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');

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
    const probe = spawnSync(candidate, ['-lc', 'uname -s'], { encoding: 'utf-8' });
    if (probe.status === 0 && probe.stdout.trim()) {
      if (process.platform === 'win32' && /linux/i.test(probe.stdout)) continue;
      return candidate;
    }
  }
  return null;
}

const bashCommand = findUsableBash();
const bashUname = bashCommand
  ? (spawnSync(bashCommand, ['-lc', 'uname -s'], { encoding: 'utf-8' }).stdout || '').trim()
  : '';
const isGitBash = /^(MINGW|MSYS|CYGWIN)/.test(bashUname);

function toBashPath(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  const driveMatch = resolved.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return resolved;
  if (process.platform === 'win32' && isGitBash) {
    return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
  }
  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}

function runBash(cwd: string, script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  if (!bashCommand) {
    throw new Error('comet shell script tests require Bash or Git Bash');
  }
  return spawnSync(bashCommand, [toBashPath(script), ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function createChange(tmpDir: string, name: string, yaml: string, tasks = '- [x] done\n') {
  const changeDir = path.join(tmpDir, 'openspec', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await writeFile(path.join(changeDir, '.comet.yaml'), yaml);
  await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await writeFile(path.join(changeDir, 'tasks.md'), tasks);
  return changeDir;
}

const describeShell = bashCommand ? describe : describe.skip;

describeShell('comet shell scripts', () => {
  let tmpDir: string;
  let guardScript: string;
  let stateScript: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-scripts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpScriptsDir = path.join(tmpDir, 'scripts');
    await fs.mkdir(tmpScriptsDir, { recursive: true });
    for (const name of [
      'comet-env.sh',
      'comet-archive.sh',
      'comet-guard.sh',
      'comet-handoff.sh',
      'comet-state.sh',
      'comet-yaml-validate.sh',
    ]) {
      const content = await fs.readFile(path.join(scriptsDir, name), 'utf-8');
      await fs.writeFile(path.join(tmpScriptsDir, name), content.replace(/\r\n/g, '\n'));
    }
    guardScript = path.join(tmpScriptsDir, 'comet-guard.sh');
    stateScript = path.join(tmpScriptsDir, 'comet-state.sh');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('initializes a new change directory with workflow defaults', async () => {
    const result = runBash(tmpDir, stateScript, ['init', 'new-full-change', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'new-full-change', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('workflow: full');
    expect(yaml).toContain('phase: open');
    expect(yaml).toContain('verification_report: null');
    expect(yaml).toContain('branch_status: pending');
  }, 20_000);

  it('initializes build_pause as null for new changes', async () => {
    const result = runBash(tmpDir, stateScript, ['init', 'pause-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'pause-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('build_pause: null');
  }, 20_000);

  it('initializes auto_transition as true when openspec comet config is absent', async () => {
    const result = runBash(tmpDir, stateScript, ['init', 'auto-transition-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'auto-transition-defaults', '.comet.yaml'),
      'utf-8',
    );
    const get = runBash(tmpDir, stateScript, [
      'get',
      'auto-transition-defaults',
      'auto_transition',
    ]);

    expect(result.status).toBe(0);
    expect(yaml).toContain('auto_transition: true');
    expect(get.status).toBe(0);
    expect(get.stdout.trim()).toBe('true');
  }, 20_000);

  it('initializes auto_transition from openspec comet config when set to false', async () => {
    await writeFile(path.join(tmpDir, 'openspec', 'comet.yaml'), 'auto_transition: false\n');

    const result = runBash(tmpDir, stateScript, ['init', 'auto-transition-config-false', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'auto-transition-config-false', '.comet.yaml'),
      'utf-8',
    );
    const get = runBash(tmpDir, stateScript, [
      'get',
      'auto-transition-config-false',
      'auto_transition',
    ]);

    expect(result.status).toBe(0);
    expect(yaml).toContain('auto_transition: false');
    expect(get.status).toBe(0);
    expect(get.stdout.trim()).toBe('false');
  }, 20_000);

  it('initializes auto_transition as true when openspec comet config omits or invalidates it', async () => {
    await writeFile(path.join(tmpDir, 'openspec', 'comet.yaml'), 'build_command: npm test\n');
    const omitted = runBash(tmpDir, stateScript, [
      'init',
      'auto-transition-config-omitted',
      'full',
    ]);
    const omittedValue = runBash(tmpDir, stateScript, [
      'get',
      'auto-transition-config-omitted',
      'auto_transition',
    ]);

    await writeFile(path.join(tmpDir, 'openspec', 'comet.yaml'), 'auto_transition: maybe\n');
    const invalid = runBash(tmpDir, stateScript, [
      'init',
      'auto-transition-config-invalid',
      'full',
    ]);
    const invalidValue = runBash(tmpDir, stateScript, [
      'get',
      'auto-transition-config-invalid',
      'auto_transition',
    ]);

    expect(omitted.status).toBe(0);
    expect(omittedValue.status).toBe(0);
    expect(omittedValue.stdout.trim()).toBe('true');
    expect(invalid.status).toBe(0);
    expect(invalidValue.status).toBe(0);
    expect(invalidValue.stdout.trim()).toBe('true');
  }, 20_000);

  it('sets auto_transition to false and rejects invalid auto_transition values', async () => {
    await createChange(
      tmpDir,
      'auto-transition-set',
      [
        'workflow: full',
        'phase: open',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const setFalse = runBash(tmpDir, stateScript, [
      'set',
      'auto-transition-set',
      'auto_transition',
      'false',
    ]);
    const get = runBash(tmpDir, stateScript, ['get', 'auto-transition-set', 'auto_transition']);
    const setInvalid = runBash(tmpDir, stateScript, [
      'set',
      'auto-transition-set',
      'auto_transition',
      'maybe',
    ]);

    expect(setFalse.status).toBe(0);
    expect(get.status).toBe(0);
    expect(get.stdout.trim()).toBe('false');
    expect(setInvalid.status).not.toBe(0);
  }, 20_000);

  it('treats missing auto_transition as true for legacy comet yaml', async () => {
    const validateScript = path.join(tmpDir, 'scripts', 'comet-yaml-validate.sh');
    await createChange(
      tmpDir,
      'auto-transition-legacy',
      [
        'workflow: full',
        'phase: open',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const validate = runBash(tmpDir, validateScript, ['auto-transition-legacy']);
    const get = runBash(tmpDir, stateScript, [
      'get',
      'auto-transition-legacy',
      'auto_transition',
    ]);
    const guard = runBash(tmpDir, guardScript, ['auto-transition-legacy', 'open']);

    expect(validate.status).toBe(0);
    expect(get.status).toBe(0);
    expect(get.stdout.trim()).toBe('true');
    expect(guard.status).toBe(0);
  }, 20_000);

  it('rejects null, empty, and invalid auto_transition values during comet yaml validation', async () => {
    const validateScript = path.join(tmpDir, 'scripts', 'comet-yaml-validate.sh');
    for (const [name, line] of [
      ['auto-transition-null', 'auto_transition: null'],
      ['auto-transition-empty', 'auto_transition:'],
      ['auto-transition-invalid', 'auto_transition: maybe'],
    ] as const) {
      await createChange(
        tmpDir,
        name,
        [
          'workflow: full',
          'phase: open',
          'build_mode: null',
          'build_pause: null',
          'isolation: null',
          'verify_mode: null',
          line,
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, validateScript, [name]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('auto_transition');
    }
  }, 20_000);

  it('comet-env.sh exports bundled script paths from its own directory', async () => {
    const envScript = path.join(tmpDir, 'scripts', 'comet-env.sh');
    const checkScript = path.join(tmpDir, 'check-env.sh');
    await writeFile(
      checkScript,
      [
        '#!/bin/bash',
        `. "${toBashPath(envScript)}"`,
        'printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$COMET_STATE" "$COMET_GUARD" "$COMET_HANDOFF" "$COMET_ARCHIVE" "$COMET_BASH"',
        '',
      ].join('\n'),
    );
    const result = runBash(tmpDir, checkScript);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('comet-state.sh');
    expect(result.stdout).toContain('comet-guard.sh');
    expect(result.stdout).toContain('comet-handoff.sh');
    expect(result.stdout).toContain('comet-archive.sh');
    expect(result.stdout).toContain('bash');
  }, 20_000);

  it('comet-env.sh returns failure when a bundled script is missing', async () => {
    const envScript = path.join(tmpDir, 'scripts', 'comet-env.sh');
    await fs.rm(path.join(tmpDir, 'scripts', 'comet-guard.sh'));
    const checkScript = path.join(tmpDir, 'check-env-missing.sh');
    await writeFile(
      checkScript,
      [
        '#!/bin/bash',
        `. "${toBashPath(envScript)}"`,
        'status=$?',
        'echo "source-status=$status"',
        'exit "$status"',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, checkScript);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR: Comet scripts not found');
    expect(result.stdout).toContain('source-status=1');
  }, 20_000);

  it('comet-env.sh does not change caller shell options when sourced', async () => {
    const envScript = path.join(tmpDir, 'scripts', 'comet-env.sh');
    const checkScript = path.join(tmpDir, 'check-env-options.sh');
    await writeFile(
      checkScript,
      [
        '#!/bin/bash',
        'set +e',
        'set +u',
        'set +o pipefail',
        `. "${toBashPath(envScript)}"`,
        'case "$-" in *e*) echo errexit-on ;; *) echo errexit-off ;; esac',
        'case "$-" in *u*) echo nounset-on ;; *) echo nounset-off ;; esac',
        "if set -o | grep -E '^pipefail[[:space:]]+on' >/dev/null; then",
        '  echo pipefail-on',
        'else',
        '  echo pipefail-off',
        'fi',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, checkScript);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('errexit-off');
    expect(result.stdout).toContain('nounset-off');
    expect(result.stdout).toContain('pipefail-off');
  }, 20_000);

  it('blocks build phase when the project build command fails', async () => {
    await createChange(
      tmpDir,
      'broken-build',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(1)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['broken-build', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] Build passes');
  }, 20_000);

  it('generates a design handoff and requires minimal design doc linkage before leaving design', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'handoff-change',
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      '- [ ] build the handoff\n',
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'handoff-change', 'specs', 'capability', 'spec.md'),
      'delta spec\n',
    );

    const handoff = runBash(tmpDir, handoffScript, ['handoff-change', 'design', '--write']);
    const contextPath = runBash(tmpDir, stateScript, [
      'get',
      'handoff-change',
      'handoff_context',
    ]).stdout.trim();
    const contextHash = runBash(tmpDir, stateScript, [
      'get',
      'handoff-change',
      'handoff_hash',
    ]).stdout.trim();

    expect(handoff.status).toBe(0);
    expect(contextPath).toBe('openspec/changes/handoff-change/.comet/handoff/design-context.json');
    expect(contextHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(fs.stat(path.join(tmpDir, contextPath))).resolves.toBeDefined();
    const contextMarkdown = await fs.readFile(
      path.join(
        tmpDir,
        'openspec',
        'changes',
        'handoff-change',
        '.comet',
        'handoff',
        'design-context.md',
      ),
      'utf-8',
    );
    expect(contextMarkdown).toContain('Mode: compact');
    expect(contextMarkdown).toContain('Source: openspec/changes/handoff-change/proposal.md');
    expect(contextMarkdown).toContain('SHA256:');

    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'handoff-design.md'),
      [
        '---',
        'comet_change: handoff-change',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
      ].join('\n'),
    );
    runBash(tmpDir, stateScript, [
      'set',
      'handoff-change',
      'design_doc',
      'docs/superpowers/specs/handoff-design.md',
    ]);

    const result = runBash(tmpDir, guardScript, ['handoff-change', 'design']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] design handoff context exists');
    expect(result.stderr).toContain('[PASS] design handoff markdown is traceable');
    expect(result.stderr).toContain('[PASS] Design Doc frontmatter links current change');
    expect(result.stderr).toContain('[PASS] Design Doc declares OpenSpec as canonical spec');
  }, 20_000);

  it('reads comet yaml fields without including trailing comments', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    const validateScript = path.join(tmpDir, 'scripts', 'comet-yaml-validate.sh');
    await createChange(
      tmpDir,
      'commented-yaml',
      [
        'workflow: full # full process',
        'phase: design # ready for handoff',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending # not verified yet',
        'verified_at: null',
        'archived: false # active',
        '',
      ].join('\n'),
    );

    const phase = runBash(tmpDir, stateScript, ['get', 'commented-yaml', 'phase']);
    const validate = runBash(tmpDir, validateScript, ['commented-yaml']);
    const handoff = runBash(tmpDir, handoffScript, ['commented-yaml', 'design', '--write']);

    expect(phase.status).toBe(0);
    expect(phase.stdout.trim()).toBe('design');
    expect(validate.status).toBe(0);
    expect(handoff.status).toBe(0);
  }, 20_000);

  it('accepts design doc frontmatter after a BOM and leading blank lines', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'frontmatter-prefix',
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    runBash(tmpDir, handoffScript, ['frontmatter-prefix', 'design', '--write']);
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'frontmatter-prefix-design.md'),
      [
        '\uFEFF',
        '',
        '---',
        'comet_change: frontmatter-prefix',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
      ].join('\n'),
    );
    runBash(tmpDir, stateScript, [
      'set',
      'frontmatter-prefix',
      'design_doc',
      'docs/superpowers/specs/frontmatter-prefix-design.md',
    ]);

    const result = runBash(tmpDir, guardScript, ['frontmatter-prefix', 'design']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] Design Doc frontmatter links current change');
    expect(result.stderr).toContain('[PASS] Design Doc declares OpenSpec as canonical spec');
  }, 20_000);

  it('generates a full-mode design handoff when --full is passed', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'full-handoff',
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const handoff = runBash(tmpDir, handoffScript, ['full-handoff', 'design', '--write', '--full']);

    expect(handoff.status).toBe(0);
    const contextMarkdown = await fs.readFile(
      path.join(
        tmpDir,
        'openspec',
        'changes',
        'full-handoff',
        '.comet',
        'handoff',
        'design-context.md',
      ),
      'utf-8',
    );
    expect(contextMarkdown).toContain('Mode: full');
    expect(contextMarkdown).not.toContain('[TRUNCATED]');
  }, 20_000);

  it('rejects handoff generation when required OpenSpec artifacts are missing', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'missing-artifacts');
    await fs.mkdir(changeDir, { recursive: true });
    await writeFile(
      path.join(changeDir, '.comet.yaml'),
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
    // design.md and tasks.md intentionally omitted

    const result = runBash(tmpDir, handoffScript, ['missing-artifacts', 'design', '--write']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required OpenSpec artifact missing or empty');
  }, 20_000);

  it('detects OpenSpec artifacts changed after handoff was generated', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'stale-handoff',
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    runBash(tmpDir, handoffScript, ['stale-handoff', 'design', '--write']);

    // Mutate proposal.md after handoff was generated
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'stale-handoff', 'proposal.md'),
      'mutated proposal\n',
    );

    const result = runBash(tmpDir, guardScript, ['stale-handoff', 'design']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] design handoff context exists');
    expect(result.stderr).toContain('OpenSpec artifacts changed after handoff was generated');
  }, 20_000);

  it('blocks design exit when design doc frontmatter is missing required fields', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'bad-frontmatter',
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    runBash(tmpDir, handoffScript, ['bad-frontmatter', 'design', '--write']);

    // Design doc with wrong comet_change
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'bad-design.md'),
      [
        '---',
        'comet_change: wrong-change',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
      ].join('\n'),
    );
    runBash(tmpDir, stateScript, [
      'set',
      'bad-frontmatter',
      'design_doc',
      'docs/superpowers/specs/bad-design.md',
    ]);

    const result = runBash(tmpDir, guardScript, ['bad-frontmatter', 'design']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] Design Doc frontmatter links current change');
  }, 20_000);

  it('blocks build completion until isolation and build mode are selected', async () => {
    await createChange(
      tmpDir,
      'missing-build-decisions',
      [
        'workflow: full',
        'phase: build',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const guard = runBash(tmpDir, guardScript, ['missing-build-decisions', 'build']);
    const transition = runBash(tmpDir, stateScript, [
      'transition',
      'missing-build-decisions',
      'build-complete',
    ]);

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('[FAIL] isolation selected');
    expect(guard.stderr).toContain('[FAIL] build_mode selected');
    expect(guard.stderr).toContain('Next: ask the user to choose branch or worktree');
    expect(guard.stderr).toContain('Next: ask the user to choose an execution mode');
    expect(transition.status).not.toBe(0);
    expect(transition.stderr).toContain('isolation must be branch or worktree');
  }, 20_000);

  it('allows setting build_pause to plan-ready and back to null', async () => {
    await createChange(
      tmpDir,
      'pause-set',
      [
        'workflow: full',
        'phase: build',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const setPlanReady = runBash(tmpDir, stateScript, [
      'set',
      'pause-set',
      'build_pause',
      'plan-ready',
    ]);
    const planReady = runBash(tmpDir, stateScript, ['get', 'pause-set', 'build_pause']);
    const setNull = runBash(tmpDir, stateScript, ['set', 'pause-set', 'build_pause', 'null']);
    const pausedNull = runBash(tmpDir, stateScript, ['get', 'pause-set', 'build_pause']);

    expect(setPlanReady.status).toBe(0);
    expect(planReady.stdout.trim()).toBe('plan-ready');
    expect(setNull.status).toBe(0);
    expect(pausedNull.stdout.trim()).toBe('null');
  }, 20_000);

  it('rejects invalid build_pause values during schema validation', async () => {
    await createChange(
      tmpDir,
      'invalid-build-pause',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: paused',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, guardScript, ['invalid-build-pause', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("build_pause='paused' is not valid");
    expect(result.stderr).toContain('FATAL: .comet.yaml schema validation failed');
  }, 20_000);

  it('rejects direct build mode for full workflow without explicit override', async () => {
    await createChange(
      tmpDir,
      'direct-full',
      [
        'workflow: full',
        'phase: build',
        'build_mode: direct',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['direct-full', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] build_mode allowed for workflow');
    expect(result.stderr).toContain('direct is only allowed for hotfix/tweak');
    expect(result.stderr).toContain('Next: choose executing-plans or subagent-driven-development');
  }, 20_000);

  it('prints actionable remediation for unfinished tasks', async () => {
    await createChange(
      tmpDir,
      'unfinished-tasks',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      ['- [x] done', '- [ ] finish guard remediation'].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['unfinished-tasks', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] tasks.md all tasks checked');
    expect(result.stderr).toContain('Unfinished tasks:');
    expect(result.stderr).toContain('finish guard remediation');
    expect(result.stderr).toContain('Next: complete or explicitly remove unfinished tasks');
  }, 20_000);

  it('rejects direct build mode for full workflow during state transition', async () => {
    await createChange(
      tmpDir,
      'direct-full-transition',
      [
        'workflow: full',
        'phase: build',
        'build_mode: direct',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, stateScript, [
      'transition',
      'direct-full-transition',
      'build-complete',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('build_mode=direct is only allowed for hotfix/tweak');
  });

  it('allows direct build mode for full workflow with explicit override', async () => {
    await createChange(
      tmpDir,
      'direct-full-override',
      [
        'workflow: full',
        'phase: build',
        'build_mode: direct',
        'build_pause: null',
        'direct_override: true',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['direct-full-override', 'build']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] build_mode allowed for workflow');
  }, 20_000);

  it('runs configured build command and prints its failure output', async () => {
    await createChange(
      tmpDir,
      'configured-build',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'build_command: node build-check.js',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'build-check.js'),
      'console.error("configured failure"); process.exit(1);\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['configured-build', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('configured failure');
  }, 20_000);

  it('preserves configured command values with sed replacement metacharacters', async () => {
    const command = 'node -e "console.log(\'a&b|c\')"';
    await createChange(
      tmpDir,
      'command-metacharacters',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const set = runBash(tmpDir, stateScript, [
      'set',
      'command-metacharacters',
      'build_command',
      command,
    ]);
    const get = runBash(tmpDir, stateScript, ['get', 'command-metacharacters', 'build_command']);

    expect(set.status).toBe(0);
    expect(get.stdout.trim()).toBe(command);
  });

  it('keeps shell scripts portable across GNU and BSD sed', async () => {
    for (const name of [
      'comet-env.sh',
      'comet-state.sh',
      'comet-archive.sh',
      'comet-guard.sh',
      'comet-handoff.sh',
      'comet-yaml-validate.sh',
    ]) {
      const content = await fs.readFile(path.join(tmpDir, 'scripts', name), 'utf-8');

      expect(content).not.toMatch(/\bsed\s+-i(?:\s|$)/);
    }
  });

  it('keeps optional YAML field reads safe under pipefail', async () => {
    for (const name of ['comet-state.sh', 'comet-guard.sh']) {
      const content = await fs.readFile(path.join(tmpDir, 'scripts', name), 'utf-8');

      expect(content).toMatch(/grep "\^\$\{field\}:" "\$[a-z_]+".*\|\| true\)/);
    }
  });

  it('guards bash uname detection when bash cannot be spawned', async () => {
    const files = [
      path.resolve('scripts', 'run-bats.js'),
      path.resolve('test', 'ts', 'comet-scripts.test.ts'),
    ];

    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');

      expect(content).toContain(".stdout || ''");
    }
  });

  it('uses COMET_BASH for nested script calls when PATH bash is unusable', async () => {
    const fakeBin = path.join(tmpDir, 'fake-bin');
    await fs.mkdir(fakeBin, { recursive: true });
    const fakeBash = path.join(fakeBin, 'bash');
    await writeFile(
      fakeBash,
      [
        '#!/bin/sh',
        'echo "bad WSL bash" >&2',
        'exit 127',
        '',
      ].join('\n'),
    );
    await fs.chmod(fakeBash, 0o755);
    await createChange(
      tmpDir,
      'nested-bash',
      [
        'workflow: full',
        'phase: open',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = spawnSync('bash', [
      '-lc',
      [
        'COMET_BASH="/bin/bash"',
        `PATH="${toBashPath(fakeBin)}:$PATH"`,
        'export COMET_BASH PATH',
        `/bin/bash "${toBashPath(guardScript)}" nested-bash open --apply`,
      ].join('; '),
    ], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'nested-bash', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('bad WSL bash');
    expect(yaml).toContain('phase: design');
  }, 20_000);

  it('does not use PATH bash for nested Comet script calls', async () => {
    for (const name of ['comet-archive.sh', 'comet-guard.sh', 'comet-handoff.sh']) {
      const content = await fs.readFile(path.join(tmpDir, 'scripts', name), 'utf-8');

      expect(content, `${name} should use COMET_BASH for nested scripts`).not.toMatch(
        /\bbash\s+"?\$(?:STATE_SH|state_sh|validate_script)/,
      );
    }
  });

  it('uses root-level build command config before inferred build commands', async () => {
    await createChange(
      tmpDir,
      'root-configured-build',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(tmpDir, 'comet.yaml'), 'build_command: node root-build-check.js\n');
    await writeFile(
      path.join(tmpDir, 'root-build-check.js'),
      'console.error("root configured failure"); process.exit(1);\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['root-configured-build', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('root configured failure');
  }, 20_000);

  it('runs configured verify command before archiving', async () => {
    await createChange(
      tmpDir,
      'configured-verify',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: full',
        'auto_transition: true',
        'verify_command: node verify-check.js',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verification_report: docs/superpowers/reports/configured-verify.md',
        'branch_status: handled',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'reports', 'configured-verify.md'),
      'PASS\n',
    );
    await writeFile(
      path.join(tmpDir, 'verify-check.js'),
      'console.error("verify configured failure"); process.exit(1);\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['configured-verify', 'verify']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verify configured failure');
  }, 20_000);

  it('validates archive completeness after the change has moved into archive', async () => {
    await createChange(
      tmpDir,
      path.join('archive', '2026-05-21-done-change'),
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: light',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pass',
        'verified_at: 2026-05-21',
        'archived: true',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, guardScript, ['2026-05-21-done-change', 'archive']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('ALL CHECKS PASSED');
  });

  it('reports accurate archive step counts when syncing and annotating', async () => {
    const archiveScript = path.join(tmpDir, 'scripts', 'comet-archive.sh');
    await createChange(
      tmpDir,
      'ready-to-archive',
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: full',
        'auto_transition: true',
        'design_doc: docs/superpowers/specs/ready-design.md',
        'plan: docs/superpowers/plans/ready-plan.md',
        'verify_result: pass',
        'verification_report: docs/superpowers/reports/ready.md',
        'branch_status: handled',
        'verified_at: 2026-05-21',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'ready-design.md'),
      'design\n',
    );
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'plans', 'ready-plan.md'), 'plan\n');
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'reports', 'ready.md'), 'PASS\n');
    await writeFile(
      path.join(
        tmpDir,
        'openspec',
        'changes',
        'ready-to-archive',
        'specs',
        'capability',
        'spec.md',
      ),
      'delta spec\n',
    );

    const result = runBash(tmpDir, archiveScript, ['ready-to-archive']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Archive complete. 7/7 steps succeeded.');
  }, 20_000);

  it('uses plan base-ref to scale verification after changes have been committed', async () => {
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDir });
    execFileSync('git', ['config', 'tag.gpgsign', 'false'], { cwd: tmpDir });
    await writeFile(path.join(tmpDir, 'README.md'), 'base\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: tmpDir, stdio: 'ignore' });
    const baseRef = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    }).trim();

    await createChange(
      tmpDir,
      'large-change',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: docs/superpowers/plans/large-change.md',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      ['- [x] task 1', '- [x] task 2', '- [x] task 3'].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'plans', 'large-change.md'),
      ['---', 'change: large-change', `base-ref: ${baseRef}`, '---', ''].join('\n'),
    );
    for (let i = 1; i <= 6; i += 1) {
      await writeFile(path.join(tmpDir, 'src', `file-${i}.txt`), `change ${i}\n`);
    }
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'large change'], { cwd: tmpDir, stdio: 'ignore' });

    const result = runBash(tmpDir, stateScript, ['scale', 'large-change']);
    const mode = runBash(tmpDir, stateScript, ['get', 'large-change', 'verify_mode']);

    expect(result.status).toBe(0);
    expect(mode.stdout.trim()).toBe('full');
  }, 25_000);

  it('falls back to comet base_ref when scale plan omits base-ref', async () => {
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDir });
    execFileSync('git', ['config', 'tag.gpgsign', 'false'], { cwd: tmpDir });
    await writeFile(path.join(tmpDir, 'README.md'), 'base\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: tmpDir, stdio: 'ignore' });
    const baseRef = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    }).trim();

    await createChange(
      tmpDir,
      'fallback-base-ref',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: null',
        'auto_transition: true',
        `base_ref: ${baseRef}`,
        'design_doc: null',
        'plan: docs/superpowers/plans/fallback-base-ref.md',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      ['- [x] task 1', '- [x] task 2', '- [x] task 3'].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'plans', 'fallback-base-ref.md'),
      'plan\n',
    );
    for (let i = 1; i <= 6; i += 1) {
      await writeFile(path.join(tmpDir, 'src', `fallback-${i}.txt`), `change ${i}\n`);
    }
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'large fallback change'], { cwd: tmpDir, stdio: 'ignore' });

    const result = runBash(tmpDir, stateScript, ['scale', 'fallback-base-ref']);
    const mode = runBash(tmpDir, stateScript, ['get', 'fallback-base-ref', 'verify_mode']);

    expect(result.status).toBe(0);
    expect(mode.stdout.trim()).toBe('full');
  }, 25_000);

  it('transitions full workflow from open to design', async () => {
    await createChange(
      tmpDir,
      'full-change',
      [
        'workflow: full',
        'phase: open',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, stateScript, ['transition', 'full-change', 'open-complete']);
    const phase = runBash(tmpDir, stateScript, ['get', 'full-change', 'phase']);

    expect(result.status).toBe(0);
    expect(phase.stdout.trim()).toBe('design');
  });

  it('transitions preset workflows from open directly to build', async () => {
    await createChange(
      tmpDir,
      'tweak-change',
      [
        'workflow: tweak',
        'phase: open',
        'build_mode: direct',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: light',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, stateScript, ['transition', 'tweak-change', 'open-complete']);
    const phase = runBash(tmpDir, stateScript, ['get', 'tweak-change', 'phase']);

    expect(result.status).toBe(0);
    expect(phase.stdout.trim()).toBe('build');
  });

  it('transitions verify-pass and verify-fail through script-owned fields', async () => {
    await createChange(
      tmpDir,
      'verify-change',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: full',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verification_report: null',
        'branch_status: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const fail = runBash(tmpDir, stateScript, ['transition', 'verify-change', 'verify-fail']);
    const failedPhase = runBash(tmpDir, stateScript, ['get', 'verify-change', 'phase']);
    const failedResult = runBash(tmpDir, stateScript, ['get', 'verify-change', 'verify_result']);
    const failedBranchStatus = runBash(tmpDir, stateScript, [
      'get',
      'verify-change',
      'branch_status',
    ]);

    expect(fail.status).toBe(0);
    expect(failedPhase.stdout.trim()).toBe('build');
    expect(failedResult.stdout.trim()).toBe('fail');
    expect(failedBranchStatus.stdout.trim()).toBe('pending');

    runBash(tmpDir, stateScript, ['set', 'verify-change', 'phase', 'verify']);
    runBash(tmpDir, stateScript, ['set', 'verify-change', 'verify_result', 'pending']);
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'reports', 'verify-change.md'),
      'PASS\n',
    );
    runBash(tmpDir, stateScript, [
      'set',
      'verify-change',
      'verification_report',
      'docs/superpowers/reports/verify-change.md',
    ]);
    runBash(tmpDir, stateScript, ['set', 'verify-change', 'branch_status', 'handled']);

    const pass = runBash(tmpDir, stateScript, ['transition', 'verify-change', 'verify-pass']);
    const passedPhase = runBash(tmpDir, stateScript, ['get', 'verify-change', 'phase']);
    const passedResult = runBash(tmpDir, stateScript, ['get', 'verify-change', 'verify_result']);
    const verifiedAt = runBash(tmpDir, stateScript, ['get', 'verify-change', 'verified_at']);

    expect(pass.status).toBe(0);
    expect(passedPhase.stdout.trim()).toBe('archive');
    expect(passedResult.stdout.trim()).toBe('pass');
    expect(verifiedAt.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 20_000);

  it('blocks verify guard when verification evidence is missing', async () => {
    await createChange(
      tmpDir,
      'guard-verify',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: light',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verification_report: null',
        'branch_status: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['guard-verify', 'verify', '--apply']);
    const phase = runBash(tmpDir, stateScript, ['get', 'guard-verify', 'phase']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] verification_report exists');
    expect(result.stderr).toContain('[FAIL] branch_status=handled');
    expect(phase.stdout.trim()).toBe('verify');
  }, 20_000);

  it('lets verify guard apply transition after verification and branch evidence are recorded', async () => {
    await createChange(
      tmpDir,
      'guard-verify',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: light',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verification_report: docs/superpowers/reports/guard-verify.md',
        'branch_status: handled',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'reports', 'guard-verify.md'),
      'PASS\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['guard-verify', 'verify', '--apply']);
    const phase = runBash(tmpDir, stateScript, ['get', 'guard-verify', 'phase']);
    const verifyResult = runBash(tmpDir, stateScript, ['get', 'guard-verify', 'verify_result']);

    expect(result.status).toBe(0);
    expect(phase.stdout.trim()).toBe('archive');
    expect(verifyResult.stdout.trim()).toBe('pass');
  }, 20_000);

  it('rejects invalid transition from the wrong phase', async () => {
    await createChange(
      tmpDir,
      'wrong-phase',
      [
        'workflow: full',
        'phase: open',
        'build_mode: null',
        'build_pause: null',
        'isolation: null',
        'verify_mode: null',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, stateScript, ['transition', 'wrong-phase', 'build-complete']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('expected phase build');
  });

  it('marks archived changes through transition in the archive directory', async () => {
    await createChange(
      tmpDir,
      path.join('archive', '2026-05-21-done-change'),
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'isolation: branch',
        'verify_mode: full',
        'auto_transition: true',
        'design_doc: null',
        'plan: null',
        'verify_result: pass',
        'verified_at: 2026-05-21',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, stateScript, [
      'transition',
      '2026-05-21-done-change',
      'archived',
    ]);
    const archived = runBash(tmpDir, stateScript, ['get', '2026-05-21-done-change', 'archived']);

    expect(result.status).toBe(0);
    expect(archived.stdout.trim()).toBe('true');
  });

  describe('check --recover', () => {
    it('outputs recovery context for open phase', async () => {
      await createChange(
        tmpDir,
        'recover-open',
        [
          'workflow: full',
          'phase: open',
          'build_mode: null',
          'build_pause: null',
          'isolation: null',
          'verify_mode: null',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, ['check', 'recover-open', 'open', '--recover']);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Recovery Context: recover-open');
      expect(result.stdout).toContain('Phase: open');
      expect(result.stdout).toContain('Workflow: full');
      expect(result.stdout).toContain('proposal.md: DONE');
      expect(result.stdout).toContain('design.md: DONE');
      expect(result.stdout).toContain('tasks.md: DONE');
      expect(result.stdout).toContain('End Recovery Context');
    });

    it('outputs recovery context for build phase with partial progress', async () => {
      await createChange(
        tmpDir,
        'recover-build',
        [
          'workflow: full',
          'phase: build',
          'build_mode: null',
          'build_pause: null',
          'isolation: null',
          'verify_mode: null',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        ['- [x] done task', '- [ ] pending task'].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, ['check', 'recover-build', 'build', '--recover']);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Phase: build');
      expect(result.stdout).toContain('isolation: PENDING');
      expect(result.stdout).toContain('build_mode: PENDING');
      expect(result.stdout).toContain('Tasks: 1/2 done, 1 pending');
      expect(result.stdout).toContain('AskUserQuestion');
    });

    it('outputs plan-ready pause recovery context for build phase', async () => {
      await writeFile(
        path.join(tmpDir, 'docs', 'superpowers', 'plans', 'pause-plan.md'),
        'plan\n',
      );
      await createChange(
        tmpDir,
        'recover-plan-ready',
        [
          'workflow: full',
          'phase: build',
          'build_mode: null',
          'build_pause: plan-ready',
          'isolation: null',
          'verify_mode: null',
          'auto_transition: true',
          'design_doc: null',
          'plan: docs/superpowers/plans/pause-plan.md',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-plan-ready',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('build_pause: DONE (plan-ready)');
      expect(result.stdout).toContain('Plan-ready pause');
      expect(result.stdout).toContain('choose isolation and build mode');
    });

    it('outputs recovery context for verify phase with completed verification', async () => {
      await writeFile(
        path.join(tmpDir, 'docs', 'superpowers', 'reports', 'recover-verify.md'),
        'PASS\n',
      );
      await createChange(
        tmpDir,
        'recover-verify',
        [
          'workflow: full',
          'phase: verify',
          'build_mode: executing-plans',
          'build_pause: null',
          'isolation: branch',
          'verify_mode: full',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pass',
          'verification_report: docs/superpowers/reports/recover-verify.md',
          'branch_status: handled',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-verify',
        'verify',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Phase: verify');
      expect(result.stdout).toContain('verify_result: DONE (pass)');
      expect(result.stdout).toContain('branch_status: DONE (handled)');
      expect(result.stdout).toContain('guard to transition to archive');
    });

    it('outputs recovery context for design phase with handoff but no design doc', async () => {
      await createChange(
        tmpDir,
        'recover-design',
        [
          'workflow: full',
          'phase: design',
          'build_mode: null',
          'build_pause: null',
          'isolation: null',
          'verify_mode: null',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'handoff_context: openspec/changes/recover-design/.comet/handoff/design-context.json',
          'handoff_hash: abc123def456',
          'archived: false',
          '',
        ].join('\n'),
      );
      await writeFile(
        path.join(
          tmpDir,
          'openspec',
          'changes',
          'recover-design',
          '.comet',
          'handoff',
          'design-context.json',
        ),
        '{}',
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-design',
        'design',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Phase: design');
      expect(result.stdout).toContain('handoff_context: DONE');
      expect(result.stdout).toContain('design_doc: PENDING');
      expect(result.stdout).toContain('brainstorming confirmation');
    });

    it('outputs recovery context for build phase when tasks.md is missing', async () => {
      const changeDir = path.join(tmpDir, 'openspec', 'changes', 'recover-no-tasks');
      await fs.mkdir(changeDir, { recursive: true });
      await writeFile(
        path.join(changeDir, '.comet.yaml'),
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: null',
          'isolation: branch',
          'verify_mode: null',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-no-tasks',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Phase: build');
      expect(result.stdout).toContain('Tasks: tasks.md MISSING');
      expect(result.stdout).toContain('Recovery action');
      expect(result.stderr).not.toContain('unbound variable');
    });

    it('outputs recovery context for build phase with all tasks done', async () => {
      await createChange(
        tmpDir,
        'recover-build-done',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: null',
          'isolation: branch',
          'verify_mode: null',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        ['- [x] task 1', '- [x] task 2'].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-build-done',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Phase: build');
      expect(result.stdout).toContain('Tasks: 2/2 done, 0 pending');
      expect(result.stdout).toContain('All tasks done');
      expect(result.stdout).toContain('guard to transition to verify');
    });

    it('outputs recovery context for archive phase', async () => {
      await createChange(
        tmpDir,
        'recover-archive',
        [
          'workflow: full',
          'phase: archive',
          'build_mode: executing-plans',
          'build_pause: null',
          'isolation: branch',
          'verify_mode: full',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pass',
          'branch_status: handled',
          'verified_at: 2026-05-29',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-archive',
        'archive',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Phase: archive');
      expect(result.stdout).toContain('verify_result: DONE (pass)');
      expect(result.stdout).toContain('archived: DONE (false)');
      expect(result.stdout).toContain('/comet-archive');
      expect(result.stdout).toContain('End Recovery Context');
    });

    it('falls back to normal check when --recover is not passed', async () => {
      await createChange(
        tmpDir,
        'recover-normal',
        [
          'workflow: full',
          'phase: open',
          'build_mode: null',
          'build_pause: null',
          'isolation: null',
          'verify_mode: null',
          'auto_transition: true',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, ['check', 'recover-normal', 'open']);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Entry Check');
      expect(result.stderr).toContain('ALL CHECKS PASSED');
      expect(result.stdout).not.toContain('Recovery Context');
    });
  });
});
