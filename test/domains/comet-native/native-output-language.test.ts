import { describe, expect, it } from 'vitest';
import {
  CLI_OUTPUT_MARKERS,
  cliHumanTextViolations,
} from '../../../domains/workflow-contract/output-envelope.js';
import { render } from '../../../domains/comet-native/native-cli-shared.js';
import {
  deriveNativeOutputEnvelope,
  NATIVE_HUMAN_TEXT_DENYLIST,
  nativeErrorEnvelope,
  nativeStatusSummaryLine,
} from '../../../domains/comet-native/native-output-language.js';

function communication(options: {
  required?: boolean;
  message?: string | null;
  instruction: string;
}) {
  return {
    required: options.required ?? false,
    message: options.message ?? null,
    suggestedReply: null,
    agentInstruction: options.instruction,
  };
}

const EN_INSTRUCTION =
  'Follow the continuation action. Unless required is true, continue without asking the user.';
const ZH_INSTRUCTION =
  '按 continuation 执行下一步。除非 required 为 true，否则继续推进，不要让用户处理内部工作流状态。';

function continuation(
  options: {
    disposition?: 'continue' | 'await-user' | 'blocked' | 'done';
    phase?: string;
    commandArgs?: string[] | null;
    communication?: ReturnType<typeof communication>;
  } = {},
) {
  return {
    schema: 'comet.native.continuation.v2',
    skill: 'comet-native',
    change: 'session-timeout',
    phase: options.phase ?? 'build',
    status: 'active',
    stateVersion: 12,
    disposition: options.disposition ?? 'continue',
    action: 'builder-handoff',
    commandArgs: options.commandArgs === undefined ? null : options.commandArgs,
    requiredInputs: [],
    inputOptions: [],
    runnerAction: { kind: 'none', candidateId: null, iteration: 1, attempt: 0 },
    userCommunication: options.communication ?? communication({ instruction: EN_INSTRUCTION }),
  };
}

