import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  composeReleaseNotes,
  publishPackages,
  assertReleaseContext,
  checkReleaseCandidate,
  publishRelease,
  prepareReleasePackages,
} from '../../scripts/release/publish-release.mjs';

const changelog = `# Changelog

## What's Changed [0.5.4] - 2026-11-16

### Added

- **Parallel Shapes**: Plan changes independently.

### Fixed

- **Plugin Hooks**: Preserve write denials.

## What's Changed [0.5.3] - 2026-11-13

### Added

- **Old feature**: Already released.
`;

describe('release announcement', () => {
  it('inserts only the requested changelog between generated changes and contributors', () => {
    const generated = `## What's Changed
* Add Shapes by @contributor in https://github.com/rpamis/comet/pull/560

## New Contributors
* @contributor made their first contribution

**Full Changelog**: https://github.com/rpamis/comet/compare/0.5.3...0.5.4`;
    expect(composeReleaseNotes(changelog, '0.5.4', generated)).toEqual({
      previousTag: '0.5.3',
      body: `## What's Changed

* Add Shapes by @contributor in https://github.com/rpamis/comet/pull/560

### Added

- **Parallel Shapes**: Plan changes independently.

### Fixed

- **Plugin Hooks**: Preserve write denials.

### New Contributors

* @contributor made their first contribution

**Full Changelog**: https://github.com/rpamis/comet/compare/0.5.3...0.5.4
`,
    });
  });

  it('keeps the compare link last when there are no new contributors', () => {
    const result = composeReleaseNotes(
      changelog.replaceAll('\n', '\r\n'),
      '0.5.4',
      "## What's Changed\n* One PR\n\n**Full Changelog**: compare-url",
    );
    expect(result.body).toContain('### Fixed');
    expect(result.body).not.toContain('Old feature');
    expect(result.body.trimEnd()).toMatch(/\*\*Full Changelog\*\*: compare-url$/);
  });

  it('rejects a missing version instead of publishing the entire changelog', () => {
    expect(() => composeReleaseNotes(changelog, '0.5.9', '')).toThrow('Changelog');
  });

  it('preserves fenced examples and existing heading spacing', () => {
    const example = ['```markdown', '## Example', '* Literal example', '```'].join('\n');
    const input = `## What's Changed\n\n* One PR\n\n${example}`;
    const { body } = composeReleaseNotes(changelog, '0.5.4', input);
    expect(body).toContain(`## What's Changed\n\n* One PR\n\n${example}\n\n### Added\n\n`);
    expect(body).not.toContain("## What's Changed\n\n\n");
  });
});

