import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeHookGuard } from '../../../domains/comet-native/native-hook-guard.js';
import { buildNativePortableAcceptance } from '../../../domains/comet-native/native-portable-acceptance.js';

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

  async function input(value: unknown) {
    const file = `${root}-input.json`;
    await fs.writeFile(file, JSON.stringify(value));
    try {
      return await command(['next', 'tiny', '--runner-input', file]);
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  it('reports document repair instead of a fictitious concurrent update', async () => {
    await fs.writeFile(path.join(changeDir, 'brief.md'), '# Outcome\nCorrect spelling.\n');
    const rejected = await command(['next', 'tiny', '--summary', 'Prepare Shape.']);
    expect(rejected.error?.code).toBe('document-invalid');
    expect(rejected.exitCode).toBe(65);
    expect(rejected.summary).not.toMatch(/updated elsewhere|another session/iu);
    expect(rejected.error?.message).toContain('brief-section-missing');
  });

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

  it.each([false, true])(
    'checks actual formal content after the Hook write instead of invalidating a write intention (changed: %s)',
    async (changed) => {
      const confirmed = await confirm();
      const request = { intent: 'write' as const, targets: [path.join(changeDir, 'brief.md')] };
      expect(await inspectNativeHookGuard(root, request, 'tiny')).toMatchObject({
        allowed: true,
        phase: 'build',
      });
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        changed
          ? brief.replace('Preserve the command usage.', 'Change the command usage.')
          : brief.replace('# Scope\n', '\n# Scope\n\n'),
      );
      const implementation = await inspectNativeHookGuard(
        root,
        { intent: 'write', targets: [path.join(root, 'main.js')] },
        'tiny',
      );
      expect(implementation).toMatchObject({
        allowed: !changed,
        phase: changed ? 'shape' : 'build',
      });
      const current = await command(['status', 'tiny']);
      expect(current.agent?.phase).toBe(changed ? 'shape' : 'build');
      if (!changed) expect(current.agent?.stateVersion).toBe(confirmed.agent?.stateVersion);
    },
  );

  it('still requires confirmation when meaningful constraints change', async () => {
    await confirm();
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      brief.replace('Preserve the command usage.', 'Change the public command usage.'),
    );
    const current = await command(['next', 'tiny', '--summary', 'Continue.']);
    expect(current.agent?.phase).toBe('shape');
  });

  it.each([false, true])(
    'checks deferred formal edits before accepting a Verifier result (changed: %s)',
    async (changed) => {
      await confirm();
      const dispatched = await input({
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
        checks: [],
        verification_checks: [],
        known_limits: [],
      });
      const packet = dispatched.data as unknown as {
        verifierDispatch: { candidateId: string; verifierExecutionRef: string };
        state: { loop: { iteration: number; attempt: number } };
      };
      expect(dispatched.agent?.phase).toBe('verify');
      expect(
        await inspectNativeHookGuard(
          root,
          { intent: 'write', targets: [path.join(changeDir, 'brief.md')] },
          'tiny',
        ),
      ).toMatchObject({ allowed: true, phase: 'verify' });
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        changed
          ? brief.replace('Preserve the command usage.', 'Change the command usage.')
          : brief.replace('# Scope\n', '\n# Scope\n\n'),
      );
      const result = await input({
        kind: 'verifier-response',
        candidateId: packet.verifierDispatch.candidateId,
        verifierExecutionRef: packet.verifierDispatch.verifierExecutionRef,
        response: {
          kind: 'final-result',
          result: {
            iteration: packet.state.loop.iteration,
            attempt: packet.state.loop.attempt,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'The spelling is correct.' }],
            risks: [],
            summary: 'Checked the current result.',
          },
        },
      });
      const current = await command(['status', 'tiny']);
      expect(current.agent?.phase).toBe(changed ? 'shape' : 'verify');
      expect(result.exitCode).toBe(changed ? 65 : 0);
      if (!changed)
        expect(result.data?.continuation).toMatchObject({
          action: 'confirm-skill-coordinated-pass',
        });
    },
  );

  it('dispatches directly after the explicit handoff plan and includes small acceptance scopes', async () => {
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
        checks: [],
        known_limits: [],
        verification_checks: [],
      }),
    );
    try {
      const result = await command(['next', 'tiny', '--runner-input', inputFile]);
      const packet = (
        result.data as unknown as {
          verifierDispatch: { acceptance: unknown; startupInput: unknown };
        }
      ).verifierDispatch;
      expect(result.exitCode).toBe(0);
      expect(packet).toMatchObject({
        acceptance: [{ id: 'A1', text: 'The greeting reads hello.' }],
        startupInput: { kind: 'verifier-started' },
      });
    } finally {
      await fs.rm(inputFile, { force: true });
    }
  });

  it('keeps the complete scope paginated when it does not fit in the task packet', async () => {
    const examples = Array.from({ length: 17 }, (_, index) => `Behavior ${index + 1} works.`);
    await confirm(
      brief.replace('- The greeting reads hello.', examples.map((text) => `- ${text}`).join('\n')),
    );
    const ids = examples.map((_, index) => `A${index + 1}`);
    const dispatched = await input({
      kind: 'builder-handoff',
      summary: 'Implemented the confirmed scope.',
      addressed_acceptance_ids: ids,
      acceptance_review: ids.map((id) => ({
        id,
        status: 'implemented-with-evidence',
        evidence: [`README documents ${id}.`],
        note: 'Checked the corresponding behavior.',
      })),
      checks: [],
      verification_checks: [],
      known_limits: [],
    });
    expect(dispatched.exitCode).toBe(0);
    const packet = (dispatched.data as unknown as { verifierDispatch: Record<string, unknown> })
      .verifierDispatch;
    expect(packet).not.toHaveProperty('acceptance');
    expect(packet).toMatchObject({ scopeCount: 17, scopeIds: ids });
    expect(packet.detailsPageArgs).toEqual(expect.arrayContaining(['status', '--details']));
  });

  it.each([
    ['soft wrap', 'Keep the command usage.', 'Keep the command\nusage.', 'build'],
    ['code', '```text\nhello\n```', '```text\nworld\n```', 'shape'],
    ['HTML', '<div>hello</div>', '<div>world</div>', 'shape'],
    ['link target', '[usage](./old.md)', '[usage](./new.md)', 'shape'],
    ['hard break', 'Keep the command\nusage.', 'Keep the command  \nusage.', 'shape'],
    ['paragraph', 'Keep the command\nusage.', 'Keep the command\n\nusage.', 'shape'],
    ['nested list', '- First\n  - Second', '- First\n- Second', 'shape'],
  ])('preserves Markdown meaning for %s', async (_name, before, after, phase) => {
    const source = brief.replace('Preserve the command usage.', before);
    await confirm(source);
    await fs.writeFile(path.join(changeDir, 'brief.md'), source.replace(before, after));
    expect((await command(['next', 'tiny', '--summary', 'Continue.'])).agent?.phase).toBe(phase);
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
