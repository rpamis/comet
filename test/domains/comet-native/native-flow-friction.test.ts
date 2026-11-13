import '../../helpers/isolated-agent-home.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { buildNativePortableAcceptance } from '../../../domains/comet-native/native-portable-acceptance.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

const brief = `# Outcome
Correct the greeting.
# Scope
Change the greeting only.
## Directory structure
### Created
None.
### Modified
- README.md — correct the greeting sentence.
### Deleted
None.
### Not created
None.
# Non-goals
None.
# Acceptance examples
- The greeting reads hello.
# Constraints and invariants
Preserve the command usage.
# Decisions
No product behavior change: correct documentation spelling only.
# Open questions
None.
# Verification expectations
Inspect the changed text.
`;

describe('Native workflow friction regressions', () => {
  let root: string;
  let changeDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-flow-friction-'));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, {
      ...config,
      native: { ...config.native, document_writes: 'revert' },
    });
    await command(['new', 'tiny', '--runtime', 'compat', '--language', 'en']);
    changeDir = path.join(root, 'docs', 'comet', 'changes', 'tiny');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function command(args: string[]) {
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    return JSON.parse(result.stdout!) as {
      exitCode: number;
      summary?: string;
      error?: { code: string; message: string };
      data?: { state: { phase: string; state_version: number }; continuation: unknown };
      agent?: { phase: string; stateVersion: number };
    };
  }

  async function confirm(source = brief) {
    await fs.writeFile(path.join(changeDir, 'brief.md'), source);
    const prepared = await command([
      'next',
      'tiny',
      '--summary',
      'Correct documentation spelling.',
    ]);
    expect(prepared.exitCode).toBe(0);
    const confirmed = await command([
      'next',
      'tiny',
      '--confirmed',
      '--summary',
      'User confirmed the complete Shape.',
      '--expected-state-version',
      String(prepared.agent!.stateVersion),
      '--expected-action',
      'confirm-shape',
    ]);
    expect(confirmed.agent?.phase).toBe('build');
    return confirmed;
  }

  async function reportedChecks(ids: string[]) {
    // SIMULATED Agent implementation; the platform Node check actually reads the result.
    await fs.writeFile(
      path.join(root, 'README.md'),
      'hello\n' + ids.map((id) => id + ': documented').join('\n') + '\n',
    );
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs'),assert=require('node:assert/strict');const text=fs.readFileSync('README.md','utf8');assert(text.includes('hello'));for(const id of ${JSON.stringify(ids)})assert(text.includes(id+': documented'));process.stdout.write('verified '+${ids.length}+' acceptance records');`,
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    return [{ name: 'README acceptance content', result: 'passed', note: output }];
  }

  async function input(value: unknown) {
    const file = `${root}-input.json`;
    await fs.writeFile(file, JSON.stringify(value));
    try {
      return await command(['next', 'tiny', '--runner-input', file]);
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  it('accepts a focused four-section brief without inventing optional material', async () => {
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Correct documentation spelling.
# Scope
README only. No product behavior change: correct a spelling mistake.
## Directory structure
### Created
None.
### Modified
- README.md — correct the spelling mistake.
### Deleted
None.
### Not created
None.
# Non-goals
None.
# Acceptance examples
- README spells hello correctly.
`,
    );
    const prepared = await command(['next', 'tiny', '--summary', 'Correct the README spelling.']);
    expect(prepared.exitCode).toBe(0);
    expect(prepared.agent?.phase).toBe('shape');
  });

  it('keeps the confirmed goal when only spacing around headings changes', async () => {
    const confirmed = await confirm();
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      brief.replace('# Scope\n', '\n# Scope\n\n'),
    );
    const current = await command(['next', 'tiny', '--summary', 'Continue the confirmed work.']);
    expect(current.exitCode).toBe(0);
    expect(current.agent?.phase).toBe('build');
    expect(current.agent?.stateVersion).toBe(confirmed.agent?.stateVersion);
  });

  it('returns the current Builder action on recovery without advancing the phase', async () => {
    const confirmed = await confirm();
    const current = await command(['next', 'tiny', '--summary', 'Resume the current task.']);
    expect(current.exitCode).toBe(0);
    expect(current.agent).toMatchObject({
      phase: 'build',
      stateVersion: confirmed.agent!.stateVersion,
    });
    expect(current.data?.continuation).toMatchObject({ action: 'builder-handoff' });
  });

  it('dispatches the accepted Builder report explicitly and includes the complete small acceptance scope', async () => {
    await confirm();
    const inputFile = `${root}-handoff.json`;
    await fs.writeFile(
      inputFile,
      JSON.stringify({
        kind: 'builder-handoff',
        summary: 'Corrected the documentation spelling.',
        addressed_acceptance_ids: ['A1'],
        acceptance_review: [
          {
            id: 'A1',
            status: 'implemented-with-evidence',
            evidence: ['README contains hello.'],
            note: 'Matches the confirmed spelling.',
          },
        ],
        checks: await reportedChecks(['A1']),
        known_limits: [],
      }),
    );
    try {
      const submitted = await command(['next', 'tiny', '--runner-input', inputFile]);
      expect(submitted.exitCode).toBe(0);
      expect(submitted.data?.continuation).toMatchObject({ action: 'dispatch-verifier' });
      const result = await input({
        kind: 'dispatch-verifier',
        verifierExecutionRef: 'SIMULATED-independent-verifier',
      });
      const packet = (
        result.data as unknown as {
          verifierDispatch: { acceptance: unknown; startupInput: unknown };
        }
      ).verifierDispatch;
      expect(result.exitCode).toBe(0);
      expect(packet).toMatchObject({
        acceptance: [{ id: 'A1', text: 'The greeting reads hello.' }],
        verifierExecutionRef: 'SIMULATED-independent-verifier',
        checks: [
          expect.objectContaining({
            name: { text: 'README acceptance content', truncated: false },
            result: 'passed',
            note: { text: 'verified 1 acceptance records', truncated: false },
          }),
        ],
      });
    } finally {
      await fs.rm(inputFile, { force: true });
    }
  });

  it('keeps all 17 confirmed acceptance items in the platform task and typed details pages', async () => {
    const examples = Array.from({ length: 17 }, (_, index) => `Behavior ${index + 1} works.`);
    await confirm(
      brief.replace('- The greeting reads hello.', examples.map((text) => `- ${text}`).join('\n')),
    );
    const ids = examples.map((_, index) => `A${index + 1}`);
    const submitted = await input({
      kind: 'builder-handoff',
      summary: 'Implemented the confirmed scope.',
      addressed_acceptance_ids: ids,
      acceptance_review: ids.map((id) => ({
        id,
        status: 'implemented-with-evidence',
        evidence: [`README documents ${id}.`],
        note: 'Checked the corresponding behavior.',
      })),
      checks: await reportedChecks(ids),
      known_limits: [],
    });
    expect(submitted.exitCode).toBe(0);
    expect(submitted.data?.continuation).toMatchObject({ action: 'dispatch-verifier' });
    const dispatched = await input({
      kind: 'dispatch-verifier',
      verifierExecutionRef: 'SIMULATED-full-scope-verifier',
    });
    expect(dispatched.exitCode).toBe(0);
    const packet = (dispatched.data as unknown as { verifierDispatch: Record<string, unknown> })
      .verifierDispatch;
    expect(packet.acceptance).toEqual(
      examples.map((text, index) => expect.objectContaining({ id: ids[index], text })),
    );
    expect(packet).toMatchObject({
      checks: [
        expect.objectContaining({
          result: 'passed',
          note: { text: 'verified 17 acceptance records', truncated: false },
        }),
      ],
    });
    // The retired size projection no longer duplicates scopeCount/scopeIds/startupInput.
    // Typed details pages must still preserve every original acceptance ID and text.
    const received: Array<{ id: string; text: string }> = [];
    let cursor: string | null = null;
    do {
      const page = await command([
        'status',
        'tiny',
        '--details',
        ...(cursor ? ['--cursor', cursor] : []),
      ]);
      expect(page.exitCode).toBe(0);
      const details = (
        page.data as unknown as {
          details: {
            items: Array<{ kind: string; value: { id: string; text: string } }>;
            nextCursor: string | null;
          };
        }
      ).details;
      received.push(
        ...details.items.filter((item) => item.kind === 'acceptance').map((item) => item.value),
      );
      cursor = details.nextCursor;
    } while (cursor);
    expect(received.map(({ id, text }) => ({ id, text }))).toEqual(
      examples.map((text, index) => ({ id: ids[index], text })),
    );
  });

  it.each(['A0', 'A01', 'a1', 'A1 A2', ''])(
    'rejects malformed Spec acceptance reference %s',
    (reference) => {
      expect(() =>
        buildNativePortableAcceptance({
          resolveBriefReferences: true,
          briefMarkdown: '# Acceptance examples\n- The greeting reads hello.\n',
          specs: [
            {
              capability: 'greeting',
              source: 'specs/greeting/spec.md',
              markdown: `### Scenario: Greeting\nAcceptance: ${reference}\n`,
            },
          ],
        }),
      ).toThrow(/reference must be one brief ID/iu);
    },
  );

  it('lets a Spec reference a brief criterion without creating a second criterion', () => {
    const acceptance = buildNativePortableAcceptance({
      resolveBriefReferences: true,
      briefMarkdown: '# Acceptance examples\n- The greeting reads hello.\n',
      specs: [
        {
          capability: 'greeting',
          source: 'specs/greeting/spec.md',
          markdown:
            '### Scenario: Greeting spelling\nAcceptance: A1\nWHEN the greeting is displayed\nTHEN it reads hello.\n',
        },
      ],
    });
    expect(acceptance).toEqual([
      { id: 'A1', source: 'brief.md', text: 'The greeting reads hello.' },
    ]);
  });

  it('rejects a Spec reference to a missing brief criterion', () => {
    expect(() =>
      buildNativePortableAcceptance({
        resolveBriefReferences: true,
        briefMarkdown: '# Acceptance examples\n- The greeting reads hello.\n',
        specs: [
          {
            capability: 'greeting',
            source: 'specs/greeting/spec.md',
            markdown: '### Scenario: Greeting\nAcceptance: A2\n',
          },
        ],
      }),
    ).toThrow(/unknown brief acceptance/iu);
  });

  it('keeps previously confirmed Spec reference text as a separate legacy criterion', () => {
    const acceptance = buildNativePortableAcceptance({
      briefMarkdown: '# Acceptance examples\n- The greeting reads hello.\n',
      specs: [
        {
          capability: 'greeting',
          source: 'specs/greeting/spec.md',
          markdown:
            '### Scenario: Greeting\nAcceptance: A1\nWHEN the greeting is displayed\nTHEN it reads hello.\n',
        },
      ],
    });
    expect(acceptance.map(({ id }) => id)).toEqual(['A1', 'A2']);
    expect(acceptance[1].text).toContain('Acceptance: A1');
  });
});