describe('release candidate and final announcement', () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });

  async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-release-test-'));
    roots.push(root);
    for (const [file, contents] of Object.entries({
      'package.json': { name: '@rpamis/comet', version: '0.5.4' },
      'assets/manifest.json': { version: '0.5.4' },
      'plugin/codex/plugin.json': { version: '0.5.4' },
      '.agents/plugins/marketplace.json': {
        plugins: [{ name: 'comet', source: { version: '0.5.4' } }],
      },
    })) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), JSON.stringify(contents));
    }
    await fs.writeFile(path.join(root, 'CHANGELOG.md'), changelog);
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    git(['init', '--quiet']);
    git(['add', '.']);
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'test: candidate',
    ]);
    git(['tag', '0.5.3']);
    const head = git(['rev-parse', 'HEAD']);
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'rpamis/comet',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/master',
      GITHUB_SHA: head,
    };
    Object.assign(env, { GITHUB_RUN_ID: '42', RELEASE_SOURCE_RUN_ID: '42' });
    const receiptDir = path.join(root, '.tmp/release');
    await fs.mkdir(receiptDir, { recursive: true });
    await fs.writeFile(
      path.join(receiptDir, 'stage.json'),
      JSON.stringify({
        schema: 'comet.release-stage.v1',
        version: '0.5.4',
        head,
        runId: '42',
        body: composeReleaseNotes(
          changelog,
          '0.5.4',
          "## What's Changed\n* One PR\n\n**Full Changelog**: compare-url",
        ).body,
        packages: ['@rpamis/comet', '@rpamis/comet-codex-plugin', 'comet-dsh-plugin'].map(
          (name) => ({ name, status: 'staged', stageId: 'id-' + name }),
        ),
      }),
    );
    const options = { root, version: '0.5.4', action: 'finalize', env };
    const request = vi.fn(async (url: string, body?: unknown) => {
      if (url.includes('/releases?')) return [];
      if (url.includes('/actions/workflows/'))
        return {
          workflow_runs: [
            { head_sha: head, status: 'completed', conclusion: 'success', html_url: 'ci-url' },
          ],
        };
      if (url.endsWith('/generate-notes'))
        return {
          body: "## What's Changed\n* One PR\n\n**Full Changelog**: compare-url",
        };
      if (url.endsWith('/releases') && body) return { html_url: 'release-url' };
      return null;
    });
    return { root, git, head, options, request };
  }

  it('uses real Git ancestry and binds generated notes to the explicit commit and previous tag', async () => {
    const { options, request, head } = await fixture();
    const result = await checkReleaseCandidate(options, { request });
    expect(result.previousTag).toBe('0.5.3');
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/generate-notes'), {
      tag_name: '0.5.4',
      target_commitish: head,
      previous_tag_name: '0.5.3',
    });
    expect(result.body).toContain('### Added');
    expect(result.body).not.toContain('Old feature');
  });

  it.each(['failure', 'in_progress', 'other-commit'])(
    'does not wait for an unrelated master CI result: %s',
    async () => {
      const { options, request } = await fixture();
      await expect(checkReleaseCandidate(options, { request })).resolves.toHaveProperty('head');
      expect(request.mock.calls.some(([url]) => url.includes('/actions/workflows/'))).toBe(false);
    },
  );

  it('rejects dirty tracked sources and a version mismatch before any API request', async () => {
    const { root, options, request } = await fixture();
    await fs.appendFile(path.join(root, 'CHANGELOG.md'), '\nchanged');
    await expect(checkReleaseCandidate(options, { request })).rejects.toThrow('tracked changes');
    await expect(
      checkReleaseCandidate({ ...options, version: '0.5.5' }, { request }),
    ).rejects.toThrow('all use');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a release tag pointing at an earlier commit', async () => {
    const { git, root, options, request } = await fixture();
    git(['tag', '0.5.4']);
    await fs.appendFile(path.join(root, 'CHANGELOG.md'), '\n');
    git(['add', '.']);
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'test: changed',
    ]);
    const head = git(['rev-parse', 'HEAD']);
    await expect(
      checkReleaseCandidate({ ...options, env: { ...options.env, GITHUB_SHA: head } }, { request }),
    ).rejects.toThrow('different commit');
    expect(request).not.toHaveBeenCalled();
  });

  it('creates the announcement without assets only after all npm downloads succeed', async () => {
    const { options, request, head } = await fixture();
    const names = ['@rpamis/comet', '@rpamis/comet-codex-plugin', 'comet-dsh-plugin'];
    const verified: string[] = [];
    const transport = async (url: string, body?: unknown) => {
      if (new URL(url).hostname === 'registry.npmjs.org') {
        const name = decodeURIComponent(new URL(url).pathname.split('/')[1]);
        return { name, version: '0.5.4', gitHead: head };
      }
      if (url.endsWith('/releases') && body) expect(verified).toEqual(names);
      return request(url, body);
    };
    const prepare = async () => ({
      packages: names.map((name) => ({ name, tarball: `${name}.tgz` })),
      runNpm: async (args: string[]) => {
        const name = args[1].slice(0, args[1].lastIndexOf('@'));
        verified.push(name);
        return JSON.stringify([{ name, version: '0.5.4' }]);
      },
    });
    await publishRelease(options, { request: transport, prepare });
    const announcement = request.mock.calls.find(
      ([url, body]) => url.endsWith('/releases') && body,
    );
    expect(announcement?.[1]).toMatchObject({
      tag_name: '0.5.4',
      target_commitish: head,
      draft: false,
    });
    expect(announcement?.[1]).not.toHaveProperty('assets');
  });

  it('finalizes current master with older public npm packages and no staging record', async () => {
    const { options, request, head: packageHead, git } = await fixture();
    await fs.appendFile(path.join(options.root, 'CHANGELOG.md'), '\n');
    git(['add', 'CHANGELOG.md']);
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'test: master advances',
    ]);
    const head = git(['rev-parse', 'HEAD']);
    await fs.rm(path.join(options.root, '.tmp'), { recursive: true });
    const names = ['@rpamis/comet', '@rpamis/comet-codex-plugin', 'comet-dsh-plugin'];
    const transport = async (url: string, body?: unknown) => {
      if (new URL(url).hostname === 'registry.npmjs.org')
        return { version: '0.5.4', gitHead: packageHead };
      return request(url, body);
    };
    const result = await publishRelease(
      {
        ...options,
        env: {
          ...options.env,
          GITHUB_SHA: head,
          GITHUB_RUN_ID: undefined,
          RELEASE_SOURCE_RUN_ID: undefined,
        },
      },
      {
        request: transport,
        prepare: async () => ({
          packages: names.map((name) => ({ name })),
          runNpm: async (args: string[]) =>
            JSON.stringify([
              { name: args[1].slice(0, args[1].lastIndexOf('@')), version: '0.5.4' },
            ]),
        }),
      },
    );
    expect(head).not.toBe(packageHead);
    expect(result.head).toBe(head);
    expect(result.packages.every((item) => item.status === 'verified')).toBe(true);
    expect(result.body).toContain("## What's Changed\n\n* One PR");
    expect(request).toHaveBeenCalledWith(
      'https://api.github.com/repos/rpamis/comet/releases',
      expect.objectContaining({ tag_name: '0.5.4', target_commitish: head, body: result.body }),
    );
    expect(request.mock.calls.some(([url]) => url.includes('/actions/'))).toBe(false);
  });

  it('finalizes through the public CLI using version checks and downloads without rebuilding packages', async () => {
    const { root, options, head } = await fixture();
    await fs.rm(path.join(root, '.tmp'), { recursive: true });
    const npmLog = path.join(root, 'npm-commands.jsonl');
    const announcement = path.join(root, 'announcement.json');
    const fakeNpm = path.join(root, 'npm.mjs');
    await fs.writeFile(
      fakeNpm,
      `
      import { appendFileSync } from 'node:fs';
      const args = process.argv.slice(2);
      appendFileSync(${JSON.stringify(npmLog)}, JSON.stringify(args) + '\\n');
      if (args[0] !== 'pack' || !args[1].endsWith('@0.5.4')) throw new Error('Unexpected npm command');
      console.log(JSON.stringify([{ name: args[1].slice(0, args[1].lastIndexOf('@')), version: '0.5.4' }]));
    `,
    );
    const commandDirectory = path.join(root, 'dist/platform/process');
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(root, 'dist/package.json'), '{"type":"module"}');
    await fs.writeFile(
      path.join(commandDirectory, 'node-cli-command.js'),
      `
      export function resolveNpmCommand(args) {
        return { command: process.execPath, args: [${JSON.stringify(fakeNpm)}, ...args] };
      }
    `,
    );
    const transport = path.join(root, 'transport.mjs');
    await fs.writeFile(
      transport,
      `
      import { writeFileSync } from 'node:fs';
      globalThis.fetch = async (url, options) => {
        if (url.startsWith('https://registry.npmjs.org/')) {
          if (url.endsWith('/latest')) throw new Error('Finalize must check only the requested version');
          return Response.json({ version: '0.5.4' });
        }
        if (url.endsWith('/generate-notes')) return Response.json({ body: "## What's Changed\\n* Current master PR" });
        if (url.endsWith('/releases/tags/0.5.4')) return new Response('', { status: 404 });
        if (url.includes('/releases?')) return Response.json([]);
        if (url === 'https://api.github.com/repos/rpamis/comet/releases' && options.method === 'POST') {
          writeFileSync(${JSON.stringify(announcement)}, options.body);
          return Response.json({ html_url: 'https://example.invalid/release' });
        }
        throw new Error('Unexpected API request: ' + url);
      };
    `,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(transport).href,
        path.resolve('scripts/release/publish-release.mjs'),
        '--version',
        '0.5.4',
        '--action',
        'finalize',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ...options.env, GITHUB_STEP_SUMMARY: '' },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(announcement, 'utf8'))).toMatchObject({
      tag_name: '0.5.4',
      target_commitish: head,
      body: expect.stringContaining("## What's Changed\n\n* Current master PR"),
    });
    const commands = (await fs.readFile(npmLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(commands.map((args) => args.slice(0, 2))).toEqual([
      ['pack', '@rpamis/comet@0.5.4'],
      ['pack', '@rpamis/comet-codex-plugin@0.5.4'],
      ['pack', 'comet-dsh-plugin@0.5.4'],
    ]);
  });

  it('stage completes without waiting for npm approval or creating an announcement', async () => {
    const { options, request } = await fixture();
    const runNpm = vi.fn().mockRejectedValue(new Error('must reuse recorded stage IDs'));
    const names = ['@rpamis/comet', '@rpamis/comet-codex-plugin', 'comet-dsh-plugin'];
    const result = await publishRelease(
      { ...options, action: 'stage' },
      {
        request,
        prepare: async () => ({
          packages: names.map((name) => ({ name, tarball: `${name}.tgz` })),
          runNpm,
        }),
      },
    );
    expect(result.packages.every((item) => item.status === 'staged')).toBe(true);
    expect(runNpm).not.toHaveBeenCalled();
    expect(
      request.mock.calls.filter(([url]) => new URL(url).hostname === 'registry.npmjs.org'),
    ).toHaveLength(6);
    expect(request.mock.calls.some(([url, body]) => url.endsWith('/releases') && body)).toBe(false);
  });

  it('preview never saves a Release and a failed npm download never announces success', async () => {
    const { options, request, head } = await fixture();
    const transport = async (url: string, body?: unknown) =>
      new URL(url).hostname === 'registry.npmjs.org'
        ? { name: '@rpamis/comet', version: '0.5.4', gitHead: head }
        : request(url, body);
    const runNpm = vi.fn().mockRejectedValue(new Error('download failed'));
    const prepare = async () => ({
      packages: [{ name: '@rpamis/comet', tarball: 'main.tgz' }],
      runNpm,
    });
    await publishRelease({ ...options, action: 'preview' }, { request: transport, prepare });
    expect(runNpm).not.toHaveBeenCalled();
    await expect(publishRelease(options, { request: transport, prepare })).rejects.toThrow(
      'download failed',
    );
    expect(request.mock.calls.some(([url, body]) => url.endsWith('/releases') && body)).toBe(false);
  });

  it('keeps an already published announcement unchanged on a rerun', async () => {
    const { options, request, git, head } = await fixture();
    git(['tag', '0.5.4']);
    const transport = async (url: string, body?: unknown) => {
      if (url.endsWith('/releases/tags/0.5.4')) return { id: 12, draft: false };
      if (new URL(url).hostname === 'registry.npmjs.org')
        return { version: '0.5.4', gitHead: head };
      return request(url, body);
    };
    await publishRelease(options, {
      request: transport,
      prepare: async () => ({
        packages: [{ name: '@rpamis/comet', tarball: 'main.tgz' }],
        runNpm: async () => JSON.stringify([{ name: '@rpamis/comet', version: '0.5.4' }]),
      }),
    });
    expect(request.mock.calls.some(([url, body]) => url.endsWith('/releases') && body)).toBe(false);
  });

  it('publishes an existing draft only after its npm download is verified', async () => {
    const { options, request, head } = await fixture();
    let downloaded = false;
    const patch = vi.fn();
    const transport = async (url: string, body?: unknown, method?: string) => {
      if (url.endsWith('/releases/tags/0.5.4')) return null;
      if (url.includes('/releases?')) return [{ id: 12, tag_name: '0.5.4', draft: true }];
      if (new URL(url).hostname === 'registry.npmjs.org')
        return { version: '0.5.4', gitHead: head };
      if (method === 'PATCH') {
        expect(downloaded).toBe(true);
        patch(url, body);
        return { html_url: 'release-url' };
      }
      return request(url, body);
    };
    await publishRelease(options, {
      request: transport,
      prepare: async () => ({
        packages: [{ name: '@rpamis/comet', tarball: 'main.tgz' }],
        runNpm: async () => {
          downloaded = true;
          return JSON.stringify([{ name: '@rpamis/comet', version: '0.5.4' }]);
        },
      }),
    });
    expect(patch).toHaveBeenCalledWith(
      expect.stringContaining('/releases/12'),
      expect.objectContaining({ draft: false, target_commitish: head }),
    );
  });

  it('finds a pending-tag draft beyond the first release page', async () => {
    const { options, request } = await fixture();
    request.mockImplementation(async (url: string) => {
      if (url.includes('/actions/workflows/'))
        return {
          workflow_runs: [
            { head_sha: options.env.GITHUB_SHA, status: 'completed', conclusion: 'success' },
          ],
        };
      if (url.endsWith('/releases/tags/0.5.4')) return null;
      if (url.endsWith('/releases?per_page=100&page=1'))
        return Array.from({ length: 100 }, (_, id) => ({
          id,
          tag_name: `other-${id}`,
          draft: true,
        }));
      if (url.endsWith('/releases?per_page=100&page=2'))
        return [{ id: 112, tag_name: '0.5.4', draft: true }];
      if (url.endsWith('/generate-notes')) return { body: "## What's Changed\n* Changes" };
      throw new Error(`Unexpected request: ${url}`);
    });
    expect((await checkReleaseCandidate(options, { request })).release).toMatchObject({
      id: 112,
      draft: true,
    });
    expect(request.mock.calls.filter(([url]) => url.includes('/releases?'))).toHaveLength(2);
  });
});

