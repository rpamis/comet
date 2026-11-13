import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  registerNativeRunnerInputArtifactLocked,
  nativeRunnerInputArtifactPaths,
} from '../../../domains/comet-native/native-runner-input-artifacts.js';
import { createNativeCapabilityKnowledgeProvider } from '../../../domains/comet-native/native-capability-discovery.js';
import { readCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';

describe('Native workflow file sizes', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-file-sizes-'));
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('retains complete runner input artifacts beyond 8 MiB', async () => {
    const paths = await nativeProjectPaths(root, 'docs');
    await fs.mkdir(path.join(paths.workspaceRuntimeRoot, 'native'), { recursive: true });
    const file = path.join(root, 'input.json');
    const source = JSON.stringify({ content: 'x'.repeat(8 * 1024 * 1024 + 1) });
    await fs.writeFile(file, source);
    let observed = '';
    await registerNativeRunnerInputArtifactLocked({
      paths,
      file,
      validateContent: (text) => {
        observed = text;
      },
    });
    expect(observed).toBe(source);
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set(['input.json']));
  });

  it('includes complete capability Specs beyond the former per-file and total byte budgets', async () => {
    await fs.mkdir(path.join(root, 'docs/comet/specs/auth'), { recursive: true });
    const source =
      '# Authentication\n' + 'x'.repeat(8 * 1024 * 1024 + 1) + '\nauthentication login\n';
    await fs.writeFile(path.join(root, 'docs/comet/specs/auth/spec.md'), source);
    const provider = await createNativeCapabilityKnowledgeProvider({
      projectRoot: root,
      scope: {
        workflow: 'native',
        currentSpecRoot: 'docs/comet/specs',
        archiveRoot: 'docs/comet/archive',
      },
    });
    const result = await provider.query({
      kind: 'search',
      query: {
        task: 'authentication',
        terms: ['authentication'],
        strongTerms: [],
        phraseTerms: [],
        weakTerms: [],
        remoteQuery: 'authentication',
      },
    });
    expect(result.kind).toBe('search');
    if (result.kind !== 'search') throw new Error('Expected search result');
    expect(result.results.length).toBe(1);
    expect(result.results[0].content === source).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('reads a valid current selection beyond 16 KiB without losing its ownership', async () => {
    await fs.mkdir(path.join(root, '.comet'));
    await fs.writeFile(
      path.join(root, '.comet/current-change.json'),
      ' '.repeat(20 * 1024) +
        JSON.stringify({
          schema: 'comet.selection.v2',
          workflow: 'native',
          change: 'large',
          branch: null,
        }),
    );
    expect(await readCometCurrentSelection(root)).toMatchObject({
      status: 'selected',
      selection: { workflow: 'native', change: 'large' },
    });
  });

  it('advances a brief beyond 1 MiB through public command bundles only after confirmation', async () => {
    const invoke = (command: string, args: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            path.resolve('assets/skills/comet-native/scripts', `comet-native-${command}.mjs`),
            ...args,
            '--project-root',
            root,
            '--json',
          ],
          { encoding: 'utf8', windowsHide: true, maxBuffer: 24 * 1024 * 1024 },
        ),
      );
    invoke('new', ['large-brief', '--runtime', 'compat']);
    const dir = path.join(root, 'docs/comet/changes/large-brief');
    const brief =
      '# Outcome\n支持大文档\n# Scope\n完整材料\n# Acceptance examples\n- 保留全文\n# Notes\n' +
      '正文\n'.repeat(200_000) +
      '\nEND';
    await fs.writeFile(path.join(dir, 'brief.md'), brief);
    await fs.mkdir(path.join(dir, 'specs/auth'), { recursive: true });
    await fs.writeFile(path.join(dir, 'specs/auth/spec.md'), '# Authentication\n');
    const shown = invoke('show', ['large-brief']);
    expect(shown.data.brief === brief).toBe(true);
    const prepared = invoke('next', ['large-brief', '--summary', 'Ready for confirmation']);
    expect(prepared.data.state.phase).toBe('shape');
    expect(prepared.data.state.loop.next_action).toBe('confirm-shape');
    const confirmed = invoke('next', [
      'large-brief',
      '--summary',
      'User approved',
      '--confirmed',
      '--expected-state-version',
      String(prepared.data.state.state_version),
      '--expected-action',
      'confirm-shape',
    ]);
    expect(confirmed.data.state.phase).toBe('build');
  });
});