describe('native output envelope derivation', () => {
  it('derives a continue envelope with the exact next command', () => {
    const envelope = deriveNativeOutputEnvelope({
      continuation: continuation({
        commandArgs: ['comet', 'native', 'next', 'session-timeout', '--runner-input', '<file>'],
      }),
      state: { acceptance: { total: 4, passed: 3, failed: 1, blocked: 0, pending: 0 } },
    });
    expect(envelope).toBeDefined();
    expect(envelope!.summary).toContain('session-timeout');
    expect(envelope!.summary).toContain('Build');
    expect(envelope!.summary).toContain('acceptance 3/4 passed (1 failed)');
    expect(envelope!.summary).toContain('ready to continue');
    expect(envelope!.next).toEqual({
      command: 'comet native next session-timeout --runner-input <file>',
    });
    expect(envelope!.user_message).toBeUndefined();
  });

  it('derives counts from a full portable state acceptance array', () => {
    const envelope = deriveNativeOutputEnvelope({
      continuation: continuation({ phase: 'shape' }),
      state: {
        acceptance: [
          { id: 'a1', result: 'passed' },
          { id: 'a2', result: 'pending' },
        ],
      },
    });
    expect(envelope!.summary).toContain('acceptance 1/2 passed (1 pending)');
  });

  it('sniffs zh-CN from the localized agent instruction and relays the user message', () => {
    const envelope = deriveNativeOutputEnvelope({
      continuation: continuation({
        disposition: 'await-user',
        phase: 'verify',
        commandArgs: null,
        communication: communication({
          required: true,
          message: '验证已暂停，等待你的决定。',
          instruction: ZH_INSTRUCTION,
        }),
      }),
    });
    expect(envelope!.summary).toContain('等待用户决定');
    expect(envelope!.user_message).toBe('验证已暂停，等待你的决定。');
    expect(envelope!.next!.ask_user).toContain('转述');
  });

  it('asks the user before exposing a confirmation command', () => {
    const envelope = deriveNativeOutputEnvelope({
      continuation: continuation({
        disposition: 'await-user',
        phase: 'verify',
        commandArgs: ['comet', 'native', 'next', 'session-timeout', '--confirmed'],
        communication: communication({
          required: true,
          message: 'The verification result needs your confirmation.',
          instruction: EN_INSTRUCTION,
        }),
      }),
    });

    expect(envelope!.next).toEqual({
      ask_user: expect.stringContaining('Relay the message below'),
    });
    expect(envelope!.next?.command).toBeUndefined();
  });

  it('renders a done disposition as a report-only next step', () => {
    const envelope = deriveNativeOutputEnvelope({
      continuation: continuation({ disposition: 'done', commandArgs: null }),
    });
    expect(envelope!.summary).toContain('complete');
    expect(envelope!.next!.ask_user).toContain('No further workflow action');
  });

  it('keeps a retry command for blocked dispositions that have one', () => {
    const envelope = deriveNativeOutputEnvelope({
      continuation: continuation({
        disposition: 'blocked',
        commandArgs: ['comet', 'native', 'next', 'session-timeout', '--retry-verifier'],
      }),
    });
    expect(envelope!.summary).toContain('paused');
    expect(envelope!.next).toEqual({
      command: 'comet native next session-timeout --retry-verifier',
    });
  });

  it('prefixes select and migration context onto the continuation envelope', () => {
    const selected = deriveNativeOutputEnvelope({
      selected: 'session-timeout',
      continuation: continuation(),
    });
    expect(selected!.summary).toMatch(/^Selected session-timeout\./);
    const migrated = deriveNativeOutputEnvelope({
      migration: { completed: true },
      continuation: continuation(),
    });
    expect(migrated!.summary).toContain('current Native format');
  });

  it('derives one line per change for the status page', () => {
    const envelope = deriveNativeOutputEnvelope({
      schema: 'comet.native.status-page.v2',
      total: 2,
      items: [
        {
          name: 'alpha',
          phase: 'build',
          status: 'active',
          acceptance: { total: 2, passed: 2, failed: 0, blocked: 0, pending: 0 },
        },
        { name: 'beta', phase: 'verify', status: 'await-user' },
      ],
    });
    const lines = envelope!.summary.split('\n');
    expect(lines[0]).toContain('2');
    expect(lines[1]).toContain('alpha');
    expect(lines[1]).toContain('in progress');
    expect(lines[2]).toContain('beta');
    expect(lines[2]).toContain('waiting for a user decision');
  });

  it('derives doctor envelopes in both health directions', () => {
    const healthy = deriveNativeOutputEnvelope({ healthy: true, repaired: true });
    expect(healthy!.summary).toContain('repaired automatically');
    const unhealthy = deriveNativeOutputEnvelope({
      healthy: false,
      findings: [{}, {}, {}],
    });
    expect(unhealthy!.summary).toContain('3 problems');
    expect(unhealthy!.next!.ask_user).toContain('--json');
  });

  it('derives root show and init envelopes from the same path payload', () => {
    const rootShow = deriveNativeOutputEnvelope({
      projectRoot: '/repo',
      artifactRoot: 'docs',
      nativeRoot: 'docs/comet-native',
      language: 'en',
      pendingRootMove: null,
    });
    expect(rootShow!.summary).toContain('docs/comet-native');
    const init = deriveNativeOutputEnvelope({
      projectRoot: '/repo',
      artifactRoot: 'docs',
      nativeRoot: 'docs/comet-native',
      language: 'en',
    });
    expect(init!.summary).toContain('Initialized Comet Native');
    expect(init!.summary).toContain('docs/comet-native');
  });

  it('localizes root show for a Chinese project', () => {
    const rootShow = deriveNativeOutputEnvelope({
      projectRoot: '/repo',
      artifactRoot: 'docs',
      nativeRoot: 'docs/comet-native',
      language: 'zh-CN',
      pendingRootMove: null,
    });
    expect(rootShow!.summary).toContain('产物位于');
    expect(rootShow!.summary).toContain('状态根目录');
  });

  it('returns undefined for shapes without a human story', () => {
    expect(deriveNativeOutputEnvelope(undefined)).toBeUndefined();
    expect(deriveNativeOutputEnvelope('text')).toBeUndefined();
    expect(deriveNativeOutputEnvelope({ value: 1 })).toBeUndefined();
  });

  it('maps stable error codes to human envelopes with machine detail retained', () => {
    const conflict = nativeErrorEnvelope({
      code: 'conflict',
      message: 'expected revision 7, got 8',
      data: { change: 'session-timeout' },
    })!;
    expect(conflict.summary).not.toContain('revision');
    expect(conflict.next).toEqual({ command: 'comet native status session-timeout --json' });
    const baseline = nativeErrorEnvelope({
      code: 'baseline-incomplete',
      message: 'snapshot incomplete',
    })!;
    expect(baseline.summary).toContain('size budget');
    expect(
      nativeErrorEnvelope({ code: 'usage', message: '--summary is required' }),
    ).toBeUndefined();
    expect(nativeErrorEnvelope({ code: 'internal', message: 'boom' })).toBeUndefined();
  });
});