describe('release workflow entry', () => {
  it('finalizes the selected master without a staged checkout, artifact or extra token', async () => {
    const source = await fs.readFile('.github/workflows/release.yml', 'utf8');
    const steps = parse(source).jobs.release.steps;
    const checkouts = steps.filter((step: { uses?: string }) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with.ref).toBe('${{ github.sha }}');
    const restore = steps.find((step: { uses?: string }) =>
      step.uses?.startsWith('actions/download-artifact@'),
    );
    expect(restore.if).toBe("inputs.action == 'stage' && github.run_attempt > 1");
    expect(restore.with['run-id']).toBe('${{ github.run_id }}');
    expect(source).not.toMatch(
      /findReleaseRun|resolveReleaseSource|RELEASE_SOURCE_SHA|RELEASE_SOURCE_RUN_ID|RELEASE_GITHUB_TOKEN/,
    );
    const publish = steps.find(
      (step: { name?: string }) => step.name === 'Preview, stage or finalize release',
    );
    expect(publish.run).toBe(
      'node scripts/release/publish-release.mjs --version "$RELEASE_VERSION" --action "$RELEASE_ACTION"',
    );
  });

  it('defaults to preview, serializes releases, and never attaches assets or starts Eval', async () => {
    const source = await fs.readFile('.github/workflows/release.yml', 'utf8');
    const workflow = parse(source);
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(['version', 'action']);
    expect(workflow.on.workflow_dispatch.inputs.action.default).toBe('preview');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.jobs.release.permissions['id-token']).toBe('write');
    expect(workflow.jobs.release.if).toContain("github.ref == 'refs/heads/master'");
    expect(source).not.toMatch(/gh release upload|comet eval|NPM_TOKEN/);
  });

  it('offers help without requiring a build or credentials, and rejects unintended flags', () => {
    const script = path.resolve('scripts/release/publish-release.mjs');
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain('Defaults to preview');
    const invalid = spawnSync(process.execPath, [script, '--publish'], { encoding: 'utf8' });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Usage:');
  });
});

