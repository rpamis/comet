import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const classicRuntimeRoot = path.resolve('assets', 'skills', 'comet', 'runtime', 'classic');
const classicSkillRoot = classicRuntimeRoot;

// Forward-slash absolute path — used for the fake OpenSpec shim (a bash script)
// and the COMET_OPENSPEC env var it is passed through, both of which need a
// POSIX-style path on every platform.
function posixPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function runNode(
  cwd: string,
  script: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {},
  timeout?: number,
) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
      ...env,
    },
    timeout,
  });
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function runHookGuard(cwd: string, script: string, stdin: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: 'utf8',
    input: stdin,
    env: {
      ...process.env,
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
      ...env,
    },
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

async function createFakeOpenSpecArchive(
  tmpDir: string,
  archiveDate = new Date().toISOString().slice(0, 10),
) {
  // Cross-platform fake `openspec archive` (Node, not bash) so the archive tests
  // run identically on macOS, Linux, and Windows. Returns `command` — the value
  // to assign to COMET_OPENSPEC — already shaped so the runtime's
  // `spawnSync(command, args, { shell: win32 })` invokes node on every platform.
  const binDir = path.join(tmpDir, 'fake-bin');
  await fs.mkdir(binDir, { recursive: true });
  const scriptPath = path.join(binDir, 'openspec-fake.mjs');
  const logFile = path.join(binDir, 'openspec-args.log');
  const absLog = logFile.replace(/\\/g, '/');
  const script = [
    '#!/usr/bin/env node',
    "import { promises as fs } from 'node:fs';",
    "import path from 'node:path';",
    `const LOG = ${JSON.stringify(absLog)};`,
    `const ARCHIVE_DATE = ${JSON.stringify(archiveDate)};`,
    'const exists = async (p) => fs.access(p).then(() => true).catch(() => false);',
    'function extractAdded(text) {',
    '  let out = ""; let inA = false;',
    '  for (const line of text.split(/\\r?\\n/)) {',
    "    if (line === '## ADDED Requirements') { inA = true; continue; }",
    '    if (/^## (MODIFIED|REMOVED|RENAMED) Requirements$/.test(line)) { inA = false; continue; }',
    '    if (inA) out += line + "\\n";',
    '  }',
    '  return out;',
    '}',
    'const args = process.argv.slice(2);',
    "await fs.writeFile(LOG, args.join(' ') + '\\n');",
    "if (args[0] !== 'archive') { console.error('unsupported openspec command: ' + (args[0] || '')); process.exit(1); }",
    'const change = args[1];',
    "const changeDir = path.join('openspec', 'changes', change);",
    "const archiveDir = path.join('openspec', 'changes', 'archive', ARCHIVE_DATE + '-' + change);",
    "const specsDir = path.join(changeDir, 'specs');",
    'if (await exists(specsDir)) {',
    '  for (const cap of (await fs.readdir(specsDir)).sort()) {',
    "    const delta = path.join(specsDir, cap, 'spec.md');",
    '    if (!(await exists(delta))) continue;',
    "    const main = path.join('openspec', 'specs', cap, 'spec.md');",
    '    await fs.mkdir(path.dirname(main), { recursive: true });',
    "    const base = (await exists(main)) ? await fs.readFile(main, 'utf8') : `# ${cap} Specification\\n\\n## Purpose\\nTBD\\n\\n## Requirements\\n`;",
    "    await fs.writeFile(main, base + extractAdded(await fs.readFile(delta, 'utf8')));",
    '  }',
    '}',
    'await fs.mkdir(path.dirname(archiveDir), { recursive: true });',
    'await fs.rename(changeDir, archiveDir);',
    "console.log('Change ' + change + ' archived as ' + ARCHIVE_DATE + '-' + change + '.');",
    '',
  ].join('\n');
  await fs.writeFile(scriptPath, script);
  let command: string;
  if (process.platform === 'win32') {
    // Runtime uses shell:true on Windows → cmd runs `node "<path>" archive change --yes`.
    command = `node "${scriptPath.replace(/\\/g, '/')}"`;
  } else {
    await fs.chmod(scriptPath, 0o755);
    command = scriptPath;
  }
  return { command, logFile };
}

describe('comet script contracts', () => {
  it('keeps all Classic command scripts as thin launchers for the shared runtime', async () => {
    const sources: Record<string, string> = {
      state: await fs.readFile(path.join(scriptsDir, 'comet-state.mjs'), 'utf-8'),
      validate: await fs.readFile(path.join(scriptsDir, 'comet-yaml-validate.mjs'), 'utf-8'),
      guard: await fs.readFile(path.join(scriptsDir, 'comet-guard.mjs'), 'utf-8'),
      handoff: await fs.readFile(path.join(scriptsDir, 'comet-handoff.mjs'), 'utf-8'),
      archive: await fs.readFile(path.join(scriptsDir, 'comet-archive.mjs'), 'utf-8'),
      'hook-guard': await fs.readFile(path.join(scriptsDir, 'comet-hook-guard.mjs'), 'utf-8'),
      intent: await fs.readFile(path.join(scriptsDir, 'comet-intent.mjs'), 'utf-8'),
      'resume-probe': await fs.readFile(path.join(scriptsDir, 'comet-resume-probe.mjs'), 'utf-8'),
    };

    await expect(fs.access(path.join(scriptsDir, 'comet-runtime.mjs'))).resolves.toBeUndefined();
    for (const [command, source] of Object.entries(sources)) {
      const cliCommand = command === 'hook-guard' ? 'hook-guard' : command;
      expect(source).toContain('#!/usr/bin/env node');
      expect(source).toContain("import { main } from './comet-runtime.mjs';");
      expect(source).toContain(`main([${JSON.stringify(cliCommand)}, ...process.argv.slice(2)])`);
      expect(source).not.toMatch(/\b(?:grep|awk|sed)\b/u);
    }
  });

  it('keeps comet-hook-guard blocked messages in English', async () => {
    const hookSource = await fs.readFile(
      path.resolve('domains', 'comet-classic', 'classic-hook-guard.ts'),
      'utf-8',
    );

    expect(hookSource).toContain('Current phase:');
    expect(hookSource).toContain('Target file:');
    expect(hookSource).toContain('does not allow source writes');
    // Diagnostics that surface to the hook must stay ASCII/English.
    expect(hookSource).not.toMatch(/[一-龥]/);
  });
});

describe('comet scripts', () => {
  let tmpDir: string;
  let guardScript: string;
  let stateScript: string;
  let validateScript: string;
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
      'comet-runtime.mjs',
      'comet-env.mjs',
      'comet-archive.mjs',
      'comet-guard.mjs',
      'comet-handoff.mjs',
      'comet-state.mjs',
      'comet-intent.mjs',
      'comet-yaml-validate.mjs',
      'comet-hook-guard.mjs',
      'comet-resume-probe.mjs',
    ]) {
      const content = await fs.readFile(path.join(scriptsDir, name), 'utf-8');
      const destination = path.join(tmpScriptsDir, name);
      await fs.writeFile(destination, content.replace(/\r\n/g, '\n'));
      await fs.chmod(destination, 0o755);
    }
    guardScript = path.join(tmpScriptsDir, 'comet-guard.mjs');
    stateScript = path.join(tmpScriptsDir, 'comet-state.mjs');
    validateScript = path.join(tmpScriptsDir, 'comet-yaml-validate.mjs');
    hookGuardScript = path.join(tmpScriptsDir, 'comet-hook-guard.mjs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('initializes a new change directory with workflow defaults', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'new-full-change', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'new-full-change', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('workflow: full');
    expect(yaml).toContain('language: en');
    expect(yaml).toContain('phase: open');
    expect(yaml).toContain('verification_report: null');
    expect(yaml).toContain('branch_status: pending');
  }, 20_000);

  it.each(['hotfix', 'tweak'])(
    'initializes %s in the current workspace without claiming branch isolation',
    async (workflow) => {
      const result = runNode(tmpDir, stateScript, ['init', `${workflow}-current`, workflow]);
      const yaml = await fs.readFile(
        path.join(tmpDir, 'openspec', 'changes', `${workflow}-current`, '.comet.yaml'),
        'utf8',
      );

      expect(result.status).toBe(0);
      expect(yaml).toContain('isolation: current');
    },
    20_000,
  );

  it('prints successful initialization to stdout so PowerShell does not surface NativeCommandError', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'powershell-friendly', 'full']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Initialized: openspec/changes/powershell-friendly/.comet.yaml (workflow=full)',
    );
    expect(result.stderr).toBe('');
  }, 20_000);

  it('keeps hook guard read-only when COMET_RUNTIME_CLASSIC_ROOT is configured', async () => {
    const init = runNode(tmpDir, stateScript, ['init', 'runtime-root', 'full'], {
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: '',
    });
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'runtime-root');
    const stateFile = path.join(changeDir, '.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');
    const targetFile = path.join(tmpDir, 'src', 'index.ts');
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile), {
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: '',
    });

    expect(init.status).toBe(0);
    expect(result.status).toBe(2);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
    await expect(fs.access(path.join(changeDir, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 20_000);

  it('keeps COMET_CLASSIC_SKILL_ROOT as a compatibility fallback', async () => {
    const init = runNode(tmpDir, stateScript, ['init', 'legacy-root', 'full'], {
      COMET_RUNTIME_CLASSIC_ROOT: '',
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
    });
    const targetFile = path.join(tmpDir, 'src', 'legacy.ts');
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile), {
      COMET_RUNTIME_CLASSIC_ROOT: '',
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
    });

    expect(init.status).toBe(0);
    expect(result.status).toBe(2);
  }, 20_000);

  it('falls back to the embedded Classic runtime package when installed script assets omit internal runtime files', async () => {
    const init = runNode(tmpDir, stateScript, ['init', 'embedded-runtime', 'full'], {
      COMET_RUNTIME_CLASSIC_ROOT: '',
      COMET_CLASSIC_SKILL_ROOT: '',
    });
    const result = runNode(tmpDir, guardScript, ['embedded-runtime', 'open'], {
      COMET_RUNTIME_CLASSIC_ROOT: '',
      COMET_CLASSIC_SKILL_ROOT: '',
    });

    expect(init.status).toBe(0);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('classic runtime package is not installed');
    const runState = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'embedded-runtime', '.comet', 'run-state.json'),
      'utf8',
    );
    expect(JSON.parse(runState)).toMatchObject({ skill: 'comet-classic' });
  }, 20_000);

  it('rejects change names that OpenSpec cannot archive later', async () => {
    const upper = runNode(tmpDir, stateScript, ['init', 'Upper_Name', 'full']);
    const underscore = runNode(tmpDir, stateScript, ['init', 'snake_case', 'full']);
    const datePrefixed = runNode(tmpDir, stateScript, ['init', '2026-05-21-change', 'full']);
    const valid = runNode(tmpDir, stateScript, ['init', 'kebab-case-name', 'full']);

    expect(upper.status).not.toBe(0);
    expect(upper.stderr).toContain('Invalid change name');
    expect(upper.stderr).toContain('kebab-case');
    expect(underscore.status).not.toBe(0);
    expect(underscore.stderr).toContain('Invalid change name');
    expect(datePrefixed.status).not.toBe(0);
    expect(datePrefixed.stderr).toContain('Invalid change name');
    expect(valid.status).toBe(0);
  }, 20_000);

  it('snapshots language from .comet/config.yaml when initializing a change', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: zh-CN\n');

    const result = runNode(tmpDir, stateScript, ['init', 'language-zh', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'language-zh', '.comet.yaml'),
      'utf-8',
    );
    const get = runNode(tmpDir, stateScript, ['get', 'language-zh', 'language']);

    expect(result.status).toBe(0);
    expect(yaml).toContain('language: zh-CN');
    expect(get.status).toBe(0);
    expect(get.stdout.trim()).toBe('zh-CN');
  }, 20_000);

  it('falls back to the global Comet language when project config is absent', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await writeFile(path.join(fakeHome, '.comet', 'config.yaml'), 'language: zh-CN\n');

    const result = runNode(tmpDir, stateScript, ['init', 'language-global-zh', 'full'], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    });
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'language-global-zh', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('language: zh-CN');
  }, 20_000);

  it('lets project language override the global Comet language', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await writeFile(path.join(fakeHome, '.comet', 'config.yaml'), 'language: zh-CN\n');
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: en\n');

    const result = runNode(tmpDir, stateScript, ['init', 'language-project-over-global', 'full'], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    });
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'language-project-over-global', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('language: en');
  }, 20_000);

  it('rejects an invalid global Comet language when project config is absent', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await writeFile(path.join(fakeHome, '.comet', 'config.yaml'), 'language: pirate\n');

    const result = runNode(tmpDir, stateScript, ['init', 'language-global-invalid', 'full'], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid language from ~/.comet/config.yaml: 'pirate'");
  }, 20_000);

  it('ignores an unrelated malformed field elsewhere in .comet/config.yaml', async () => {
    await writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      'language: en\nunrelated_field: [unterminated\n',
    );

    const result = runNode(tmpDir, stateScript, ['init', 'unrelated-malformed-field', 'full'], {});
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'unrelated-malformed-field', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('language: en');
  }, 20_000);

  it('rejects an explicit empty review_mode instead of silently defaulting', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'review_mode: ""\n');

    const result = runNode(tmpDir, stateScript, ['init', 'empty-review-mode', 'full'], {});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid review_mode: ''");
  }, 20_000);

  it('rejects zh as an invalid project language when initializing a change', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: zh\n');

    const result = runNode(tmpDir, stateScript, ['init', 'language-legacy-zh', 'full']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid language from .comet/config.yaml: 'zh'");
    expect(result.stderr).toContain('Valid values: en, zh-CN');
  }, 20_000);

  it('lets COMET_LANGUAGE override the project language default', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: zh-CN\n');

    const result = runNode(tmpDir, stateScript, ['init', 'language-env', 'full'], {
      COMET_LANGUAGE: 'en',
    });
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'language-env', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('language: en');
  }, 20_000);

  it('rejects invalid language from .comet/config.yaml when initializing a change', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: pirate\n');

    const result = runNode(tmpDir, stateScript, ['init', 'language-invalid', 'full']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid language from .comet/config.yaml: 'pirate'");
    expect(result.stderr).toContain('Valid values: en, zh-CN');
  }, 20_000);

  it('initializes build_pause as null for new changes', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'pause-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'pause-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('build_pause: null');
  }, 20_000);

  it('initializes subagent_dispatch as null for new changes', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'subagent-dispatch-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'subagent-dispatch-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('subagent_dispatch: null');
  }, 20_000);

  it('initializes tdd_mode as null for full workflow', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'tdd-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'tdd-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('tdd_mode: null');
  }, 20_000);

  it('initializes review_mode as standard for full workflow', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'review-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'review-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('review_mode: standard');
  }, 20_000);

  it('initializes review_mode as off for hotfix workflow', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'review-hotfix', 'hotfix']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'review-hotfix', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('review_mode: off');
  }, 20_000);

  it('initializes tdd_mode as direct for hotfix workflow', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'tdd-hotfix', 'hotfix']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'tdd-hotfix', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('tdd_mode: direct');
  }, 20_000);

  it('initializes context_compression as off by default', async () => {
    const result = runNode(tmpDir, stateScript, ['init', 'context-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'context-defaults', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('context_compression: off');
  }, 20_000);

  it('snapshots beta context compression from .comet/config.yaml when initializing a change', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'context_compression: beta\n');

    const result = runNode(tmpDir, stateScript, ['init', 'context-beta', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'context-beta', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('context_compression: beta');
  }, 20_000);

  it('snapshots review_mode from .comet/config.yaml when initializing a full change', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'review_mode: standard\n');

    const result = runNode(tmpDir, stateScript, ['init', 'review-standard', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'review-standard', '.comet.yaml'),
      'utf-8',
    );

    expect(result.status).toBe(0);
    expect(yaml).toContain('review_mode: standard');
  }, 20_000);

  it('rejects invalid review_mode from .comet/config.yaml when initializing a change', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'review_mode: noisy\n');

    const result = runNode(tmpDir, stateScript, ['init', 'review-invalid', 'full']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid review_mode: 'noisy'");
    expect(result.stderr).toContain('Valid values: off, standard, thorough');
  }, 20_000);

  it('lets COMET_CONTEXT_COMPRESSION override the project context compression default', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'context_compression: beta\n');

    const result = runNode(tmpDir, stateScript, ['init', 'context-env', 'full'], {
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
    const result = runNode(tmpDir, stateScript, ['init', 'auto-transition-defaults', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'auto-transition-defaults', '.comet.yaml'),
      'utf-8',
    );
    const get = runNode(tmpDir, stateScript, [
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

    const result = runNode(tmpDir, stateScript, ['init', 'auto-transition-config-false', 'full']);
    const yaml = await fs.readFile(
      path.join(tmpDir, 'openspec', 'changes', 'auto-transition-config-false', '.comet.yaml'),
      'utf-8',
    );
    const get = runNode(tmpDir, stateScript, [
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

    const set = runNode(tmpDir, stateScript, [
      'set',
      'auto-transition-set',
      'auto_transition',
      'false',
    ]);
    const get = runNode(tmpDir, stateScript, ['get', 'auto-transition-set', 'auto_transition']);
    const setInvalid = runNode(tmpDir, stateScript, [
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

  it('validates the language field in .comet.yaml', async () => {
    await createChange(
      tmpDir,
      'language-validate',
      [
        'workflow: full',
        'language: zh-CN',
        'phase: design',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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

    const valid = runNode(tmpDir, path.join(tmpDir, 'scripts', 'comet-yaml-validate.mjs'), [
      'language-validate',
    ]);
    const setInvalid = runNode(tmpDir, stateScript, [
      'set',
      'language-validate',
      'language',
      'pirate',
    ]);

    expect(valid.status).toBe(0);
    expect(setInvalid.status).not.toBe(0);
    expect(setInvalid.stderr).toContain("Invalid language from language: 'pirate'");
    expect(setInvalid.stderr).toContain('Valid values: en, zh-CN');
  }, 20_000);

  it('allows changing the language field between valid values', async () => {
    await createChange(
      tmpDir,
      'language-switch',
      [
        'workflow: full',
        'language: en',
        'phase: design',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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

    const set = runNode(tmpDir, stateScript, ['set', 'language-switch', 'language', 'zh-CN']);
    const get = runNode(tmpDir, stateScript, ['get', 'language-switch', 'language']);
    const valid = runNode(tmpDir, path.join(tmpDir, 'scripts', 'comet-yaml-validate.mjs'), [
      'language-switch',
    ]);

    expect(set.status).toBe(0);
    expect(get.stdout.trim()).toBe('zh-CN');
    expect(valid.status).toBe(0);
  }, 20_000);

  it('next resolves auto for full workflow when auto_transition is true', async () => {
    await createChange(
      tmpDir,
      'next-auto-verify',
      ['workflow: full', 'phase: verify', 'auto_transition: true', 'archived: false', ''].join(
        '\n',
      ),
    );

    const result = runNode(tmpDir, stateScript, ['next', 'next-auto-verify']);

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

    const result = runNode(tmpDir, stateScript, ['next', 'next-manual-build']);

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

    const hotfix = runNode(tmpDir, stateScript, ['next', 'next-hotfix-build']);
    const tweak = runNode(tmpDir, stateScript, ['next', 'next-tweak-build']);

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

    const result = runNode(tmpDir, stateScript, ['next', 'next-done']);

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

    const design = runNode(tmpDir, stateScript, ['next', 'next-design']);
    const archive = runNode(tmpDir, stateScript, ['next', 'next-archive']);

    expect(design.stdout).toContain('SKILL: comet-design');
    expect(archive.stdout).toContain('SKILL: comet-archive');
  }, 20_000);

  it('next exits non-zero when .comet.yaml is missing', async () => {
    const result = runNode(tmpDir, stateScript, ['next', 'next-missing']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('.comet.yaml not found');
  }, 20_000);

  it('task-checkoff verifies one uniquely checked task', async () => {
    const tasksFile = path.join(tmpDir, 'docs', 'plan.md');
    await writeFile(tasksFile, '- [x] Implement dispatch guard\n- [ ] Add docs\n');

    const result = runNode(tmpDir, stateScript, [
      'task-checkoff',
      'docs/plan.md',
      'Implement dispatch guard',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('TASK_CHECKOFF: PASS');
  }, 20_000);

  it('task-checkoff rejects an unchecked task', async () => {
    const tasksFile = path.join(tmpDir, 'docs', 'plan.md');
    await writeFile(tasksFile, '- [ ] Implement dispatch guard\n');

    const result = runNode(tmpDir, stateScript, [
      'task-checkoff',
      'docs/plan.md',
      'Implement dispatch guard',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('task is not checked');
  }, 20_000);

  it('task-checkoff rejects duplicate task text across checkbox states', async () => {
    const tasksFile = path.join(tmpDir, 'docs', 'plan.md');
    await writeFile(tasksFile, '- [x] Implement dispatch guard\n- [ ] Implement dispatch guard\n');

    const result = runNode(tmpDir, stateScript, [
      'task-checkoff',
      'docs/plan.md',
      'Implement dispatch guard',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('task text must appear exactly once');
  }, 20_000);

  it('task-checkoff rejects paths outside the repository', async () => {
    const result = runNode(tmpDir, stateScript, [
      'task-checkoff',
      '../outside.md',
      'Implement dispatch guard',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot contain '..'");
  }, 20_000);

  it('task-checkoff rejects missing task file', async () => {
    const result = runNode(tmpDir, stateScript, [
      'task-checkoff',
      'docs/nonexistent.md',
      'Some task',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Task file not found');
  }, 20_000);

  it('task-checkoff rejects empty task text', async () => {
    const tasksFile = path.join(tmpDir, 'docs', 'plan.md');
    await writeFile(tasksFile, '- [x] Implement dispatch guard\n');

    const result = runNode(tmpDir, stateScript, ['task-checkoff', 'docs/plan.md', '']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Task text cannot be empty');
  }, 20_000);

  it('task-checkoff rejects file with no checkbox lines', async () => {
    const tasksFile = path.join(tmpDir, 'docs', 'empty.md');
    await writeFile(tasksFile, '# Plan\n\nNo tasks here.\n');

    const result = runNode(tmpDir, stateScript, ['task-checkoff', 'docs/empty.md', 'Some task']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('task text must appear exactly once');
  }, 20_000);

  it('comet-env.mjs prints the scripts directory it lives in', async () => {
    const envScript = path.join(tmpDir, 'scripts', 'comet-env.mjs');
    const result = runNode(tmpDir, envScript);

    expect(result.status).toBe(0);
    const printedDir = result.stdout.trim();
    // comet-env.mjs prints its own directory — the scripts dir holding every
    // standalone command script.
    expect(printedDir.endsWith('scripts')).toBe(true);
    for (const sibling of ['comet-state.mjs', 'comet-guard.mjs', 'comet-hook-guard.mjs']) {
      await expect(fs.access(`${printedDir}/${sibling}`)).resolves.toBeUndefined();
    }
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
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        'auto_transition: true',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(1)"' } }),
    );

    const result = runNode(tmpDir, guardScript, ['broken-build', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] Build passes');
  }, 20_000);

  it('blocks open guard when Chinese workflow artifacts are clearly English', async () => {
    await createChange(
      tmpDir,
      'zh-english-artifacts',
      [
        'workflow: full',
        'language: zh-CN',
        'phase: open',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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
      '- [ ] Implement the feature and validate the generated documentation language\n',
    );
    const englishBody =
      'This document explains the feature goals, implementation approach, expected behavior, acceptance scenarios, boundaries, risks, and verification strategy for the workflow.\n';
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'zh-english-artifacts', 'proposal.md'),
      englishBody,
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'zh-english-artifacts', 'design.md'),
      englishBody,
    );

    const result = runNode(tmpDir, guardScript, ['zh-english-artifacts', 'open']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] proposal.md matches configured language');
    expect(result.stderr).toContain('configured language is zh-CN');
  }, 20_000);

  it('uses the global Comet language in guards when change and project values are absent', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await writeFile(path.join(fakeHome, '.comet', 'config.yaml'), 'language: zh-CN\n');
    await createChange(
      tmpDir,
      'global-zh-english-artifacts',
      [
        'workflow: full',
        'language: null',
        'phase: open',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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
      '- [ ] Implement the feature and validate the generated documentation language\n',
    );
    const englishBody =
      'This document explains the feature goals, implementation approach, expected behavior, acceptance scenarios, boundaries, risks, and verification strategy for the workflow.\n';
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'global-zh-english-artifacts', 'proposal.md'),
      englishBody,
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'global-zh-english-artifacts', 'design.md'),
      englishBody,
    );

    const result = runNode(tmpDir, guardScript, ['global-zh-english-artifacts', 'open'], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('configured language is zh-CN');
  }, 20_000);

  it('does not block the language check when .comet/config.yaml has an unrelated malformed field', async () => {
    await writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      'language: en\nunrelated_field: [unterminated\n',
    );
    await createChange(
      tmpDir,
      'unrelated-malformed-config',
      [
        'workflow: full',
        'language: null',
        'phase: open',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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

    const result = runNode(tmpDir, guardScript, ['unrelated-malformed-config', 'open']);

    expect(result.status).toBe(0);
  }, 20_000);

  it('allows Chinese workflow artifacts with English technical terms', async () => {
    await createChange(
      tmpDir,
      'zh-mixed-artifacts',
      [
        'workflow: full',
        'language: zh-CN',
        'phase: open',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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
      '- [ ] 实现 language guard 并验证 OpenSpec artifact\n',
    );
    const mixedBody =
      '本文档说明 language guard 的目标、范围、验收场景和验证方式。OpenSpec、Superpowers、Markdown 等英文术语可以保留，但正文必须以中文为主。\n';
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'zh-mixed-artifacts', 'proposal.md'),
      mixedBody,
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'zh-mixed-artifacts', 'design.md'),
      mixedBody,
    );

    const result = runNode(tmpDir, guardScript, ['zh-mixed-artifacts', 'open']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] proposal.md matches configured language');
  }, 20_000);

  it('blocks open guard when English workflow artifacts are clearly Chinese', async () => {
    await createChange(
      tmpDir,
      'en-chinese-artifacts',
      [
        'workflow: full',
        'language: en',
        'phase: open',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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
      '- [ ] Implement the feature and validate the generated documentation language\n',
    );
    const chineseBody =
      '本文档说明了这个功能的目标范围预期行为验收场景边界条件风险以及针对这次工作流的验证策略等相关内容。\n';
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'en-chinese-artifacts', 'proposal.md'),
      chineseBody,
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'en-chinese-artifacts', 'design.md'),
      chineseBody,
    );

    const result = runNode(tmpDir, guardScript, ['en-chinese-artifacts', 'open']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] proposal.md matches configured language');
    expect(result.stderr).toContain('configured language is en');
  }, 20_000);

  it('excludes fenced code blocks from the language dominance check', async () => {
    await createChange(
      tmpDir,
      'zh-code-block-artifacts',
      [
        'workflow: full',
        'language: zh-CN',
        'phase: open',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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
      '- [ ] 实现 language guard 并验证 OpenSpec artifact\n',
    );
    const bodyWithLargeCodeBlock = [
      '本文档说明 language guard 的目标、范围、验收场景和验证方式，正文以中文为主。',
      '',
      '```bash',
      'npx vitest run test/domains/comet-classic/comet-scripts.test.ts --reporter verbose --coverage --watch=false',
      'export COMET_LANGUAGE=en COMET_CONTEXT_COMPRESSION=beta COMET_AUTO_TRANSITION=true',
      'find . -name "*.test.ts" -not -path "./node_modules/*" -print0 | xargs -0 grep -l language',
      '```',
      '',
    ].join('\n');
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'zh-code-block-artifacts', 'proposal.md'),
      bodyWithLargeCodeBlock,
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'zh-code-block-artifacts', 'design.md'),
      bodyWithLargeCodeBlock,
    );

    const result = runNode(tmpDir, guardScript, ['zh-code-block-artifacts', 'open']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] proposal.md matches configured language');
  }, 20_000);

  it('fails closed in guard when project config has an invalid language value', async () => {
    await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: fr\n');
    await createChange(
      tmpDir,
      'invalid-project-language',
      [
        'workflow: full',
        'phase: open',
        'context_compression: off',
        'build_mode: null',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: null',
        'review_mode: off',
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
      '- [ ] Implement the feature\n',
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'invalid-project-language', 'proposal.md'),
      'This proposal describes the feature in English.\n',
    );

    const result = runNode(tmpDir, guardScript, ['invalid-project-language', 'open']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("configured language 'fr' is invalid");
  }, 20_000);

  it('generates a design handoff and requires minimal design doc linkage before leaving design', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
      '- [ ] build the handoff\n',
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'handoff-change', 'specs', 'capability', 'spec.md'),
      'delta spec\n',
    );

    const handoff = runNode(tmpDir, handoffScript, ['handoff-change', 'design', '--write']);
    const contextPath = runNode(tmpDir, stateScript, [
      'get',
      'handoff-change',
      'handoff_context',
    ]).stdout.trim();
    const contextHash = runNode(tmpDir, stateScript, [
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
    runNode(tmpDir, stateScript, [
      'set',
      'handoff-change',
      'design_doc',
      'docs/superpowers/specs/handoff-design.md',
    ]);

    const result = runNode(tmpDir, guardScript, ['handoff-change', 'design']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] design handoff context exists');
    expect(result.stderr).toContain('[PASS] design handoff markdown is traceable');
    expect(result.stderr).toContain('[PASS] Design Doc frontmatter links current change');
    expect(result.stderr).toContain('[PASS] Design Doc declares OpenSpec as canonical spec');
  }, 20_000);

  it('generates a beta spec projection handoff with verbatim spec content', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
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

    const handoff = runNode(tmpDir, handoffScript, ['beta-context', 'design', '--write']);
    const contextPath = runNode(tmpDir, stateScript, [
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
    runNode(tmpDir, stateScript, [
      'set',
      'beta-context',
      'design_doc',
      'docs/superpowers/specs/beta-design.md',
    ]);

    const result = runNode(tmpDir, guardScript, ['beta-context', 'design']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] design handoff context exists');
    expect(result.stderr).toContain('[PASS] design handoff markdown is traceable');
    expect(result.stderr).toContain('[PASS] beta spec-context.json is structurally valid');
  }, 20_000);

  it('blocks beta design exit when spec-context.json is structurally invalid', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
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

    const handoff = runNode(tmpDir, handoffScript, ['beta-bad-json', 'design', '--write']);
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
    runNode(tmpDir, stateScript, [
      'set',
      'beta-bad-json',
      'design_doc',
      'docs/superpowers/specs/beta-bad-json-design.md',
    ]);

    const result = runNode(tmpDir, guardScript, ['beta-bad-json', 'design']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] beta spec-context.json is structurally valid');
  }, 20_000);

  it('blocks beta design exit when spec-context.json is malformed JSON', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
    await createChange(
      tmpDir,
      'beta-malformed-json',
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
        'auto_transition: true',
        '',
      ].join('\n'),
      '- [ ] build beta context\n',
    );
    await writeFile(
      path.join(
        tmpDir,
        'openspec',
        'changes',
        'beta-malformed-json',
        'specs',
        'capability',
        'spec.md',
      ),
      [
        '## ADDED Requirements',
        '',
        '### Requirement: Keep malformed JSON blocked',
        '',
        '#### Scenario: malformed JSON',
        '- **WHEN** guard parses the projection',
        '- **THEN** invalid JSON is rejected',
        '',
      ].join('\n'),
    );

    const handoff = runNode(tmpDir, handoffScript, ['beta-malformed-json', 'design', '--write']);
    expect(handoff.status).toBe(0);

    const jsonPath = path.join(
      tmpDir,
      'openspec',
      'changes',
      'beta-malformed-json',
      '.comet',
      'handoff',
      'spec-context.json',
    );
    await fs.appendFile(jsonPath, '\nnot-json\n');

    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'specs', 'beta-malformed-json-design.md'),
      [
        '---',
        'comet_change: beta-malformed-json',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
      ].join('\n'),
    );
    runNode(tmpDir, stateScript, [
      'set',
      'beta-malformed-json',
      'design_doc',
      'docs/superpowers/specs/beta-malformed-json-design.md',
    ]);

    const result = runNode(tmpDir, guardScript, ['beta-malformed-json', 'design']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] beta spec-context.json is structurally valid');
    expect(result.stderr).toContain('invalid JSON');
  }, 20_000);

  it('reads comet yaml fields without including trailing comments', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
    const validateScript = path.join(tmpDir, 'scripts', 'comet-yaml-validate.mjs');
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

    const phase = runNode(tmpDir, stateScript, ['get', 'commented-yaml', 'phase']);
    const validate = runNode(tmpDir, validateScript, ['commented-yaml']);
    const handoff = runNode(tmpDir, handoffScript, ['commented-yaml', 'design', '--write']);

    expect(phase.status).toBe(0);
    expect(phase.stdout.trim()).toBe('design');
    expect(validate.status, validate.stderr).toBe(0);
    expect(handoff.status).toBe(0);
  }, 20_000);

  it('accepts design doc frontmatter after a BOM and leading blank lines', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );
    runNode(tmpDir, handoffScript, ['frontmatter-prefix', 'design', '--write']);
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
    runNode(tmpDir, stateScript, [
      'set',
      'frontmatter-prefix',
      'design_doc',
      'docs/superpowers/specs/frontmatter-prefix-design.md',
    ]);

    const result = runNode(tmpDir, guardScript, ['frontmatter-prefix', 'design']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] Design Doc frontmatter links current change');
    expect(result.stderr).toContain('[PASS] Design Doc declares OpenSpec as canonical spec');
  }, 20_000);

  it('generates a full-mode design handoff when --full is passed', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );

    const handoff = runNode(tmpDir, handoffScript, ['full-handoff', 'design', '--write', '--full']);

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
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );

    const handoff = runNode(tmpDir, handoffScript, [
      'beta-full-warn',
      'design',
      '--write',
      '--full',
    ]);

    expect(handoff.status).toBe(0);
    expect(handoff.stderr).toContain('--full is ignored in beta mode');

    // Should still generate spec-context.* (beta files), not design-context.* (full files)
    const contextPath = runNode(tmpDir, stateScript, [
      'get',
      'beta-full-warn',
      'handoff_context',
    ]).stdout.trim();
    expect(contextPath).toBe('openspec/changes/beta-full-warn/.comet/handoff/spec-context.json');
  }, 20_000);

  it('rejects handoff generation when required OpenSpec artifacts are missing', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
    // design.md and tasks.md intentionally omitted

    const result = runNode(tmpDir, handoffScript, ['missing-artifacts', 'design', '--write']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required OpenSpec artifact missing or empty');
  }, 20_000);

  it('detects OpenSpec artifacts changed after handoff was generated', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );

    runNode(tmpDir, handoffScript, ['stale-handoff', 'design', '--write']);

    // Mutate proposal.md after handoff was generated
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'stale-handoff', 'proposal.md'),
      'mutated proposal\n',
    );

    const result = runNode(tmpDir, guardScript, ['stale-handoff', 'design']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] design handoff context exists');
    expect(result.stderr).toContain('OpenSpec artifacts changed after handoff was generated');
  }, 20_000);

  it('--hash-only outputs context hash without generating handoff files', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );

    // Generate a normal handoff first to get the expected hash
    const normalResult = runNode(tmpDir, handoffScript, ['hash-only-test', 'design', '--write']);
    expect(normalResult.status).toBe(0);
    const normalHash = runNode(tmpDir, stateScript, ['get', 'hash-only-test', 'handoff_hash']);
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

    const hashOnlyResult = runNode(tmpDir, handoffScript, ['hash-only-test', '--hash-only']);
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
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
    const result = runNode(tmpDir, handoffScript, ['no-such-change', '--hash-only']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('change directory not found');
  }, 20_000);

  it('--hash-only fails when required files are missing', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
    // design.md and tasks.md intentionally omitted

    const result = runNode(tmpDir, handoffScript, ['hash-missing-files', '--hash-only']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required file missing or empty');
  }, 20_000);

  it('blocks design exit when design doc frontmatter is missing required fields', async () => {
    const handoffScript = path.join(tmpDir, 'scripts', 'comet-handoff.mjs');
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
        'auto_transition: true',
        '',
      ].join('\n'),
    );

    runNode(tmpDir, handoffScript, ['bad-frontmatter', 'design', '--write']);

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
    runNode(tmpDir, stateScript, [
      'set',
      'bad-frontmatter',
      'design_doc',
      'docs/superpowers/specs/bad-design.md',
    ]);

    const result = runNode(tmpDir, guardScript, ['bad-frontmatter', 'design']);

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

    const guard = runNode(tmpDir, guardScript, ['missing-build-decisions', 'build']);
    const transition = runNode(tmpDir, stateScript, [
      'transition',
      'missing-build-decisions',
      'build-complete',
    ]);

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('[FAIL] isolation selected');
    expect(guard.stderr).toContain('[FAIL] build_mode selected');
    expect(guard.stderr).toContain('Next: choose a valid workspace mode');
    expect(guard.stderr).toContain(
      'comet state set missing-build-decisions isolation <branch|worktree>',
    );
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

    const guard = runNode(tmpDir, guardScript, ['missing-tdd-mode', 'build']);
    const transition = runNode(tmpDir, stateScript, [
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

    const result = runNode(tmpDir, guardScript, ['hotfix-no-tdd', 'build']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] tdd_mode selected');
  }, 20_000);

  it('blocks build completion until review_mode is selected for full workflow', async () => {
    await createChange(
      tmpDir,
      'missing-review-mode',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'review_mode: null',
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

    const guard = runNode(tmpDir, guardScript, ['missing-review-mode', 'build']);
    const transition = runNode(tmpDir, stateScript, [
      'transition',
      'missing-review-mode',
      'build-complete',
    ]);

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('[FAIL] review_mode selected');
    expect(guard.stderr).toContain('review_mode must be off, standard, or thorough');
    expect(transition.status).not.toBe(0);
    expect(transition.stderr).toContain('review_mode must be off, standard, or thorough');
  }, 20_000);

  it('allows setting review_mode to off, standard, and thorough', async () => {
    runNode(tmpDir, stateScript, ['init', 'review-mode-set', 'full']);

    for (const value of ['off', 'standard', 'thorough']) {
      const set = runNode(tmpDir, stateScript, ['set', 'review-mode-set', 'review_mode', value]);
      const get = runNode(tmpDir, stateScript, ['get', 'review-mode-set', 'review_mode']);

      expect(set.status).toBe(0);
      expect(get.stdout.trim()).toBe(value);
    }
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

    const setPlanReady = runNode(tmpDir, stateScript, [
      'set',
      'pause-set',
      'build_pause',
      'plan-ready',
    ]);
    const planReady = runNode(tmpDir, stateScript, ['get', 'pause-set', 'build_pause']);
    const setNull = runNode(tmpDir, stateScript, ['set', 'pause-set', 'build_pause', 'null']);
    const pausedNull = runNode(tmpDir, stateScript, ['get', 'pause-set', 'build_pause']);

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

    const result = runNode(tmpDir, guardScript, ['invalid-build-pause', 'build']);

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

    const result = runNode(tmpDir, guardScript, ['invalid-subagent-dispatch', 'build']);

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

    const result = runNode(tmpDir, guardScript, ['invalid-tdd-mode', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tdd_mode='always' is not valid");
    expect(result.stderr).toContain('FATAL: .comet.yaml schema validation failed');
  }, 20_000);

  it('rejects invalid review_mode values during schema validation', async () => {
    await createChange(
      tmpDir,
      'invalid-review-mode',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'review_mode: noisy',
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

    const result = runNode(tmpDir, guardScript, ['invalid-review-mode', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("review_mode='noisy' is not valid");
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

    const result = runNode(tmpDir, guardScript, ['direct-full', 'build']);

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
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        'auto_transition: true',
        '',
      ].join('\n'),
      ['- [x] done', '- [ ] finish guard remediation'].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runNode(tmpDir, guardScript, ['unfinished-tasks', 'build']);

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
        'review_mode: off',
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

    const result = runNode(tmpDir, guardScript, ['unfinished-plan-tasks', 'build']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] Superpowers plan all tasks checked');
    expect(result.stderr).toContain('Unfinished Superpowers plan tasks:');
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

    const result = runNode(tmpDir, stateScript, [
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
        'review_mode: off',
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

    const result = runNode(tmpDir, guardScript, ['direct-full-override', 'build']);

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

    const guard = runNode(tmpDir, guardScript, ['subagent-unconfirmed', 'build']);
    const transition = runNode(tmpDir, stateScript, [
      'transition',
      'subagent-unconfirmed',
      'build-complete',
    ]);

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('[FAIL] subagent dispatch confirmed');
    expect(guard.stderr).toContain('subagent_dispatch must be confirmed');
    expect(guard.stderr).toContain('return to /comet-build Step 2');
    expect(guard.stderr).not.toContain('ask the user to switch');
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
        'review_mode: off',
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

    const result = runNode(tmpDir, guardScript, ['subagent-confirmed', 'build']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[PASS] subagent dispatch confirmed');
  }, 20_000);

  it('rejects removed build and verify command fields', async () => {
    await createChange(
      tmpDir,
      'removed-command-fields',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: direct',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        'auto_transition: true',
        '',
      ].join('\n'),
    );

    const build = runNode(tmpDir, stateScript, [
      'set',
      'removed-command-fields',
      'build_command',
      'npm run build',
    ]);
    const verify = runNode(tmpDir, stateScript, [
      'set',
      'removed-command-fields',
      'verify_command',
      'npm test',
    ]);

    expect(build.status).not.toBe(0);
    expect(build.stderr).toContain("Unknown field: 'build_command'");
    expect(verify.status).not.toBe(0);
    expect(verify.stderr).toContain("Unknown field: 'verify_command'");
  });

  it('removes legacy command fields from existing change state before guard checks', async () => {
    const changeDir = await createChange(
      tmpDir,
      'legacy-command-fields',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'base_ref: null',
        'verify_result: pending',
        'verification_report: null',
        'branch_status: pending',
        'created_at: 2026-07-08',
        'verified_at: null',
        'archived: false',
        'build_command: null',
        'verify_command: node legacy-verify.js',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runNode(tmpDir, guardScript, ['legacy-command-fields', 'build']);
    const migrated = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('unknown field');
    expect(result.stderr).toContain('[PASS] Build passes');
    expect(migrated).not.toContain('build_command');
    expect(migrated).not.toContain('verify_command');
  }, 20_000);

  it('treats repo-root comet.yaml as absent when running inferred build checks', async () => {
    await createChange(
      tmpDir,
      'root-configured-build',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: direct',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        'auto_transition: true',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(tmpDir, 'openspec', 'changes', 'root-configured-build', 'proposal.md'),
      [
        '# Proposal',
        '',
        'This change updates the project build verification path with a small, well-scoped behavior change.',
        'The proposal is intentionally written in English so language validation has enough signal.',
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

    const result = runNode(tmpDir, guardScript, ['root-configured-build', 'build']);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('root configured failure');
    expect(result.stderr).toContain('[PASS] Build passes');
  }, 20_000);

  it('rejects removed project verify_command instead of silently skipping it', async () => {
    await createChange(
      tmpDir,
      'project-verify-command',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: light',
        'design_doc: null',
        'plan: null',
        'base_ref: null',
        'verify_result: pending',
        'verification_report: reports/verification.md',
        'branch_status: handled',
        'created_at: 2026-07-08',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(tmpDir, 'reports', 'verification.md'), '# Verification\n\nPassed.\n');
    await writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      'verify_command: node legacy-verify.js\n',
    );
    await writeFile(
      path.join(tmpDir, 'legacy-verify.js'),
      'console.error("legacy verify failed"); process.exit(1);\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runNode(tmpDir, guardScript, ['project-verify-command', 'verify']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verify_command has been removed');
    expect(result.stderr).not.toContain('[PASS] Verification passes');
  }, 20_000);

  it('does not silently pass when a malformed project config still references a removed command field', async () => {
    await createChange(
      tmpDir,
      'malformed-config-verify-command',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: direct',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: light',
        'design_doc: null',
        'plan: null',
        'base_ref: null',
        'verify_result: pending',
        'verification_report: reports/verification.md',
        'branch_status: handled',
        'created_at: 2026-07-08',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(tmpDir, 'reports', 'verification.md'), '# Verification\n\nPassed.\n');
    // Malformed YAML that still references the removed verify_command: the guard
    // must not silently fall through to the inferred build check (which would pass).
    await writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      'verify_command: node legacy-verify.js\nbroken: [unclosed\n',
    );
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
    );

    const result = runNode(tmpDir, guardScript, ['malformed-config-verify-command', 'verify']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('[PASS] Verification passes');
    expect(result.stderr).toContain('.comet/config.yaml is invalid YAML');
  }, 20_000);

  it('validates archive completeness after the change has moved into archive', async () => {
    await createChange(
      tmpDir,
      path.join('archive', '2026-05-21-done-change'),
      [
        'workflow: full',
        'phase: archive',
        'context_compression: off',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: tdd',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: light',
        'base_ref: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pass',
        'verification_report: null',
        'branch_status: pending',
        'auto_transition: true',
        'created_at: 2026-05-21',
        'verified_at: 2026-05-21',
        'archived: true',
        'direct_override: null',
        'handoff_context: null',
        'handoff_hash: null',
        '',
      ].join('\n'),
    );

    const pending = runNode(tmpDir, guardScript, ['done-change', 'archive']);
    const handled = runNode(tmpDir, stateScript, [
      'set',
      'done-change',
      'branch_status',
      'handled',
    ]);
    const result = runNode(tmpDir, guardScript, ['done-change', 'archive']);

    expect(pending.status).not.toBe(0);
    expect(pending.stderr).toContain('[FAIL] branch_status=handled');
    expect(handled.status).toBe(0);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('ALL CHECKS PASSED');
  });

  it('resolves OpenSpec date-prefixed archive directories from the original change name', async () => {
    await createChange(
      tmpDir,
      path.join('archive', '2026-05-21-resolved-archive'),
      [
        'workflow: full',
        'phase: archive',
        'context_compression: off',
        'build_mode: executing-plans',
        'build_pause: null',
        'subagent_dispatch: null',
        'tdd_mode: tdd',
        'review_mode: off',
        'isolation: branch',
        'verify_mode: full',
        'base_ref: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pass',
        'verification_report: null',
        'branch_status: handled',
        'auto_transition: true',
        'created_at: 2026-05-21',
        'verified_at: 2026-05-21',
        'archived: true',
        'direct_override: null',
        'handoff_context: null',
        'handoff_hash: null',
        '',
      ].join('\n'),
      '- [x] archived\n',
    );

    const get = runNode(tmpDir, stateScript, ['get', 'resolved-archive', 'archived']);
    const next = runNode(tmpDir, stateScript, ['next', 'resolved-archive']);
    const guard = runNode(tmpDir, guardScript, ['resolved-archive', 'archive']);
    const validate = runNode(tmpDir, validateScript, ['resolved-archive']);

    expect(get.status).toBe(0);
    expect(get.stdout.trim()).toBe('true');
    expect(next.status).toBe(0);
    expect(next.stdout.trim()).toBe('NEXT: done');
    expect(guard.status).toBe(0);
    expect(guard.stderr).toContain('ALL CHECKS PASSED');
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stderr).toContain(
      '[VALIDATE] openspec/changes/archive/2026-05-21-resolved-archive/.comet.yaml',
    );
  }, 20_000);

  it('reports accurate archive step counts when syncing and annotating', async () => {
    const archiveScript = path.join(tmpDir, 'scripts', 'comet-archive.mjs');
    const { command, logFile } = await createFakeOpenSpecArchive(tmpDir);
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
        'archive_confirmation: confirmed',
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

    const result = runNode(tmpDir, archiveScript, ['ready-to-archive'], {
      COMET_OPENSPEC: command,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Archive complete. 7/7 steps succeeded.');
    await expect(fs.readFile(logFile, 'utf-8')).resolves.toBe('archive ready-to-archive --yes\n');
  }, 20_000);

  it('merges delta specs without copying delta-only requirement headings into main specs', async () => {
    const archiveScript = path.join(tmpDir, 'scripts', 'comet-archive.mjs');
    const { command } = await createFakeOpenSpecArchive(tmpDir);
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
        'archive_confirmation: confirmed',
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

    const result = runNode(tmpDir, archiveScript, ['merge-delta-spec'], {
      COMET_OPENSPEC: command,
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
    const archiveScript = path.join(tmpDir, 'scripts', 'comet-archive.mjs');
    const { command } = await createFakeOpenSpecArchive(tmpDir, '2026-05-20');
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
        'archive_confirmation: confirmed',
        'archived: false',
        '',
      ].join('\n'),
    );
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'specs', 'utc-design.md'), 'design\n');
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'plans', 'utc-plan.md'), 'plan\n');
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'reports', 'utc.md'), 'PASS\n');

    const result = runNode(tmpDir, archiveScript, ['utc-archive-date'], {
      COMET_OPENSPEC: command,
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
    for (let i = 1; i <= 9; i += 1) {
      await writeFile(path.join(tmpDir, 'src', `file-${i}.txt`), `change ${i}\n`);
    }
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'large change'], { cwd: tmpDir, stdio: 'ignore' });

    const result = runNode(tmpDir, stateScript, ['scale', 'large-change']);
    const mode = runNode(tmpDir, stateScript, ['get', 'large-change', 'verify_mode']);

    expect(result.status).toBe(0);
    expect(mode.stdout.trim()).toBe('full');
  }, 20_000);

  it('scale defaults to light when no tasks.md, no specs, and no git diff', async () => {
    await createChange(
      tmpDir,
      'tiny-change',
      [
        'workflow: full',
        'phase: verify',
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

    const result = runNode(tmpDir, stateScript, ['scale', 'tiny-change']);
    const mode = runNode(tmpDir, stateScript, ['get', 'tiny-change', 'verify_mode']);

    expect(result.status).toBe(0);
    expect(mode.stdout.trim()).toBe('light');
  });

  it('scale returns full when tasks exceed threshold', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => `- [x] task ${i + 1}`).join('\n');
    await createChange(
      tmpDir,
      'many-tasks',
      [
        'workflow: full',
        'phase: verify',
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
      tasks,
    );

    const result = runNode(tmpDir, stateScript, ['scale', 'many-tasks']);
    const mode = runNode(tmpDir, stateScript, ['get', 'many-tasks', 'verify_mode']);

    expect(result.status).toBe(0);
    expect(mode.stdout.trim()).toBe('full');
  });

  it('scale uses base_ref from .comet.yaml when plan has no base-ref header', async () => {
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
      'base-ref-change',
      [
        'workflow: full',
        'phase: verify',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: null',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: null',
        `base_ref: ${baseRef}`,
        'verify_result: pending',
        'archived: false',
        '',
      ].join('\n'),
    );
    for (let i = 1; i <= 9; i += 1) {
      await writeFile(path.join(tmpDir, 'src', `file-${i}.txt`), `change ${i}\n`);
    }
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'many files'], { cwd: tmpDir, stdio: 'ignore' });

    const result = runNode(tmpDir, stateScript, ['scale', 'base-ref-change']);
    const mode = runNode(tmpDir, stateScript, ['get', 'base-ref-change', 'verify_mode']);

    expect(result.status).toBe(0);
    expect(mode.stdout.trim()).toBe('full');
  }, 20_000);

  it('blocks build-complete when review_mode is null for full workflow', async () => {
    await createChange(
      tmpDir,
      'no-review-mode',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: light',
        'review_mode: null',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, ['transition', 'no-review-mode', 'build-complete']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('review_mode must be selected');
  });

  it('allows build-complete when review_mode is off for full workflow', async () => {
    await createChange(
      tmpDir,
      'review-off',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: light',
        'review_mode: off',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, ['transition', 'review-off', 'build-complete']);

    expect(result.status).toBe(0);
  });

  it('allows build-complete when review_mode is standard for full workflow', async () => {
    await createChange(
      tmpDir,
      'review-standard',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: light',
        'review_mode: standard',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, [
      'transition',
      'review-standard',
      'build-complete',
    ]);

    expect(result.status).toBe(0);
  });

  it('allows build-complete without review_mode for hotfix workflow', async () => {
    await createChange(
      tmpDir,
      'hotfix-no-review',
      [
        'workflow: hotfix',
        'phase: build',
        'build_mode: direct',
        'build_pause: null',
        'tdd_mode: direct',
        'isolation: branch',
        'verify_mode: light',
        'review_mode: off',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, [
      'transition',
      'hotfix-no-review',
      'build-complete',
    ]);

    expect(result.status).toBe(0);
  });

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

    const result = runNode(tmpDir, stateScript, ['transition', 'full-change', 'open-complete']);
    const phase = runNode(tmpDir, stateScript, ['get', 'full-change', 'phase']);

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
    await fs.rm(path.join(tmpDir, 'openspec/changes/tweak-change/design.md'));

    const result = runNode(tmpDir, stateScript, ['transition', 'tweak-change', 'open-complete']);
    const phase = runNode(tmpDir, stateScript, ['get', 'tweak-change', 'phase']);

    expect(result.status).toBe(0);
    expect(phase.stdout.trim()).toBe('build');
  });

  it('blocks full workflow build completion when review_mode is missing', async () => {
    await createChange(
      tmpDir,
      'missing-review-field',
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
        'verify_result: pending',
        'verification_report: null',
        'branch_status: pending',
        'created_at: 2026-06-04',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const guard = runNode(tmpDir, guardScript, ['missing-review-field', 'build']);
    const transition = runNode(tmpDir, stateScript, [
      'transition',
      'missing-review-field',
      'build-complete',
    ]);

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('review_mode must be off, standard, or thorough');
    expect(transition.status).not.toBe(0);
    expect(transition.stderr).toContain('review_mode must be selected before leaving build');
  }, 20_000);

  it('blocks open-complete when an open artifact is missing', async () => {
    await createChange(
      tmpDir,
      'open-missing-artifact',
      ['workflow: full', 'phase: open', 'design_doc: null', 'archived: false', ''].join('\n'),
    );
    await fs.rm(path.join(tmpDir, 'openspec/changes/open-missing-artifact/design.md'));

    const result = runNode(tmpDir, stateScript, [
      'transition',
      'open-missing-artifact',
      'open-complete',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('design.md must exist and be non-empty');
  });

  it('blocks design-complete when design_doc evidence is missing', async () => {
    await createChange(
      tmpDir,
      'design-no-doc',
      ['workflow: full', 'phase: design', 'design_doc: null', 'archived: false', ''].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, ['transition', 'design-no-doc', 'design-complete']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('design_doc must point to an existing');
  });

  it('allows design-complete once design_doc points to an existing file', async () => {
    await createChange(
      tmpDir,
      'design-with-doc',
      ['workflow: full', 'phase: design', 'design_doc: null', 'archived: false', ''].join('\n'),
    );
    const docPath = 'docs/superpowers/design.md';
    await writeFile(path.join(tmpDir, docPath), '# Design Doc\n');
    runNode(tmpDir, stateScript, ['set', 'design-with-doc', 'design_doc', docPath]);

    const result = runNode(tmpDir, stateScript, [
      'transition',
      'design-with-doc',
      'design-complete',
    ]);
    const phase = runNode(tmpDir, stateScript, ['get', 'design-with-doc', 'phase']);

    expect(result.status).toBe(0);
    expect(phase.stdout.trim()).toBe('build');
  });

  it('blocks direct phase writes but allows the COMET_FORCE_PHASE escape hatch', async () => {
    await createChange(
      tmpDir,
      'phase-jump',
      ['workflow: full', 'phase: open', 'design_doc: null', 'archived: false', ''].join('\n'),
    );

    const blocked = runNode(tmpDir, stateScript, ['set', 'phase-jump', 'phase', 'build']);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("Setting 'phase' directly is not allowed");

    const forced = runNode(tmpDir, stateScript, ['set', 'phase-jump', 'phase', 'build'], {
      COMET_FORCE_PHASE: '1',
    });
    expect(forced.status).toBe(0);
    const phase = runNode(tmpDir, stateScript, ['get', 'phase-jump', 'phase']);
    expect(phase.stdout.trim()).toBe('build');
  });

  it('blocks archived transition until verify_result is pass', async () => {
    await createChange(
      tmpDir,
      'archive-not-passed',
      ['workflow: full', 'phase: archive', 'verify_result: pending', 'archived: false', ''].join(
        '\n',
      ),
    );

    const unverifiedConfirmation = runNode(tmpDir, stateScript, [
      'transition',
      'archive-not-passed',
      'archive-confirm',
    ]);
    const blocked = runNode(tmpDir, stateScript, ['transition', 'archive-not-passed', 'archived']);
    expect(unverifiedConfirmation.status).toBe(1);
    expect(unverifiedConfirmation.stderr).toContain('verify_result must be pass before archiving');
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('verify_result must be pass before archiving');

    runNode(tmpDir, stateScript, ['set', 'archive-not-passed', 'verify_result', 'pass']);
    const unconfirmed = runNode(tmpDir, stateScript, [
      'transition',
      'archive-not-passed',
      'archived',
    ]);
    expect(unconfirmed.status).toBe(1);
    expect(unconfirmed.stderr).toContain('archive_confirmation must be confirmed before archiving');

    runNode(tmpDir, stateScript, ['transition', 'archive-not-passed', 'archive-confirm']);
    const ok = runNode(tmpDir, stateScript, ['transition', 'archive-not-passed', 'archived']);
    expect(ok.status).toBe(0);
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

    const manualFailureCount = runNode(tmpDir, stateScript, [
      'set',
      'verify-change',
      'verify_failures',
      '7',
    ]);
    const fail = runNode(tmpDir, stateScript, ['transition', 'verify-change', 'verify-fail']);
    const failedPhase = runNode(tmpDir, stateScript, ['get', 'verify-change', 'phase']);
    const failedResult = runNode(tmpDir, stateScript, ['get', 'verify-change', 'verify_result']);
    const failedCount = runNode(tmpDir, stateScript, ['get', 'verify-change', 'verify_failures']);
    const failedBranchStatus = runNode(tmpDir, stateScript, [
      'get',
      'verify-change',
      'branch_status',
    ]);

    expect(manualFailureCount.status).not.toBe(0);
    expect(manualFailureCount.stderr).toContain('machine-owned field');
    expect(fail.status).toBe(0);
    expect(failedPhase.stdout.trim()).toBe('build');
    expect(failedResult.stdout.trim()).toBe('fail');
    expect(failedCount.stdout.trim()).toBe('1');
    expect(failedBranchStatus.stdout.trim()).toBe('pending');

    const forceVerify = runNode(tmpDir, stateScript, ['set', 'verify-change', 'phase', 'verify'], {
      COMET_FORCE_PHASE: '1',
    });
    expect(forceVerify.status).toBe(0);
    runNode(tmpDir, stateScript, ['set', 'verify-change', 'verify_result', 'pending']);
    await writeFile(
      path.join(tmpDir, 'docs', 'superpowers', 'reports', 'verify-change.md'),
      'PASS\n',
    );
    runNode(tmpDir, stateScript, [
      'set',
      'verify-change',
      'verification_report',
      'docs/superpowers/reports/verify-change.md',
    ]);
    const pass = runNode(tmpDir, stateScript, ['transition', 'verify-change', 'verify-pass']);
    const passedPhase = runNode(tmpDir, stateScript, ['get', 'verify-change', 'phase']);
    const passedResult = runNode(tmpDir, stateScript, ['get', 'verify-change', 'verify_result']);
    const passedCount = runNode(tmpDir, stateScript, ['get', 'verify-change', 'verify_failures']);
    const verifiedAt = runNode(tmpDir, stateScript, ['get', 'verify-change', 'verified_at']);
    const archiveConfirmation = runNode(tmpDir, stateScript, [
      'get',
      'verify-change',
      'archive_confirmation',
    ]);

    expect(pass.status).toBe(0);
    expect(passedPhase.stdout.trim()).toBe('archive');
    expect(passedResult.stdout.trim()).toBe('pass');
    expect(passedCount.stdout.trim()).toBe('0');
    expect(
      runNode(tmpDir, stateScript, ['get', 'verify-change', 'branch_status']).stdout.trim(),
    ).toBe('pending');
    expect(verifiedAt.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(archiveConfirmation.stdout.trim()).toBe('pending');
  }, 20_000);

  it('confirms archive only after the final archive confirmation decision', async () => {
    await createChange(
      tmpDir,
      'archive-confirm',
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
        'branch_status: handled',
        'verified_at: 2026-06-05',
        'archive_confirmation: pending',
        'archived: false',
        '',
      ].join('\n'),
    );

    const bypass = runNode(tmpDir, stateScript, [
      'set',
      'archive-confirm',
      'archive_confirmation',
      'confirmed',
    ]);
    const pending = runNode(tmpDir, stateScript, [
      'get',
      'archive-confirm',
      'archive_confirmation',
    ]);
    const result = runNode(tmpDir, stateScript, [
      'transition',
      'archive-confirm',
      'archive-confirm',
    ]);
    const confirmation = runNode(tmpDir, stateScript, [
      'get',
      'archive-confirm',
      'archive_confirmation',
    ]);

    expect(bypass.status).not.toBe(0);
    expect(bypass.stderr).toContain('machine-owned field');
    expect(pending.stdout.trim()).toBe('pending');
    expect(result.status).toBe(0);
    expect(confirmation.stdout.trim()).toBe('confirmed');
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
        'archive_confirmation: confirmed',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, ['transition', 'archive-reopen', 'archive-reopen']);
    const phase = runNode(tmpDir, stateScript, ['get', 'archive-reopen', 'phase']);
    const verifyResult = runNode(tmpDir, stateScript, ['get', 'archive-reopen', 'verify_result']);
    const verifiedAt = runNode(tmpDir, stateScript, ['get', 'archive-reopen', 'verified_at']);
    const report = runNode(tmpDir, stateScript, ['get', 'archive-reopen', 'verification_report']);
    const branchStatus = runNode(tmpDir, stateScript, ['get', 'archive-reopen', 'branch_status']);
    const confirmation = runNode(tmpDir, stateScript, [
      'get',
      'archive-reopen',
      'archive_confirmation',
    ]);

    expect(result.status).toBe(0);
    expect(phase.stdout.trim()).toBe('verify');
    expect(verifyResult.stdout.trim()).toBe('pending');
    expect(verifiedAt.stdout.trim()).toBe('null');
    expect(report.stdout.trim()).toBe('docs/superpowers/reports/archive-reopen.md');
    expect(branchStatus.stdout.trim()).toBe('pending');
    expect(confirmation.stdout.trim()).toBe('null');
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

    const result = runNode(tmpDir, stateScript, [
      'transition',
      'already-archived',
      'archive-reopen',
    ]);
    const confirm = runNode(tmpDir, stateScript, [
      'transition',
      'already-archived',
      'archive-confirm',
    ]);
    const phase = runNode(tmpDir, stateScript, ['get', 'already-archived', 'phase']);
    const verifyResult = runNode(tmpDir, stateScript, ['get', 'already-archived', 'verify_result']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already archived');
    expect(confirm.status).not.toBe(0);
    expect(confirm.stderr).toContain('already archived');
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

    const result = runNode(tmpDir, guardScript, ['guard-verify', 'verify', '--apply']);
    const phase = runNode(tmpDir, stateScript, ['get', 'guard-verify', 'phase']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[FAIL] verification_report exists');
    expect(result.stderr).not.toContain('branch_status=handled');
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
        'auto_transition: true',
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
    expect(runNode(tmpDir, guardScript, ['guard-verify', 'verify']).status).not.toBe(0);
    const recorded = runNode(tmpDir, stateScript, [
      'record-check',
      'guard-verify',
      'verify',
      '--command',
      'pnpm test',
      '--exit-code',
      '0',
    ]);
    expect(recorded.status, recorded.stderr).toBe(0);

    const result = runNode(tmpDir, guardScript, ['guard-verify', 'verify', '--apply']);
    const phase = runNode(tmpDir, stateScript, ['get', 'guard-verify', 'phase']);
    const verifyResult = runNode(tmpDir, stateScript, ['get', 'guard-verify', 'verify_result']);

    expect(result.status, result.stderr).toBe(0);
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

    const result = runNode(tmpDir, stateScript, ['transition', 'wrong-phase', 'build-complete']);
    const archiveConfirm = runNode(tmpDir, stateScript, [
      'transition',
      'wrong-phase',
      'archive-confirm',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('expected phase build');
    expect(archiveConfirm.status).not.toBe(0);
    expect(archiveConfirm.stderr).toContain('expected phase archive');
  });

  it('escalates preset workflows from build to design via preset-escalate', async () => {
    for (const workflow of ['hotfix', 'tweak'] as const) {
      const name = `escalate-${workflow}`;
      await createChange(
        tmpDir,
        name,
        [
          `workflow: ${workflow}`,
          'phase: build',
          'build_mode: direct',
          'build_pause: null',
          'tdd_mode: direct',
          'isolation: branch',
          'verify_mode: light',
          'review_mode: off',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runNode(tmpDir, stateScript, ['transition', name, 'preset-escalate']);
      const phase = runNode(tmpDir, stateScript, ['get', name, 'phase']);
      const escalatedWorkflow = runNode(tmpDir, stateScript, ['get', name, 'workflow']);
      const profile = runNode(tmpDir, stateScript, ['get', name, 'classic_profile']);
      const designDoc = runNode(tmpDir, stateScript, ['get', name, 'design_doc']);
      const buildMode = runNode(tmpDir, stateScript, ['get', name, 'build_mode']);
      const tddMode = runNode(tmpDir, stateScript, ['get', name, 'tdd_mode']);
      const reviewMode = runNode(tmpDir, stateScript, ['get', name, 'review_mode']);
      const isolation = runNode(tmpDir, stateScript, ['get', name, 'isolation']);

      expect(result.status).toBe(0);
      expect(phase.stdout.trim()).toBe('design');
      expect(escalatedWorkflow.stdout.trim()).toBe('full');
      expect(profile.stdout.trim()).toBe('full');
      expect(designDoc.stdout.trim()).toBe('null');
      expect(buildMode.stdout.trim()).toBe('null');
      expect(tddMode.stdout.trim()).toBe('null');
      expect(reviewMode.stdout.trim()).toBe('null');
      expect(isolation.stdout.trim()).toBe('null');
    }
  }, 20_000);

  it('rejects preset-escalate for full workflow and non-build phases', async () => {
    await createChange(
      tmpDir,
      'escalate-full',
      [
        'workflow: full',
        'phase: build',
        'build_mode: executing-plans',
        'build_pause: null',
        'tdd_mode: tdd',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: docs/superpowers/specs/x.md',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const fullResult = runNode(tmpDir, stateScript, [
      'transition',
      'escalate-full',
      'preset-escalate',
    ]);
    expect(fullResult.status).not.toBe(0);
    expect(fullResult.stderr).toContain('preset-escalate only applies to hotfix/tweak');

    await createChange(
      tmpDir,
      'escalate-wrong-phase',
      [
        'workflow: tweak',
        'phase: verify',
        'build_mode: direct',
        'build_pause: null',
        'tdd_mode: direct',
        'isolation: branch',
        'verify_mode: light',
        'review_mode: off',
        'design_doc: null',
        'plan: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
    );

    const wrongPhaseResult = runNode(tmpDir, stateScript, [
      'transition',
      'escalate-wrong-phase',
      'preset-escalate',
    ]);
    expect(wrongPhaseResult.status).not.toBe(0);
    expect(wrongPhaseResult.stderr).toContain('expected phase build');
  }, 20_000);

  it('reports error for malformed .comet.yaml on get', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'bad-yaml');
    await fs.mkdir(changeDir, { recursive: true });
    await writeFile(path.join(changeDir, '.comet.yaml'), 'workflow: full\nphase: [\n  broken\n');

    const result = runNode(tmpDir, stateScript, ['get', 'bad-yaml', 'phase']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid .comet.yaml');
  });

  it('marks archived changes through transition resolved by original change name', async () => {
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
        'archive_confirmation: confirmed',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, ['transition', 'done-change', 'archived']);
    const archived = runNode(tmpDir, stateScript, ['get', 'done-change', 'archived']);

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

      const result = runNode(tmpDir, stateScript, ['check', 'recover-open', 'open', '--recover']);

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

      const result = runNode(tmpDir, stateScript, ['check', 'recover-build', 'build', '--recover']);

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

      const result = runNode(tmpDir, stateScript, [
        'check',
        'recover-plan-ready',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('build_pause: DONE (plan-ready)');
      expect(result.stdout).toContain('Plan-ready pause');
      expect(result.stdout).toContain('choose isolation, build mode, TDD mode, and review mode');
    });

    it('outputs review mode selection guidance when recovering build phase', async () => {
      await createChange(
        tmpDir,
        'recover-review-mode',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: null',
          'review_mode: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: null',
          'plan: docs/superpowers/plans/review-mode-plan.md',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runNode(tmpDir, stateScript, [
        'check',
        'recover-review-mode',
        'build',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('review_mode: PENDING');
      expect(result.stdout).toContain('Review mode not selected');
      expect(result.stdout).toContain('ask user for off, standard, or thorough');
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
          'review_mode: standard',
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

      const result = runNode(tmpDir, stateScript, [
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
          'review_mode: standard',
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

      const result = runNode(tmpDir, stateScript, [
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
          'review_mode: off',
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

      const result = runNode(tmpDir, stateScript, [
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
          'tdd_mode: tdd',
          'review_mode: standard',
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

      const result = runNode(tmpDir, stateScript, [
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
          'tdd_mode: direct',
          'review_mode: standard',
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

      const result = runNode(tmpDir, stateScript, [
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
          'branch_status: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runNode(tmpDir, stateScript, [
        'check',
        'recover-verify',
        'verify',
        '--recover',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Phase: verify');
      expect(result.stdout).toContain('verify_result: DONE (pass)');
      expect(result.stdout).toContain('branch_status: DEFERRED (handled after the archive commit)');
      expect(result.stdout).toContain(
        'Continue to archive; branch handling happens after archive changes are committed',
      );
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

      const result = runNode(tmpDir, stateScript, [
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

      const result = runNode(tmpDir, stateScript, [
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
          'review_mode: standard',
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

      const result = runNode(tmpDir, stateScript, [
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

      const result = runNode(tmpDir, stateScript, [
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

      const result = runNode(tmpDir, stateScript, ['check', 'recover-normal', 'open']);

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
          'review_mode: off',
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

      const result = runNode(tmpDir, stateScript, [
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
      expect(yaml).toContain('branch_status: pending');
    });
  });

  describe('verify-fail invalidates premature branch handling', () => {
    it('resets branch_status so archive owns final branch handling', async () => {
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

      const result = runNode(tmpDir, stateScript, ['transition', 'branch-preserve', 'verify-fail']);

      expect(result.status).toBe(0);
      const yaml = await fs.readFile(
        path.join(tmpDir, 'openspec', 'changes', 'branch-preserve', '.comet.yaml'),
        'utf-8',
      );
      expect(yaml).toContain('verify_result: fail');
      expect(yaml).toContain('phase: build');
      expect(yaml).toContain('branch_status: pending');
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

      const result = runNode(tmpDir, stateScript, [
        'set',
        'path-traversal',
        'design_doc',
        '../../etc/passwd',
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("cannot contain '..'");
    });
  });

  describe('removed command fields', () => {
    it('rejects remaining unknown fields after removing legacy command fields', async () => {
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
          'z_custom: later',
          'build_command: npm run build; rm -rf /',
          'a_custom: earlier',
          '',
        ].join('\n'),
      );
      await fs.writeFile(path.join(changeDir, 'proposal.md'), 'p');
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      const result = runNode(tmpDir, guardScript, ['cmd-inject', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('unknown field(s): a_custom, z_custom');
      expect(result.stderr).not.toContain('build_command');
    }, 20_000);
  });

  describe('guard_open skips design.md for hotfix/tweak workflows', () => {
    it('passes open guard for hotfix workflow without design.md', async () => {
      await createChange(
        tmpDir,
        'hotfix-open-guard',
        [
          'workflow: hotfix',
          'phase: open',
          'build_mode: direct',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: branch',
          'verify_mode: light',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-17',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );
      await fs.rm(path.join(tmpDir, 'openspec/changes/hotfix-open-guard/design.md'));

      const result = runNode(tmpDir, guardScript, ['hotfix-open-guard', 'open'], {}, 15000);

      expect(
        result.status,
        JSON.stringify({ stderr: result.stderr, stdout: result.stdout, error: result.error }),
      ).toBe(0);
      expect(result.stderr).toContain('ALL CHECKS PASSED');
    }, 20_000);

    it('fails open guard for full workflow without design.md', async () => {
      await createChange(
        tmpDir,
        'full-open-guard',
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
          'created_at: 2026-06-17',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );
      await fs.rm(path.join(tmpDir, 'openspec/changes/full-open-guard/design.md'));

      const result = runNode(tmpDir, guardScript, ['full-open-guard', 'open'], {}, 15000);

      expect(
        result.status,
        JSON.stringify({ stderr: result.stderr, stdout: result.stdout, error: result.error }),
      ).not.toBe(0);
      expect(result.stderr).toContain('[FAIL] design.md exists and non-empty');
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

      const result = runNode(tmpDir, guardScript, ['no-designdoc', 'design']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('[FAIL] design_doc is recorded for full workflow');
    }, 20_000);
  });

  describe('comet-hook-guard.mjs — phase write guard', () => {
    it('allows all writes when no active comet change exists', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'foo.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it.each([
      ['valid pre-Run state', ''],
      [
        'legacy command fields',
        'build_command: node legacy-build.js\nverify_command: node legacy-verify.js\n',
      ],
    ])('does not mutate %s or create distributed Run files', async (_label, legacyFields) => {
      const changeDir = await createChange(
        tmpDir,
        'read-only-hook',
        [
          'workflow: full',
          'phase: design',
          'design_doc: null',
          'plan: null',
          'build_mode: null',
          'isolation: null',
          'verify_mode: null',
          'verify_result: pending',
          'verification_report: null',
          'verified_at: null',
          'archived: false',
          legacyFields,
        ].join('\n'),
      );
      const stateFile = path.join(changeDir, '.comet.yaml');
      const before = await fs.readFile(stateFile, 'utf8');

      const result = runHookGuard(
        tmpDir,
        hookGuardScript,
        hookStdin(path.join(tmpDir, 'src', 'feature.ts')),
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Current phase: design');
      expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
      await expect(fs.access(path.join(changeDir, '.comet'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

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

    it('allows matching docs/superpowers/ writes in design phase', async () => {
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
      const targetFile = path.join(docsDir, '2026-06-06-test-hook-design.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('allows the first standard Superpowers plan write without a private suffix', async () => {
      await createChange(
        tmpDir,
        'standard-plan-write',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/specs/standard-design.md',
          'plan: null',
          'build_mode: executing-plans',
          'isolation: branch',
          'verify_mode: null',
          'verify_result: pending',
          'verification_report: null',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      const target = path.join(
        tmpDir,
        'docs',
        'superpowers',
        'plans',
        '2026-07-13-durable-retries.md',
      );

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(target));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('phase: build, superpowers');
    }, 20_000);

    it('blocks a second write after the standard Superpowers plan slot is occupied', async () => {
      const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
      await createChange(
        tmpDir,
        'occupied-standard-plan',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/specs/occupied-standard-plan-design.md',
          `plan: ${recorded}`,
          'build_mode: executing-plans',
          'isolation: branch',
          'verify_mode: null',
          'verify_result: pending',
          'verification_report: null',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      const target = path.join(
        tmpDir,
        'docs',
        'superpowers',
        'plans',
        '2026-07-13-second-feature.md',
      );

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(target));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('plan is already recorded');
      expect(result.stderr).toContain(recorded);
    }, 20_000);

    it('blocks a named standard plan after the distributed plan slot is occupied', async () => {
      const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
      await createChange(
        tmpDir,
        'occupied-standard-plan',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/specs/occupied-standard-plan-design.md',
          `plan: ${recorded}`,
          'build_mode: executing-plans',
          'isolation: branch',
          'verify_mode: null',
          'verify_result: pending',
          'verification_report: null',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      const target = path.join(
        tmpDir,
        'docs',
        'superpowers',
        'plans',
        '2026-07-13-occupied-standard-plan-plan.md',
      );

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(target));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('plan is already recorded');
      expect(result.stderr).toContain(recorded);
    }, 20_000);

    it.skipIf(process.platform !== 'win32')(
      'blocks a Windows case-variant named plan after the distributed slot is occupied',
      async () => {
        const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
        await createChange(
          tmpDir,
          'windows-occupied-plan',
          [
            'workflow: full',
            'phase: build',
            'design_doc: docs/superpowers/specs/windows-occupied-plan-design.md',
            `plan: ${recorded}`,
            'build_mode: executing-plans',
            'isolation: branch',
            'verify_mode: null',
            'verify_result: pending',
            'verification_report: null',
            'verified_at: null',
            'archived: false',
            '',
          ].join('\n'),
        );
        const target = path.join(
          tmpDir,
          'Docs',
          'superpowers',
          'plans',
          '2026-07-13-windows-occupied-plan-plan.md',
        );

        const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(target));

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('plan is already recorded');
        expect(result.stderr).toContain(recorded);
      },
      20_000,
    );

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
      expect(result.stderr).toContain('Current phase: design');
      expect(result.stderr).toContain('This phase does not allow source writes');
      expect(result.stderr).not.toMatch(/[一-龥]/);
    }, 20_000);

    it('does not treat root .comet.yaml as a supported Comet config file', async () => {
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

      const result = runHookGuard(
        tmpDir,
        hookGuardScript,
        hookStdin(path.join(tmpDir, '.comet.yaml')),
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Current phase: design');
      expect(result.stderr).toContain('This phase does not allow source writes');
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
      expect(result.stderr).toContain('Current phase: open');
      expect(result.stderr).toContain('This phase does not allow source writes');
      expect(result.stderr).toContain('open');
      expect(result.stderr).not.toMatch(/[一-龥]/);
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
      expect(result.stderr).toContain('Current phase: archive');
      expect(result.stderr).toContain('This phase does not allow source writes');
      expect(result.stderr).toContain('archive');
      expect(result.stderr).not.toMatch(/[一-龥]/);
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

    it('skips changes with archived: true still in changes/ directory', async () => {
      // Old change: archived but not yet moved to archive/ subdirectory
      await createChange(
        tmpDir,
        'old-change',
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
          'archived: true',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'new-feature.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('allows new change artifact writes while another change is in archive phase (no state file yet)', async () => {
      // Existing change stalled in archive phase, not yet archived
      await createChange(
        tmpDir,
        'old-pending-archive',
        ['workflow: full', 'phase: archive', 'archived: false', ''].join('\n'),
      );

      // Brand-new change being created: artifacts written before .comet.yaml exists
      const newChangeDir = path.join(tmpDir, 'openspec', 'changes', 'refine-requirements');
      await fs.mkdir(newChangeDir, { recursive: true });
      const targetFile = path.join(newChangeDir, 'proposal.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('governs change-dir writes by the change own phase, not an unrelated active change', async () => {
      // Change A: stalled in archive phase, not yet archived
      await createChange(
        tmpDir,
        'a-old-archive',
        ['workflow: full', 'phase: archive', 'archived: false', ''].join('\n'),
      );
      // Change B: freshly created, its own state file at phase: open
      await createChange(
        tmpDir,
        'b-new-open',
        ['workflow: full', 'phase: open', 'archived: false', ''].join('\n'),
      );

      const targetFile = path.join(tmpDir, 'openspec', 'changes', 'b-new-open', 'proposal.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('allows docs/superpowers writes for the matching design change when another active change is open', async () => {
      await createChange(
        tmpDir,
        'cert-signature-auth',
        ['workflow: full', 'phase: open', 'archived: false', ''].join('\n'),
      );
      await createChange(
        tmpDir,
        'env-issue-ledger',
        [
          'workflow: full',
          'phase: design',
          'design_doc: null',
          'plan: null',
          'build_mode: null',
          'isolation: null',
          'verify_mode: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const docsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      await fs.mkdir(docsDir, { recursive: true });
      const targetFile = path.join(docsDir, 'env-issue-ledger-design.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('phase: design, superpowers');
    }, 20_000);

    it('matches docs/superpowers writes to the longest change name boundary', async () => {
      await createChange(
        tmpDir,
        'auth',
        ['workflow: full', 'phase: verify', 'archived: false', ''].join('\n'),
      );
      await createChange(
        tmpDir,
        'auth-v2',
        [
          'workflow: full',
          'phase: design',
          'design_doc: null',
          'plan: null',
          'build_mode: null',
          'isolation: null',
          'verify_mode: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );

      const docsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      await fs.mkdir(docsDir, { recursive: true });
      const targetFile = path.join(docsDir, '2026-06-06-auth-v2-design.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('phase: design, superpowers');
    }, 20_000);

    it('requires selection before a standard specs write with multiple active changes', async () => {
      await createChange(
        tmpDir,
        'a-open-change',
        ['workflow: full', 'phase: open', 'archived: false', ''].join('\n'),
      );
      await createChange(
        tmpDir,
        'z-design-change',
        ['workflow: full', 'phase: design', 'archived: false', ''].join('\n'),
      );

      const docsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      await fs.mkdir(docsDir, { recursive: true });
      const targetFile = path.join(docsDir, '2026-06-06-a-open-change-design.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('multiple active changes require a current change');
      expect(result.stderr).toContain('comet state select <change-name>');
    }, 20_000);

    it('requires selection before an unmatched standard specs write with multiple eligible changes', async () => {
      await createChange(
        tmpDir,
        'auth',
        ['workflow: full', 'phase: design', 'archived: false', ''].join('\n'),
      );
      await createChange(
        tmpDir,
        'payments',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/specs/payments-design.md',
          'archived: false',
          '',
        ].join('\n'),
      );

      const docsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      await fs.mkdir(docsDir, { recursive: true });
      const targetFile = path.join(docsDir, '2026-06-06-legacy-design.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('multiple active changes require a current change');
      expect(result.stderr).toContain('comet state select <change-name>');
    }, 20_000);

    it('requires a current change for repo source writes with multiple active changes', async () => {
      await createChange(
        tmpDir,
        'a-build-ready',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/specs/a-build-ready.md',
          'plan: null',
          'build_mode: executing-plans',
          'isolation: branch',
          'verify_mode: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      await writeFile(
        path.join(tmpDir, 'docs', 'superpowers', 'specs', 'a-build-ready.md'),
        '# Design\n',
      );
      await createChange(
        tmpDir,
        'z-design-active',
        ['workflow: full', 'phase: design', 'archived: false', ''].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'feature.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('multiple active changes require a current change');
      expect(result.stderr).toContain('a-build-ready');
      expect(result.stderr).toContain('z-design-active');
      expect(result.stderr).not.toContain('Current phase: design');
    }, 20_000);

    it('allows selected build source writes while another active change is in design', async () => {
      await createChange(
        tmpDir,
        'a-build-ready',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/specs/a-build-ready.md',
          'plan: null',
          'build_mode: executing-plans',
          'isolation: branch',
          'verify_mode: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      await createChange(
        tmpDir,
        'z-design-active',
        ['workflow: full', 'phase: design', 'archived: false', ''].join('\n'),
      );
      expect(runNode(tmpDir, stateScript, ['select', 'a-build-ready']).status).toBe(0);

      const targetFile = path.join(tmpDir, 'src', 'feature.ts');
      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('phase: build');
    }, 20_000);

    it('blocks full-workflow build source writes when design_doc is null (illegal jump)', async () => {
      await createChange(
        tmpDir,
        'full-build-no-doc',
        [
          'workflow: full',
          'phase: build',
          'build_mode: null',
          'isolation: null',
          'verify_mode: null',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          'auto_transition: true',
          '',
        ].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'feature.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('BLOCKED');
      expect(result.stderr).toContain('design_doc');
      expect(result.stderr).toContain(
        'Current phase: build (workflow: full), but design_doc is empty',
      );
      expect(result.stderr).not.toMatch(/[一-龥]/);
    }, 20_000);

    it('allows preset-workflow build source writes when design_doc is null', async () => {
      await createChange(
        tmpDir,
        'hotfix-build-no-doc',
        ['workflow: hotfix', 'phase: build', 'design_doc: null', 'archived: false', ''].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'fix.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('allows full-workflow build source writes once design_doc points to a file', async () => {
      await createChange(
        tmpDir,
        'full-build-with-doc',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/design.md',
          'archived: false',
          '',
        ].join('\n'),
      );
      await writeFile(path.join(tmpDir, 'docs/superpowers/design.md'), '# Design Doc\n');

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'feature.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('blocks source edits (Edit tool) during open phase same as Write', async () => {
      await createChange(tmpDir, 'edit-block-open', 'phase: open\narchived: false\n');

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'new-feature.ts');

      const editStdin = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: targetFile, old_string: 'old', new_string: 'new' },
      });

      const result = runHookGuard(tmpDir, hookGuardScript, editStdin);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('BLOCKED');
    }, 20_000);

    it('allows source edits (Edit tool) during build phase', async () => {
      await createChange(
        tmpDir,
        'edit-allow-build',
        ['workflow: hotfix', 'phase: build', 'design_doc: null', 'archived: false', ''].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'fix.ts');

      const editStdin = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: targetFile, old_string: 'bug', new_string: 'fix' },
      });

      const result = runHookGuard(tmpDir, hookGuardScript, editStdin);

      expect(result.status).toBe(0);
    }, 20_000);
  });
});
