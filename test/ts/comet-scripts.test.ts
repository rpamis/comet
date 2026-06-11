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

function runBash(
  cwd: string,
  script: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {},
  timeout?: number,
) {
  if (!bashCommand) {
    throw new Error('comet shell script tests require Bash or Git Bash');
  }
  return spawnSync(bashCommand, [toBashPath(script), ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout,
  });
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function runHookGuard(cwd: string, script: string, stdin: string, env: NodeJS.ProcessEnv = {}) {
  if (!bashCommand) {
    throw new Error('comet shell script tests require Bash or Git Bash');
  }
  return spawnSync(bashCommand, [toBashPath(script)], {
    cwd,
    encoding: 'utf-8',
    input: stdin,
    env: { ...process.env, ...env },
  });
}

function hookStdin(filePath: string): string {
  return JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: '// test' },
  });
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

async function createFakeOpenSpecArchive(tmpDir: string, archiveDateScript = 'date +%Y-%m-%d') {
  const fakeOpenSpec = path.join(tmpDir, 'fake-bin', 'openspec');
  const logFile = path.join(tmpDir, 'fake-bin', 'openspec-args.log');
  await writeFile(
    fakeOpenSpec,
    [
      '#!/bin/bash',
      'set -euo pipefail',
      `printf '%s\\n' "$*" > "${toBashPath(logFile)}"`,
      'if [ "${1:-}" != "archive" ]; then',
      '  echo "unsupported openspec command: ${1:-}" >&2',
      '  exit 1',
      'fi',
      'change="$2"',
      `today=$(${archiveDateScript})`,
      'change_dir="openspec/changes/$change"',
      'archive_dir="openspec/changes/archive/$today-$change"',
      'if [ -d "$change_dir/specs" ]; then',
      '  for delta in "$change_dir"/specs/*/spec.md; do',
      '    [ -f "$delta" ] || continue',
      '    capability=$(basename "$(dirname "$delta")")',
      '    main="openspec/specs/$capability/spec.md"',
      '    mkdir -p "$(dirname "$main")"',
      '    if [ ! -f "$main" ]; then',
      '      printf "# %s Specification\\n\\n## Purpose\\nTBD\\n\\n## Requirements\\n" "$capability" > "$main"',
      '    fi',
      "    awk '",
      '      /^## ADDED Requirements$/ { in_added = 1; next }',
      '      /^## (MODIFIED|REMOVED|RENAMED) Requirements$/ { in_added = 0 }',
      '      in_added { print }',
      '    \' "$delta" >> "$main"',
      '  done',
      'fi',
      'mkdir -p "openspec/changes/archive"',
      'mv "$change_dir" "$archive_dir"',
      'echo "Change $change archived as $today-$change."',
      '',
    ].join('\n'),
  );
  await fs.chmod(fakeOpenSpec, 0o755);
  return { fakeOpenSpec, logFile };
}

const describeShell = bashCommand ? describe : describe.skip;