describe('native render audience split', () => {
  it('replaces the raw JSON dump with the envelope in text mode', () => {
    const output = render(
      {
        command: 'status',
        exitCode: 0,
        data: {
          continuation: continuation({
            commandArgs: ['comet', 'native', 'next', 'session-timeout', '--runner-input', '<file>'],
          }),
        },
        text: '{\n  "schema": "comet.native.status.v2"\n}\n',
      },
      false,
    );
    expect(output.stdout).not.toContain('comet.native.status.v2');
    expect(output.stdout).toContain('session-timeout');
    expect(output.stdout).toContain(CLI_OUTPUT_MARKERS.next);
  });

  it('appends the machine projection behind --verbose', () => {
    const output = render(
      {
        command: 'status',
        exitCode: 0,
        data: { continuation: continuation(), marker: 'projection-payload' },
      },
      false,
      true,
    );
    expect(output.stdout).toContain('session-timeout');
    expect(output.stdout).toContain(CLI_OUTPUT_MARKERS.details);
    expect(output.stdout).toContain('projection-payload');
  });

  it('adds the envelope fields additively to the JSON contract', () => {
    const output = render(
      {
        command: 'status',
        exitCode: 0,
        data: {
          unchanged: true,
          continuation: continuation({
            commandArgs: ['comet', 'native', 'next', 'session-timeout', '--runner-input', '<file>'],
          }),
        },
      },
      true,
    );
    const parsed = JSON.parse(output.stdout!) as Record<string, unknown>;
    expect(parsed.command).toBe('status');
    expect(parsed.exitCode).toBe(0);
    expect((parsed.data as { unchanged: boolean }).unchanged).toBe(true);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.next).toEqual({
      command: 'comet native next session-timeout --runner-input <file>',
    });
  });

  it('keeps the machine detail line when rendering an error envelope', () => {
    const output = render(
      {
        command: 'next',
        exitCode: 73,
        data: { change: 'session-timeout' },
        error: { code: 'conflict', message: 'expected revision 7, got 8' },
        envelope: nativeErrorEnvelope({
          code: 'conflict',
          message: 'expected revision 7, got 8',
          data: { change: 'session-timeout' },
        }),
      },
      false,
    );
    expect(output.stderr).toContain('DETAIL: expected revision 7, got 8');
    expect(output.stderr).toContain('NEXT: comet native status session-timeout --json');
  });

  it('appends structured error data when --verbose is requested', () => {
    const output = render(
      {
        command: 'next',
        exitCode: 73,
        data: { change: 'session-timeout', expectedRevision: 7 },
        error: { code: 'conflict', message: 'expected revision 7, got 8' },
        envelope: nativeErrorEnvelope({
          code: 'conflict',
          message: 'expected revision 7, got 8',
          data: { change: 'session-timeout', expectedRevision: 7 },
        }),
      },
      false,
      true,
    );

    expect(output.stderr).toContain(CLI_OUTPUT_MARKERS.details);
    expect(output.stderr).toContain('"expectedRevision": 7');
  });

  it('falls back to plain text for commands without an envelope', () => {
    expect(
      render({ command: 'init', exitCode: 0, data: { a: 1 }, text: 'Initialized.\n' }, false),
    ).toEqual({ exitCode: 0, stdout: 'Initialized.\n' });
  });
});

describe('native human-line jargon lint', () => {
  const humanTexts = [
    ...(['continue', 'await-user', 'blocked', 'done'] as const).map((disposition) =>
      deriveNativeOutputEnvelope({
        continuation: continuation({
          disposition,
          commandArgs: disposition === 'continue' ? ['comet', 'native', 'next', 'x'] : null,
          communication:
            disposition === 'await-user'
              ? communication({
                  required: true,
                  message: 'Verification is paused.',
                  instruction: EN_INSTRUCTION,
                })
              : communication({ instruction: EN_INSTRUCTION }),
        }),
        state: { acceptance: { total: 3, passed: 2, failed: 1, blocked: 0, pending: 0 } },
      }),
    ),
    deriveNativeOutputEnvelope({ healthy: true }),
    deriveNativeOutputEnvelope({ healthy: false, findings: [{}] }),
    deriveNativeOutputEnvelope({
      schema: 'comet.native.status-page.v2',
      total: 1,
      items: [{ name: 'alpha', phase: 'build', status: 'active' }],
    }),
    nativeErrorEnvelope({ code: 'conflict', message: 'x', data: { change: 'c' } }),
    nativeErrorEnvelope({ code: 'baseline-incomplete', message: 'x' }),
    nativeErrorEnvelope({ code: 'workspace-isolation-required', message: 'x' }),
    nativeErrorEnvelope({ code: 'workspace-preparation-incomplete', message: 'x' }),
    nativeErrorEnvelope({ code: 'implementation-scope-stale', message: 'x' }),
  ].filter((value) => value !== undefined);

  it('writes one-line status summaries for the aggregator view in both locales', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const line = nativeStatusSummaryLine({
        name: 'alpha',
        phase: 'verify',
        status: 'await-user',
        acceptance: { passed: 2, total: 4 },
        locale,
      });
      expect(line).toContain('alpha');
      expect(line).toContain(locale === 'zh-CN' ? '等待用户决定' : 'waiting for a user decision');
      expect(line).toContain('2/4');
      const violations = cliHumanTextViolations(line, NATIVE_HUMAN_TEXT_DENYLIST);
      expect(violations, `"${line}" must stay human-only`).toEqual([]);
    }
  });

  it('keeps internal machine terms out of summary and user_message lines', () => {
    for (const envelope of humanTexts) {
      for (const text of [envelope.summary, envelope.user_message]) {
        if (text === undefined) continue;
        const violations = cliHumanTextViolations(text, NATIVE_HUMAN_TEXT_DENYLIST);
        expect(violations, `"${text}" must stay human-only`).toEqual([]);
      }
    }
  });
});
