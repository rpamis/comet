import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { inspectNativePortableAcceptanceDrift } from '../../../domains/comet-native/native-portable-requirements.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const brief = `# Outcome
Ship the selected capability.
# Scope
Keep the change focused.
## Directory structure
### Modified
- src/ — implement the selected capability.
# Non-goals
No unrelated changes.
# Acceptance examples
- The selected capability works.
# Constraints and invariants
Preserve other capabilities.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused checks.
`;

describe('Native Shape target replacement', () => {
  async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-shape-target-'));
    roots.push(root);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    const cli = async (...args: string[]) => {
      const argv = [
        ...args,
        ...(args.includes('--project-root') ? [] : ['--project-root', root]),
        ...(args.includes('--json') ? [] : ['--json']),
      ];
      const result = process.env.COMET_TEST_NATIVE_CLI_BUNDLE
        ? spawnSync(process.execPath, [process.env.COMET_TEST_NATIVE_CLI_BUNDLE, ...argv], {
            encoding: 'utf8',
          })
        : await runNativeCli(argv);
      expect(result.stdout, JSON.stringify(result)).toBeTruthy();
      return JSON.parse(result.stdout!);
    };
    expect((await cli('new', 'replace-target', '--runtime', 'sdk')).exitCode).toBe(0);
    const change = path.join(root, 'docs/comet/changes/replace-target');
    const canonical = path.join(root, 'docs/comet/specs/original/spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, '# Original\nThe original capability remains available.\n');
    await fs.writeFile(path.join(change, 'brief.md'), brief);
    const target = async (name: string) => {
      await fs.mkdir(path.join(change, 'specs', name), { recursive: true });
      await fs.writeFile(
        path.join(change, 'specs', name, 'spec.md'),
        `# ${name}\nThe selected capability works.\n`,
      );
    };
    await target('original');
    const next = () => cli('next', 'replace-target', '--summary', 'Prepare complete Shape');
    expect((await next()).exitCode).toBe(0);
    const state = async () =>
      parse(await fs.readFile(path.join(change, 'comet-state.yaml'), 'utf8'));
    const reprepare = async () => {
      const status = await cli('status', 'replace-target');
      const option = status.data.continuation.commandAlternatives.find(
        (entry: { name: string }) => entry.name === 'revise-requirements',
      );
      expect(option, JSON.stringify(status.data.continuation)).toBeDefined();
      return cli(
        ...option.commandArgs
          .slice(2)
          .map((arg: string) => (arg === '<summary>' ? 'Replace the unapproved target' : arg)),
      );
    };
    return { cli, root, change, canonical, target, state, next, reprepare };
  }

  it('replaces an unapproved target without removing the canonical capability', async () => {
    const f = await fixture();
    expect((await f.state()).spec_changes).toMatchObject([
      { capability: 'original', operation: 'modify' },
    ]);
    const canonicalBefore = await fs.readFile(f.canonical, 'utf8');
    await fs.rm(path.join(f.change, 'specs/original'), { recursive: true });
    await f.target('replacement');
    const oldState = await f.state();
    const stale = await f.cli(
      'next',
      'replace-target',
      '--confirmed',
      '--summary',
      'Old approval',
      '--expected-state-version',
      String(oldState.state_version),
      '--expected-action',
      'confirm-shape',
    );
    expect(stale.exitCode).not.toBe(0);
    expect(await f.state()).toEqual(oldState);
    const prepared = await f.reprepare();
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ exitCode: 0 });
    const state = await f.state();
    expect(state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      spec_changes: [
        { capability: 'replacement', operation: 'create', source: 'specs/replacement/spec.md' },
      ],
    });
    expect(state.spec_changes).toHaveLength(1);
    const staleAfter = await f.cli(
      'next',
      'replace-target',
      '--confirmed',
      '--summary',
      'Old approval',
      '--expected-state-version',
      String(oldState.state_version),
      '--expected-action',
      'confirm-shape',
    );
    expect(staleAfter.exitCode).not.toBe(0);
    expect(await f.state()).toEqual(state);
    expect(await fs.readFile(f.canonical, 'utf8')).toBe(canonicalBefore);
    const confirmed = await f.cli(
      'next',
      'replace-target',
      '--confirmed',
      '--summary',
      'User approved the replacement Shape',
      '--expected-state-version',
      String(state.state_version),
      '--expected-action',
      'confirm-shape',
    );
    expect(confirmed, JSON.stringify(confirmed)).toMatchObject({ exitCode: 0 });
    expect((await f.state()).phase).toBe('build');
    await fs.rm(path.join(f.change, 'specs/replacement'), { recursive: true });
    const approvedState = await f.state();
    const missing = await f.next();
    expect(missing.exitCode).toBe(0);
    expect(
      await inspectNativePortableAcceptanceDrift({
        paths: await nativeProjectPaths(f.root, 'docs'),
        state: approvedState,
      }),
    ).toMatchObject({ drifted: true, reason: expect.stringContaining('spec-document-missing') });
    expect(await f.state()).toEqual(approvedState);
    expect(await fs.readFile(f.canonical, 'utf8')).toBe(canonicalBefore);
  });
  it('requires an explicit exemption after withdrawing the last unapproved target', async () => {
    const f = await fixture();
    await fs.rm(path.join(f.change, 'specs/original'), { recursive: true });
    const rejected = await f.reprepare();
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.error.message).toContain('spec-exemption-missing');
    expect((await f.state()).status).toBe('active');
    await fs.writeFile(
      path.join(f.change, 'brief.md'),
      brief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: documentation-only wording correction.',
      ),
    );
    const prepared = await f.next();
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ exitCode: 0 });
    expect(await f.state()).toMatchObject({ status: 'await-user', spec_changes: [] });
    expect(await fs.readFile(f.canonical, 'utf8')).toContain(
      'The original capability remains available.',
    );
  });
  it('preserves an explicit removal while refreshing the unapproved target set', async () => {
    const f = await fixture();
    const retired = path.join(f.root, 'docs/comet/specs/retired/spec.md');
    await fs.mkdir(path.dirname(retired), { recursive: true });
    await fs.writeFile(
      retired,
      '# Retired\nThe retired capability is still canonical until Archive.\n',
    );
    const removed = await f.cli('spec', 'remove', 'replace-target', 'retired');
    expect(removed, JSON.stringify(removed)).toMatchObject({ exitCode: 0 });
    await fs.rm(path.join(f.change, 'specs/original'), { recursive: true });
    await f.target('replacement');
    const prepared = await f.next();
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ exitCode: 0 });
    expect((await f.state()).spec_changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'retired', operation: 'remove', source: null }),
        expect.objectContaining({ capability: 'replacement', operation: 'create' }),
      ]),
    );
    expect((await f.state()).spec_changes).toHaveLength(2);
    expect(await fs.readFile(retired, 'utf8')).toContain('still canonical until Archive');
    expect(await fs.readFile(f.canonical, 'utf8')).toContain(
      'The original capability remains available.',
    );
  });
});