describeShell('comet shell scripts', () => {
  let tmpDir: string;
  let guardScript: string;
  let stateScript: string;
  let hookGuardScript: string;

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
      'comet-hook-guard.sh',
    ]) {
      const content = await fs.readFile(path.join(scriptsDir, name), 'utf-8');
      await fs.writeFile(path.join(tmpScriptsDir, name), content.replace(/\r\n/g, '\n'));
    }
    guardScript = path.join(tmpScriptsDir, 'comet-guard.sh');
    stateScript = path.join(tmpScriptsDir, 'comet-state.sh');
    hookGuardScript = path.join(tmpScriptsDir, 'comet-hook-guard.sh');
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

  it('initializes subagent_dispatch as null for new changes', async () => {
    const result = runBash(tmpDir, stateScript, ['init', 'subagent-dispatch-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'subagent-dispatch-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('subagent_dispatch: null');
  }, 20_000);

  it('initializes tdd_mode as null for full workflow', async () => {
    const result = runBash(tmpDir, stateScript, ['init', 'tdd-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'tdd-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('tdd_mode: null');
  }, 20_000);

  it('initializes tdd_mode as direct for hotfix workflow', async () => {
    const result = runBash(tmpDir, stateScript, ['init', 'tdd-hotfix', 'hotfix']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'tdd-hotfix', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('tdd_mode: direct');
  }, 20_000);

  it('initializes context_compression as off by default', async () => {
    const result = runBash(tmpDir, stateScript, ['init', 'context-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'context-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('context_compression: off');
  }, 20_000);

  it('snapshots beta context compression from .comet/config.yaml when initializing a change', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'context_compression: beta\n');

    const result = runBash(tmpDir, stateScript, ['init', 'context-beta', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'context-beta', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('context_compression: beta');
  }, 20_000);

  it('lets COMET_CONTEXT_COMPRESSION override the project context compression default', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'context_compression: beta\n');

    const result = runBash(tmpDir, stateScript, ['init', 'context-env', 'full'], {
      COMET_CONTEXT_COMPRESSION: 'off',
    });
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'context-env', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('context_compression: off');
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

  it('initializes auto_transition from .comet/config.yaml when set to false', async () => {
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      'context_compression: off\nauto_transition: false\n',
    );

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

  it('sets auto_transition to false and rejects invalid auto_transition values', async () => {
    await createChange(
      tmpDir,
      'auto-transition-set',
      [
        'workflow: full',
        'phase: design',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
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

    const set = runBash(tmpDir, stateScript, [
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

    expect(set.status).toBe(0);
    expect(get.stdout.trim()).toBe('false');
    expect(setInvalid.status).not.toBe(0);
    expect(setInvalid.stderr).toContain('Invalid value');
  }, 20_000);

  it('next resolves auto for full workflow when auto_transition is true', async () => {
    await createChange(
      tmpDir,
      'next-auto-verify',
      ['workflow: full', 'phase: verify', 'auto_transition: true', 'archived: false', ''].join(
        '\n',
      ),
    );

    const result = runBash(tmpDir, stateScript, ['next', 'next-auto-verify']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NEXT: auto');
    expect(result.stdout).toContain('SKILL: comet-verify');
  }, 20_000);

  it('next resolves manual with hint when auto_transition is false', async () => {
    await createChange(
      tmpDir,
      'next-manual-build',
      ['workflow: full', 'phase: build', 'auto_transition: false', 'archived: false', ''].join(
        '\n',
      ),
    );

    const result = runBash(tmpDir, stateScript, ['next', 'next-manual-build']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NEXT: manual');
    expect(result.stdout).toContain('SKILL: comet-build');
    expect(result.stdout).toContain('HINT:');
  }, 20_000);

  it('next maps hotfix and tweak workflows to their preset skills in build phase', async () => {
    await createChange(
      tmpDir,
      'next-hotfix-build',
      ['workflow: hotfix', 'phase: build', 'auto_transition: true', 'archived: false', ''].join(
        '\n',
      ),
    );
    await createChange(
      tmpDir,
      'next-tweak-build',
      ['workflow: tweak', 'phase: build', 'auto_transition: true', 'archived: false', ''].join(
        '\n',
      ),
    );

    const hotfix = runBash(tmpDir, stateScript, ['next', 'next-hotfix-build']);
    const tweak = runBash(tmpDir, stateScript, ['next', 'next-tweak-build']);

    expect(hotfix.stdout).toContain('SKILL: comet-hotfix');
    expect(tweak.stdout).toContain('SKILL: comet-tweak');
  }, 20_000);

  it('next reports done for an archived change', async () => {
    await createChange(
      tmpDir,
      'next-done',
      ['workflow: full', 'phase: archive', 'auto_transition: true', 'archived: true', ''].join(
        '\n',
      ),
    );

    const result = runBash(tmpDir, stateScript, ['next', 'next-done']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NEXT: done');
    expect(result.stdout).not.toContain('SKILL:');
  }, 20_000);

  it('next maps each non-build phase to the owning skill', async () => {
    await createChange(
      tmpDir,
      'next-design',
      ['workflow: full', 'phase: design', 'auto_transition: true', 'archived: false', ''].join(
        '\n',
      ),
    );
    await createChange(
      tmpDir,
      'next-archive',
      ['workflow: full', 'phase: archive', 'auto_transition: true', 'archived: false', ''].join(
        '\n',
      ),
    );

    const design = runBash(tmpDir, stateScript, ['next', 'next-design']);
    const archive = runBash(tmpDir, stateScript, ['next', 'next-archive']);

    expect(design.stdout).toContain('SKILL: comet-design');
    expect(archive.stdout).toContain('SKILL: comet-archive');
  }, 20_000);

  it('next exits non-zero when .comet.yaml is missing', async () => {
    const result = runBash(tmpDir, stateScript, ['next', 'next-missing']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('.comet.yaml not found');
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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
        'tdd_mode: null',
        'isolation: null',
        'verify_mode: null',
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

  it('generates a beta spec projection handoff with verbatim spec content', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'beta-context',
      [
        'workflow: full',
        'phase: design',
        'context_compression: beta',
        'build_mode: null',
        'build_pause: null',
        'tdd_mode: null',
        'isolation: null',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      '- [ ] build beta context\n',
    );
    const specContent = [
      '## 新增需求',
      '',
      '### 需求: 保留验收覆盖',
      '实现必须确保每个场景在压缩上下文中可见。',
      '',
      '#### 场景: beta 投影包含场景',
      '- 当 beta handoff 生成时',
      '- 则 场景标题出现在投影中',
      '- 并且 中文内容完整保留',
      '',
    ].join('\n');
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'beta-context', 'specs', 'capability', 'spec.md'),
      specContent,
    );

    const handoff = runBash(tmpDir, handoffScript, ['beta-context', 'design', '--write']);
    const contextPath = runBash(tmpDir, stateScript, [
      'get',
      'beta-context',
      'handoff_context',
    ]).stdout.trim();

    expect(handoff.status).toBe(0);
    expect(contextPath).toBe('openspec/changes/beta-context/.comet/handoff/spec-context.json');

    const contextMarkdown = await fs.readFile(
      path.join(
        tmpDir,
        'openspec',
        'changes',
        'beta-context',
        '.comet',
        'handoff',
        'spec-context.md',
      ),
      'utf-8',
    );
    expect(contextMarkdown).toContain('Mode: beta');
    expect(contextMarkdown).toContain('Generated-by: comet-handoff.sh');
    // Verbatim projection: ALL spec content must appear (Chinese, non-keyword steps, etc.)
    expect(contextMarkdown).toContain('### 需求: 保留验收覆盖');
    expect(contextMarkdown).toContain('#### 场景: beta 投影包含场景');
    expect(contextMarkdown).toContain('实现必须确保每个场景在压缩上下文中可见。');
    expect(contextMarkdown).toContain('- 当 beta handoff 生成时');
    expect(contextMarkdown).toContain('- 并且 中文内容完整保留');

    // JSON should have files array with role field
    const contextJson = await fs.readFile(
      path.join(
        tmpDir,
        'openspec',
        'changes',
        'beta-context',
        '.comet',
        'handoff',
        'spec-context.json',
      ),
      'utf-8',
    );
    expect(contextJson).toContain('"role": "spec"');
    expect(contextJson).toContain('"role": "supporting"');

    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'beta-design.md'),
      [
        '---',
        'comet_change: beta-context',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
      ].join('\n'),
    );
    runBash(tmpDir, stateScript, [
      'set',
      'beta-context',
      'design_doc',
      'docs/superpowers/specs/beta-design.md',
    ]);

    const result = runBash(tmpDir, guardScript, ['beta-context', 'design']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] design handoff context exists');
    expect(result.stderr).toContain('[PASS] design handoff markdown is traceable');
    expect(result.stderr).toContain('[PASS] beta spec-context.json is structurally valid');
  }, 20_000);

  it('blocks beta design exit when spec-context.json is structurally invalid', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'beta-bad-json',
      [
        'workflow: full',
        'phase: design',
        'context_compression: beta',
        'build_mode: null',
        'build_pause: null',
        'tdd_mode: null',
        'isolation: null',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      '- [ ] build beta context\n',
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'beta-bad-json', 'specs', 'capability', 'spec.md'),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Keep headings complete',
        '',
        '#### Scenario: required scenario',
        '- **WHEN** guard checks beta projection',
        '- **THEN** it detects missing coverage',
        '',
      ].join('\n'),
    );

    const handoff = runBash(tmpDir, handoffScript, ['beta-bad-json', 'design', '--write']);
    expect(handoff.status).toBe(0);

    // Corrupt the JSON by removing required fields
    const jsonPath = path.join(
      tmpDir,
      'openspec',
      'changes',
      'beta-bad-json',
      '.comet',
      'handoff',
      'spec-context.json',
    );
    await fs.writeFile(jsonPath, '{ "broken": true }\n');

    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'beta-bad-json-design.md'),
      [
        '---',
        'comet_change: beta-bad-json',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
      ].join('\n'),
    );
    runBash(tmpDir, stateScript, [
      'set',
      'beta-bad-json',
      'design_doc',
      'docs/superpowers/specs/beta-bad-json-design.md',
    ]);

    const result = runBash(tmpDir, guardScript, ['beta-bad-json', 'design']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] beta spec-context.json is structurally valid');
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
        'tdd_mode: null',
        'isolation: null',
        'verify_mode: null',
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
        'tdd_mode: null',
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
        'tdd_mode: null',
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

  it('warns when --full is passed in beta mode', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'beta-full-warn',
      [
        'workflow: full',
        'phase: design',
        'context_compression: beta',
        'build_mode: null',
        'build_pause: null',
        'tdd_mode: null',
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

    const handoff = runBash(tmpDir, handoffScript, [
      'beta-full-warn',
      'design',
      '--write',
      '--full',
    ]);

    expect(handoff.status).toBe(0);
    expect(handoff.stderr).toContain('--full is ignored in beta mode');

    // Should still generate spec-context.* (beta files), not design-context.* (full files)
    const contextPath = runBash(tmpDir, stateScript, [
      'get',
      'beta-full-warn',
      'handoff_context',
    ]).stdout.trim();
    expect(contextPath).toBe('openspec/changes/beta-full-warn/.comet/handoff/spec-context.json');
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
        'tdd_mode: null',
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
        'tdd_mode: null',
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

  it('--hash-only outputs context hash without generating handoff files', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    await createChange(
      tmpDir,
      'hash-only-test',
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'tdd_mode: null',
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

    // Generate a normal handoff first to get the expected hash
    const normalResult = runBash(tmpDir, handoffScript, ['hash-only-test', 'design', '--write']);
    expect(normalResult.status).toBe(0);
    const normalHash = runBash(tmpDir, stateScript, ['get', 'hash-only-test', 'handoff_hash']);
    const expectedHash = normalHash.stdout.trim();

    // Remove handoff files to prove --hash-only does not regenerate them
    const handoffDir = path.join(
      tmpDir,
      'openspec',
      'changes',
      'hash-only-test',
      '.comet',
      'handoff',
    );
    await fs.rm(handoffDir, { recursive: true, force: true });

    const hashOnlyResult = runBash(tmpDir, handoffScript, ['hash-only-test', '--hash-only']);
    expect(hashOnlyResult.status).toBe(0);
    expect(hashOnlyResult.stdout.trim()).toBe(expectedHash);

    // Confirm handoff files were NOT regenerated
    expect(
      await fs.access(handoffDir).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  }, 20_000);

  it('--hash-only fails for non-existent change', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    const result = runBash(tmpDir, handoffScript, ['no-such-change', '--hash-only']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('change directory not found');
  }, 20_000);

  it('--hash-only fails when required files are missing', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.sh');
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'hash-missing-files');
    await fs.mkdir(changeDir, { recursive: true });
    await writeFile(
      path.join(changeDir, '.comet.yaml'),
      [
        'workflow: full',
        'phase: design',
        'build_mode: null',
        'build_pause: null',
        'tdd_mode: null',
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
    await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
    // design.md and tasks.md intentionally omitted

    const result = runBash(tmpDir, handoffScript, ['hash-missing-files', '--hash-only']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required file missing or empty');
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
        'tdd_mode: null',
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
        'tdd_mode: null',
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

  it('blocks build completion until tdd_mode is selected for full workflow', async () => {
    await createChange(
      tmpDir,
      'missing-tdd-mode',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      '- [x] done\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const guard = runBash(tmpDir, guardScript, ['missing-tdd-mode', 'build']);
    const transition = runBash(tmpDir, stateScript, [
      'transition',
      'missing-tdd-mode',
      'build-complete',
    ]);

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('[FAIL] tdd_mode selected');
    expect(guard.stderr).toContain('tdd_mode must be tdd or direct');
    expect(transition.status).not.toBe(0);
    expect(transition.stderr).toContain('tdd_mode must be selected');
  }, 20_000);

  it('allows hotfix to bypass tdd_mode check', async () => {
    await createChange(
      tmpDir,
      'hotfix-no-tdd',
      [
        'workflow: hotfix',
        'phase: build',
        'build_mode: direct',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'isolation: branch',
        'verify_mode: light',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      '- [x] done\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['hotfix-no-tdd', 'build']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] tdd_mode selected');
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
        'tdd_mode: null',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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

  it('rejects invalid subagent_dispatch values during schema validation', async () => {
    await createChange(
      tmpDir,
      'invalid-subagent-dispatch',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: fake',
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, guardScript, ['invalid-subagent-dispatch', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("subagent_dispatch='fake' is not valid");
    expect(result.stderr).toContain('FATAL: .comet.yaml schema validation failed');
  }, 20_000);

  it('rejects invalid tdd_mode values during schema validation', async () => {
    await createChange(
      tmpDir,
      'invalid-tdd-mode',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: always',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, guardScript, ['invalid-tdd-mode', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tdd_mode='always' is not valid");
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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

  it('rejects unchecked Superpowers plan tasks in the build guard check', async () => {
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'plans', 'plan-with-pending-task.md'),
      ['# Plan', '', '- [x] completed task', '- [ ] pending plan task'].join('\n'),
    );
    await createChange(
      tmpDir,
      'unfinished-plan-tasks',
      [
        'workflow: full',
        'phase: build',
        'build_mode: subagent-driven-development',
        'build_pause: null',
        'subagent_dispatch: confirmed',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: docs/superpowers/plans/plan-with-pending-task.md',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      ['- [x] completed task'].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const probeScript = path.join(tmpDir, 'scripts', 'probe-plan-tasks.sh');
    await writeFile(
      probeScript,
      [
        '#!/bin/bash',
        'set -euo pipefail',
        'export COMET_GUARD_SOURCE_ONLY=1',
        'CHANGE=unfinished-plan-tasks',
        'CHANGE_DIR=openspec/changes/unfinished-plan-tasks',
        '. ./scripts/comet-guard.sh',
        'plan_tasks_all_done',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, probeScript);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('pending plan task');
    expect(result.stderr).toContain('Next: check off corresponding completed plan tasks');
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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
        'tdd_mode: direct',
        'isolation: branch',
        'verify_mode: null',
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

  it('rejects subagent build mode without confirmed background dispatch', async () => {
    await createChange(
      tmpDir,
      'subagent-unconfirmed',
      [
        'workflow: full',
        'phase: build',
        'build_mode: subagent-driven-development',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      '- [x] done\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const guard = runBash(tmpDir, guardScript, ['subagent-unconfirmed', 'build']);
    const transition = runBash(tmpDir, stateScript, [
      'transition',
      'subagent-unconfirmed',
      'build-complete',
    ]);

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('[FAIL] subagent dispatch confirmed');
    expect(guard.stderr).toContain('subagent_dispatch must be confirmed');
    expect(transition.status).not.toBe(0);
    expect(transition.stderr).toContain('subagent_dispatch must be confirmed');
  }, 20_000);

  it('allows subagent build mode when background dispatch is confirmed', async () => {
    await createChange(
      tmpDir,
      'subagent-confirmed',
      [
        'workflow: full',
        'phase: build',
        'build_mode: subagent-driven-development',
        'build_pause: null',
        'subagent_dispatch: confirmed',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      '- [x] done\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runBash(tmpDir, guardScript, ['subagent-confirmed', 'build']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] subagent dispatch confirmed');
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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
    await writeFile(fakeBash, ['#!/bin/sh', 'echo "bad WSL bash" >&2', 'exit 127', ''].join('\n'));
    await fs.chmod(fakeBash, 0o755);
    await createChange(
      tmpDir,
      'nested-bash',
      [
        'workflow: full',
        'phase: open',
        'build_mode: null',
        'build_pause: null',
        'tdd_mode: null',
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

    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          'COMET_BASH="/bin/bash"',
          `PATH="${toBashPath(fakeBin)}:$PATH"`,
          'export COMET_BASH PATH',
          `/bin/bash "${toBashPath(guardScript)}" nested-bash open --apply`,
        ].join('; '),
      ],
      {
        cwd: tmpDir,
        encoding: 'utf-8',
      },
    );
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: full',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: light',
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
    const { fakeOpenSpec, logFile } = await createFakeOpenSpecArchive(tmpDir);
    await createChange(
      tmpDir,
      'ready-to-archive',
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: full',
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
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Added capability',
        'The system SHALL expose the added capability.',
        '',
        '#### Scenario: Added behavior',
        '- **WHEN** the archive runs',
        '- **THEN** the main spec is updated',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, archiveScript, ['ready-to-archive'], {
      COMET_OPENSPEC: toBashPath(fakeOpenSpec),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Archive complete. 7/7 steps succeeded.');
    await expect(fs.readFile(logFile, 'utf-8')).resolves.toBe('archive ready-to-archive --yes\n');
  }, 20_000);

  it('merges delta specs without copying delta-only requirement headings into main specs', async () => {
    const archiveScript = path.join(tmpDir, 'scripts', 'comet-archive.sh');
    const { fakeOpenSpec } = await createFakeOpenSpecArchive(tmpDir);
    await createChange(
      tmpDir,
      'merge-delta-spec',
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: full',
        'design_doc: null',
        'plan: null',
        'verify_result: pass',
        'verification_report: docs/superpowers/reports/merge.md',
        'branch_status: handled',
        'verified_at: 2026-05-21',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'reports', 'merge.md'), 'PASS\n');
    await writeFile(
      path.join(tmpDir, 'openspec', 'specs', 'capability', 'spec.md'),
      [
        '# Capability Specification',
        '',
        '## Purpose',
        'Existing stable spec.',
        '',
        '## Requirements',
        '',
        '### Requirement: Existing behavior',
        'The system SHALL preserve existing behavior.',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(
        tmpDir,
        'openspec',
        'changes',
        'merge-delta-spec',
        'specs',
        'capability',
        'spec.md',
      ),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: New behavior',
        'The system SHALL merge new behavior into the stable spec.',
        '',
        '#### Scenario: Delta merge',
        '- **WHEN** the change is archived',
        '- **THEN** the stable spec contains the new behavior',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, archiveScript, ['merge-delta-spec'], {
      COMET_OPENSPEC: toBashPath(fakeOpenSpec),
    });
    const mainSpec = await fs.readFile(
      path.join(tmpDir, 'openspec', 'specs', 'capability', 'spec.md'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(mainSpec).toContain('### Requirement: Existing behavior');
    expect(mainSpec).toContain('### Requirement: New behavior');
    expect(mainSpec).not.toContain('## ADDED Requirements');
    expect(mainSpec).not.toContain('## MODIFIED Requirements');
    expect(mainSpec).not.toContain('## REMOVED Requirements');
    expect(mainSpec).not.toContain('## RENAMED Requirements');
  }, 20_000);

  it('annotates archive metadata with the actual OpenSpec archive directory name', async () => {
    const archiveScript = path.join(tmpDir, 'scripts', 'comet-archive.sh');
    const { fakeOpenSpec } = await createFakeOpenSpecArchive(tmpDir, "printf '2026-05-20'");
    await createChange(
      tmpDir,
      'utc-archive-date',
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: full',
        'design_doc: docs/superpowers/specs/utc-design.md',
        'plan: docs/superpowers/plans/utc-plan.md',
        'verify_result: pass',
        'verification_report: docs/superpowers/reports/utc.md',
        'branch_status: handled',
        'verified_at: 2026-05-21',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'specs', 'utc-design.md'), 'design\n');
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'plans', 'utc-plan.md'), 'plan\n');
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'reports', 'utc.md'), 'PASS\n');

    const result = runBash(tmpDir, archiveScript, ['utc-archive-date'], {
      COMET_OPENSPEC: toBashPath(fakeOpenSpec),
    });
    const design = await fs.readFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'utc-design.md'),
      'utf-8',
    );
    const plan = await fs.readFile(
      path.join(tmpDir, 'docs', 'superpowers', 'plans', 'utc-plan.md'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(design).toContain('archived-with: 2026-05-20-utc-archive-date');
    expect(plan).toContain('archived-with: 2026-05-20-utc-archive-date');
    await expect(
      fs.stat(
        path.join(
          tmpDir,
          'openspec',
          'changes',
          'archive',
          '2026-05-20-utc-archive-date',
          '.comet.yaml',
        ),
      ),
    ).resolves.toBeDefined();
  }, 20_000);

  it('uses plan base-ref to scale verification after changes have been committed', async () => {
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
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

  it('transitions full workflow from open to design', async () => {
    await createChange(
      tmpDir,
      'full-change',
      [
        'workflow: full',
        'phase: open',
        'build_mode: null',
        'build_pause: null',
        'tdd_mode: null',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: light',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: full',
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

  it('reopens archive phase for adjustment or re-verification before archiving', async () => {
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'reports', 'archive-reopen.md'),
      'PASS\n',
    );
    await createChange(
      tmpDir,
      'archive-reopen',
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: full',
        'design_doc: null',
        'plan: null',
        'verify_result: pass',
        'verification_report: docs/superpowers/reports/archive-reopen.md',
        'branch_status: handled',
        'verified_at: 2026-06-05',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, stateScript, ['transition', 'archive-reopen', 'archive-reopen']);
    const phase = runBash(tmpDir, stateScript, ['get', 'archive-reopen', 'phase']);
    const verifyResult = runBash(tmpDir, stateScript, ['get', 'archive-reopen', 'verify_result']);
    const verifiedAt = runBash(tmpDir, stateScript, ['get', 'archive-reopen', 'verified_at']);
    const report = runBash(tmpDir, stateScript, ['get', 'archive-reopen', 'verification_report']);
    const branchStatus = runBash(tmpDir, stateScript, ['get', 'archive-reopen', 'branch_status']);

    expect(result.status).toBe(0);
    expect(phase.stdout.trim()).toBe('verify');
    expect(verifyResult.stdout.trim()).toBe('pending');
    expect(verifiedAt.stdout.trim()).toBe('null');
    expect(report.stdout.trim()).toBe('docs/superpowers/reports/archive-reopen.md');
    expect(branchStatus.stdout.trim()).toBe('handled');
  }, 20_000);

  it('rejects archive-reopen after the change is already archived', async () => {
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'reports', 'already-archived.md'),
      'PASS\n',
    );
    await createChange(
      tmpDir,
      'already-archived',
      [
        'workflow: full',
        'phase: archive',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: full',
        'design_doc: null',
        'plan: null',
        'verify_result: pass',
        'verification_report: docs/superpowers/reports/already-archived.md',
        'branch_status: handled',
        'verified_at: 2026-06-05',
        'archived: true',
        '',
      ].join('\n'),
    );

    const result = runBash(tmpDir, stateScript, [
      'transition',
      'already-archived',
      'archive-reopen',
    ]);
    const phase = runBash(tmpDir, stateScript, ['get', 'already-archived', 'phase']);
    const verifyResult = runBash(tmpDir, stateScript, ['get', 'already-archived', 'verify_result']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already archived');
    expect(phase.stdout.trim()).toBe('archive');
    expect(verifyResult.stdout.trim()).toBe('pass');
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: light',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: light',
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
        'tdd_mode: null',
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
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: full',
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
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
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
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
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
      expect(result.stdout).toContain("current platform's user confirmation mechanism");
    });

    it('outputs plan-ready pause recovery context for build phase', async () => {
      await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'plans', 'pause-plan.md'), 'plan\n');
      await createChange(
        tmpDir,
        'recover-plan-ready',
        [
          'workflow: full',
          'phase: build',
          'build_mode: null',
          'build_pause: plan-ready',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
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

    it('outputs subagent dispatch guidance when recovering build phase with pending tasks', async () => {
      await createChange(
        tmpDir,
        'recover-subagent',
        [
          'workflow: full',
          'phase: build',
          'build_mode: subagent-driven-development',
          'build_pause: null',
          'subagent_dispatch: confirmed',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: null',
          'plan: docs/superpowers/plans/subagent-plan.md',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        ['- [x] done task', '- [ ] pending task'].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-subagent',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('build_mode: DONE (subagent-driven-development)');
      expect(result.stdout).toContain('Tasks: 1/2 done, 1 pending');
      expect(result.stdout).toContain(
        'inspect the first unchecked task against recent git history/diff',
      );
      expect(result.stdout).toContain('dispatch a real background subagent');
      expect(result.stdout).toContain(
        'Do not execute the pending task directly in the main window',
      );
    });

    it('routes build recovery to additional unchecked Superpowers plan tasks', async () => {
      // Scenario: OpenSpec has 2 tasks (both done), Superpowers plan adds a 3rd task (not done)
      // This is valid plan enhancement but blocks leaving build until all plan tasks are checked
      await writeFile(
        path.join(tmpDir, 'docs', 'superpowers', 'plans', 'plan-with-additions.md'),
        [
          '# Plan',
          '',
          '- [x] task from OpenSpec 1',
          '- [x] task from OpenSpec 2',
          '- [ ] additional task added in plan',
        ].join('\n'),
      );
      await createChange(
        tmpDir,
        'recover-plan-additions',
        [
          'workflow: full',
          'phase: build',
          'build_mode: subagent-driven-development',
          'build_pause: null',
          'subagent_dispatch: confirmed',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: null',
          'plan: docs/superpowers/plans/plan-with-additions.md',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        ['- [x] task 1', '- [x] task 2'].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-plan-additions',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Tasks: 2/2 done, 0 pending');
      expect(result.stdout).toContain('Plan tasks: 2/3 done, 1 pending');
      expect(result.stdout).toContain('first unchecked Superpowers plan task');
      expect(result.stdout).toContain('dispatch a real background subagent');
    });

    it('requires subagent dispatch confirmation when recovering subagent build mode', async () => {
      await createChange(
        tmpDir,
        'recover-subagent-unconfirmed',
        [
          'workflow: full',
          'phase: build',
          'build_mode: subagent-driven-development',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: null',
          'plan: docs/superpowers/plans/subagent-plan.md',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        ['- [x] done task', '- [ ] pending task'].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-subagent-unconfirmed',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('subagent_dispatch: PENDING');
      expect(result.stdout).toContain('Subagent dispatch is not confirmed');
      expect(result.stdout).toContain('set subagent_dispatch to confirmed');
      expect(result.stdout).toContain('set build_mode to executing-plans');
    });

    it('keeps subagent dispatch guidance when plan-ready pause is stale', async () => {
      await writeFile(
        path.join(tmpDir, 'docs', 'superpowers', 'plans', 'stale-subagent-plan.md'),
        'plan\n',
      );
      await createChange(
        tmpDir,
        'recover-stale-subagent',
        [
          'workflow: full',
          'phase: build',
          'build_mode: subagent-driven-development',
          'build_pause: plan-ready',
          'subagent_dispatch: confirmed',
          'tdd_mode: null',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: null',
          'plan: docs/superpowers/plans/stale-subagent-plan.md',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        ['- [x] done task', '- [ ] pending task'].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-stale-subagent',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Plan-ready pause is stale');
      expect(result.stdout).toContain('dispatch a real background subagent');
      expect(result.stdout).toContain(
        'Do not execute the pending task directly in the main window',
      );
    });

    it('suggests running guard when stale plan-ready pause has all tasks done', async () => {
      await writeFile(
        path.join(tmpDir, 'docs', 'superpowers', 'plans', 'stale-all-done-plan.md'),
        'plan\n',
      );
      await createChange(
        tmpDir,
        'recover-stale-all-done',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: plan-ready',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: null',
          'plan: docs/superpowers/plans/stale-all-done-plan.md',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        ['- [x] done task'].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'check',
        'recover-stale-all-done',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('all tasks are done');
      expect(result.stdout).toContain('run guard to transition to verify');
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
          'tdd_mode: null',
          'isolation: branch',
          'verify_mode: full',
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
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
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
          'tdd_mode: null',
          'isolation: branch',
          'verify_mode: null',
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
          'tdd_mode: direct',
          'isolation: branch',
          'verify_mode: null',
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
          'tdd_mode: null',
          'isolation: branch',
          'verify_mode: full',
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
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
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

  // --- Review fix tests ---

  describe('review fix: build-complete conditional reset', () => {
    it('preserves verification_report on re-verify cycle (H1)', async () => {
      await createChange(
        tmpDir,
        'reverify-test',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: light',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: fail',
          'verification_report: docs/report.md',
          'branch_status: handled',
          'created_at: 2026-06-04',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'docs', 'report.md'), 'verify report');

      const result = runBash(tmpDir, stateScript, [
        'transition',
        'reverify-test',
        'build-complete',
      ]);

      expect(result.status).toBe(0);
      const yaml = await fs.readFile(
        path.join(tmpDir, 'openspec', 'changes', 'reverify-test', '.comet.yaml'),
        'utf-8',
      );
      expect(yaml).toContain('verify_result: pending');
      expect(yaml).toContain('verification_report: docs/report.md');
      expect(yaml).toContain('branch_status: handled');
    });
  });

  describe('review fix: verify-fail preserves branch_status', () => {
    it('does not reset branch_status on verify-fail (H6)', async () => {
      await createChange(
        tmpDir,
        'branch-preserve',
        [
          'workflow: full',
          'phase: verify',
          'build_mode: executing-plans',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: light',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: handled',
          'created_at: 2026-06-04',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, ['transition', 'branch-preserve', 'verify-fail']);

      expect(result.status).toBe(0);
      const yaml = await fs.readFile(
        path.join(tmpDir, 'openspec', 'changes', 'branch-preserve', '.comet.yaml'),
        'utf-8',
      );
      expect(yaml).toContain('verify_result: fail');
      expect(yaml).toContain('phase: build');
      expect(yaml).toContain('branch_status: handled');
    });
  });

  describe('review fix: path traversal prevention', () => {
    it('rejects design_doc with path traversal (H5)', async () => {
      await createChange(
        tmpDir,
        'path-traversal',
        [
          'workflow: full',
          'phase: open',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-04',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, stateScript, [
        'set',
        'path-traversal',
        'design_doc',
        '../../etc/passwd',
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("cannot contain '..'");
    });
  });

  describe('review fix: command injection prevention', () => {
    it('rejects build_command with shell metacharacters (C3)', async () => {
      const changeDir = path.join(tmpDir, 'openspec', 'changes', 'cmd-inject');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, '.comet.yaml'),
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: null',
          'subagent_dispatch: confirmed',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-04',
          'verified_at: null',
          'archived: false',
          'build_command: npm run build; rm -rf /',
          '',
        ].join('\n'),
      );
      await fs.writeFile(path.join(changeDir, 'proposal.md'), 'p');
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      // No COMET_SKIP_BUILD — run_command_string should reject before executing
      const result = runBash(tmpDir, guardScript, ['cmd-inject', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('shell metacharacters');
    }, 20_000);
  });

  describe('review fix: design guard requires design_doc for full workflow', () => {
    it('fails design guard for full workflow without design_doc (C2)', async () => {
      await createChange(
        tmpDir,
        'no-designdoc',
        [
          'workflow: full',
          'phase: design',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-04',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const result = runBash(tmpDir, guardScript, ['no-designdoc', 'design']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('[FAIL] design_doc is recorded for full workflow');
    }, 20_000);
  });

  describe('comet-hook-guard.sh — phase write guard', () => {
    it('allows all writes when no active comet change exists', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'foo.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('allows writes to openspec/ in design phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        [
          'workflow: full',
          'phase: design',
          'context_compression: off',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'base_ref: null',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-06',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const targetFile = path.join(tmpDir, 'openspec', 'changes', 'test-hook', 'proposal.md');
      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('allows writes to docs/superpowers/ in design phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        [
          'workflow: full',
          'phase: design',
          'context_compression: off',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'base_ref: null',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-06',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const docsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      await fs.mkdir(docsDir, { recursive: true });
      const targetFile = path.join(docsDir, '2026-06-06-test-design.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('blocks source code writes in design phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        [
          'workflow: full',
          'phase: design',
          'context_compression: off',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'base_ref: null',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-06',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'index.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('BLOCKED');
      expect(result.stderr).toContain('design');
    }, 20_000);

    it('blocks source code writes in open phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        [
          'workflow: full',
          'phase: open',
          'context_compression: off',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'base_ref: null',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-06',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'app.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('open');
    }, 20_000);

    it('allows source code writes in build phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        [
          'workflow: full',
          'phase: build',
          'context_compression: off',
          'build_mode: executing-plans',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: null',
          'base_ref: null',
          'design_doc: docs/superpowers/specs/test.md',
          'plan: docs/superpowers/plans/test.md',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-06',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'feature.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('allows source code writes in verify phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        [
          'workflow: full',
          'phase: verify',
          'context_compression: off',
          'build_mode: executing-plans',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: light',
          'base_ref: null',
          'design_doc: docs/superpowers/specs/test.md',
          'plan: docs/superpowers/plans/test.md',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-06',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'fix.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('blocks source code writes in archive phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        [
          'workflow: full',
          'phase: archive',
          'context_compression: off',
          'build_mode: executing-plans',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: full',
          'base_ref: null',
          'design_doc: docs/superpowers/specs/test.md',
          'plan: docs/superpowers/plans/test.md',
          'verify_result: pass',
          'verification_report: report.md',
          'branch_status: handled',
          'created_at: 2026-06-06',
          'verified_at: 2026-06-06',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'extra.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('archive');
    }, 20_000);

    it('allows writes to .claude/ rules regardless of phase', async () => {
      await createChange(
        tmpDir,
        'test-hook',
        ['workflow: full', 'phase: design', 'context_compression: off', ''].join('\n'),
      );

      const claudeDir = path.join(tmpDir, '.claude', 'rules');
      await fs.mkdir(claudeDir, { recursive: true });
      const targetFile = path.join(claudeDir, 'custom.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('ignores archived changes and allows writes', async () => {
      const archiveDir = path.join(tmpDir, 'openspec', 'changes', 'archive');
      const changeDir = path.join(archiveDir, '2026-06-06-old-change');
      await fs.mkdir(changeDir, { recursive: true });
      await writeFile(
        path.join(changeDir, '.comet.yaml'),
        ['workflow: full', 'phase: archive', 'archived: true', ''].join('\n'),
      );
      await writeFile(path.join(changeDir, 'proposal.md'), 'old proposal\n');
      await writeFile(path.join(changeDir, 'design.md'), 'old design\n');
      await writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'free.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);
  });
});