describe('release package preparation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('packs three real npm artifacts with source commits and converts only shipped READMEs', async () => {
    const root = path.resolve('.');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-release-artifacts-'));
    const original = await fs.readFile('README.md');
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    try {
      const home = path.join(directory, 'home');
      const npmrc = path.join(directory, 'npmrc');
      await fs.mkdir(home);
      // Poison the isolated default config to prove the explicit userconfig wins.
      await fs.writeFile(path.join(home, '.npmrc'), 'dry-run=true\n');
      await fs.writeFile(npmrc, '');
      vi.stubEnv('HOME', home);
      vi.stubEnv('USERPROFILE', home);
      vi.stubEnv('npm_config_userconfig', npmrc);
      vi.stubEnv('npm_config_globalconfig', path.join(directory, 'global-npmrc'));
      vi.stubEnv('npm_config_cache', path.join(directory, 'npm-cache'));
      await fs.writeFile(path.join(directory, 'global-npmrc'), '');
      const { packages } = await prepareReleasePackages(directory, {
        root,
        version: pkg.version,
        head,
      });
      expect(packages.map((item) => item.name)).toEqual([
        '@rpamis/comet',
        '@rpamis/comet-codex-plugin',
        'comet-dsh-plugin',
      ]);
      for (const item of packages) {
        const metadata = JSON.parse(
          execFileSync('tar', ['-xOf', item.tarball, 'package/package.json'], { encoding: 'utf8' }),
        );
        expect(metadata).toMatchObject({ name: item.name, version: pkg.version, gitHead: head });
        expect(metadata.private).not.toBe(true);
        if (item.name === 'comet-dsh-plugin')
          expect(metadata.dependencies['@rpamis/comet']).toBe(pkg.version);
      }
      const readme = execFileSync('tar', ['-xOf', packages[0].tarball, 'package/README.md'], {
        encoding: 'utf8',
      });
      expect(readme).toContain('▶ Play the full demo</a>');
      expect(readme).toContain('https://github.com/rpamis/comet/blob/master/img/');
      expect(await fs.readFile('README.md')).toEqual(original);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('npm release sequence', () => {
  const names = ['@rpamis/comet', '@rpamis/comet-codex-plugin', 'comet-dsh-plugin'];
  const packages = names.map((name, index) => ({ name, tarball: '/staged/' + index + '.tgz' }));
  const options = { version: '0.5.4', head: 'current-commit', directory: '/download' };
  function registry(published = true) {
    const request = vi.fn(async () =>
      published ? { version: '0.5.4', gitHead: 'current-commit' } : null,
    );
    const runNpm = vi.fn(async (args: string[]) =>
      JSON.stringify([{ name: args[1].slice(0, args[1].lastIndexOf('@')), version: '0.5.4' }]),
    );
    return { request, runNpm };
  }
  it('previews all packages without publishing or downloading', async () => {
    const io = registry(false);
    const result = await publishPackages(packages, { ...options, action: 'preview' }, io);
    expect(result.map((item) => item.status)).toEqual(['pending', 'pending', 'pending']);
    expect(io.runNpm).not.toHaveBeenCalled();
  });
  it('pulls the approved main CLI before either plugin and never repeats uploads', async () => {
    const io = registry();
    for (let attempt = 0; attempt < 2; attempt++)
      await publishPackages(packages, { ...options, action: 'finalize' }, io);
    expect(io.runNpm.mock.calls.map(([args]) => args.slice(0, 2))).toEqual([
      ...names.map((name) => ['pack', name + '@0.5.4']),
      ...names.map((name) => ['pack', name + '@0.5.4']),
    ]);
  });
  it('rejects an existing plugin from another commit before publishing any package', async () => {
    const io = registry();
    io.request.mockImplementation(async (url: string) =>
      url.includes('codex') ? { version: '0.5.4', gitHead: 'other-commit' } : null,
    );
    await expect(publishPackages(packages, { ...options, action: 'stage' }, io)).rejects.toThrow(
      'other-commit',
    );
    expect(io.runNpm).not.toHaveBeenCalled();
  });
  it('finalize checks the requested public version without requiring gitHead or latest equality', async () => {
    const io = registry();
    io.request.mockResolvedValue({ version: '0.5.4' } as never);
    const result = await publishPackages(packages, { ...options, action: 'finalize' }, io);
    expect(result.every((item) => item.status === 'verified')).toBe(true);
    expect(io.request.mock.calls.every(([url]) => !url.endsWith('/latest'))).toBe(true);
  });
  it('rejects a different public version before downloading any package', async () => {
    const io = registry();
    io.request.mockResolvedValue({ version: '0.5.3' } as never);
    await expect(publishPackages(packages, { ...options, action: 'finalize' }, io)).rejects.toThrow(
      'version',
    );
    expect(io.runNpm).not.toHaveBeenCalled();
  });
  it('does not proceed to plugins when the main package cannot be pulled', async () => {
    const io = registry();
    io.runNpm.mockRejectedValueOnce(new Error('tarball unavailable'));
    await expect(publishPackages(packages, { ...options, action: 'finalize' }, io)).rejects.toThrow(
      'tarball unavailable',
    );
    expect(io.runNpm.mock.calls.map(([args]) => args[0])).toEqual(['pack']);
  });
  it('treats a registry outage as a failure, not an unpublished version', async () => {
    const io = registry();
    io.request.mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(publishPackages(packages, { ...options, action: 'finalize' }, io)).rejects.toThrow(
      '503',
    );
    expect(io.runNpm).not.toHaveBeenCalled();
  });
  it('does not move latest backwards when retrying an older partial release', async () => {
    const io = registry();
    io.request.mockImplementation(async (url: string) =>
      url.endsWith('/latest') ? ({ version: '0.6.0' } as never) : null,
    );
    await expect(publishPackages(packages, { ...options, action: 'stage' }, io)).rejects.toThrow(
      'older',
    );
    expect(io.runNpm).not.toHaveBeenCalled();
  });
});

describe('release authorization', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'rpamis/comet',
    GITHUB_REF: 'refs/heads/master',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_SHA: 'candidate',
  };

  it.each([
    {},
    { ...env, GITHUB_REF: 'refs/heads/054' },
    { ...env, GITHUB_EVENT_NAME: 'pull_request' },
    { ...env, GITHUB_REPOSITORY: 'someone/comet' },
    { ...env, GITHUB_SHA: 'other-commit' },
  ])('refuses live publishing outside the selected master run', (context) => {
    expect(() => assertReleaseContext(true, 'candidate', context)).toThrow();
  });

  it('allows a local preview and an explicitly selected master dispatch', () => {
    expect(() => assertReleaseContext(false, 'candidate', {})).not.toThrow();
    expect(() => assertReleaseContext(true, 'candidate', env)).not.toThrow();
  });
});
