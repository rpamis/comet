import { describe, expect, it } from 'vitest';

import {
  COMET_HOOK_PLATFORM_IDS,
  parseCometHookRequest,
  renderCometHookDecision,
} from '../../../domains/comet-entry/hook-adapter.js';

const PLATFORM_FIXTURES = [
  {
    id: 'claude',
    single: { tool_name: 'Write', tool_input: { file_path: 'src/claude.ts' } },
  },
  {
    id: 'codex',
    single: { tool_name: 'Edit', tool_input: { file_path: 'src/codex.ts' } },
  },
  {
    id: 'windsurf',
    single: { file_path: 'src/windsurf.ts' },
  },
  {
    id: 'github-copilot',
    single: { toolName: 'create', toolArgs: '{"file_path":"src/github-copilot.ts"}' },
  },
  {
    id: 'gemini',
    single: { tool_name: 'write_file', tool_input: { file_path: 'src/gemini.ts' } },
  },
  {
    id: 'amazon-q',
    single: { tool_name: 'Write', tool_input: { file_path: 'src/amazon-q.ts' } },
  },
  {
    id: 'qwen',
    single: { tool_name: 'WriteFile', tool_input: { file_path: 'src/qwen.ts' } },
  },
  {
    id: 'kiro',
    single: {
      tool_name: 'write',
      tool_input: { operations: [{ mode: 'Line', path: 'src/kiro.ts' }] },
    },
  },
  {
    id: 'codebuddy',
    single: { tool_name: 'Write', tool_input: { file_path: 'src/codebuddy.ts' } },
  },
  {
    id: 'qoder',
    single: { tool_name: 'Write', tool_input: { file_path: 'src/qoder.ts' } },
  },
] as const;

describe('Comet Hook platform adapter', () => {
  it('keeps the fixture matrix aligned with every declared Hook platform', () => {
    expect(PLATFORM_FIXTURES.map(({ id }) => id)).toEqual([...COMET_HOOK_PLATFORM_IDS]);
  });

  it.each(PLATFORM_FIXTURES)('normalizes the $id native single-file payload', ({ id, single }) => {
    expect(parseCometHookRequest(JSON.stringify(single))).toMatchObject({
      intent: 'write',
      targets: [`src/${id}.ts`],
    });
  });

  it('normalizes Claude and Copilot payloads', () => {
    expect(
      parseCometHookRequest(
        JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'src/a.ts' } }),
      ),
    ).toEqual({ intent: 'write', targets: ['src/a.ts'], toolName: 'Write' });
    expect(
      parseCometHookRequest(
        JSON.stringify({
          toolName: 'apply_patch',
          toolArgs: { patch: '*** Update File: src/b.ts' },
        }),
      ),
    ).toEqual({ intent: 'write', targets: ['src/b.ts'], toolName: 'apply_patch' });
  });

  it('collects every target atomically and fails unknown writes closed', () => {
    expect(
      parseCometHookRequest(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_paths: ['src/a.ts', 'src/b.ts'] },
        }),
      ),
    ).toEqual({ intent: 'write', targets: ['src/a.ts', 'src/b.ts'], toolName: 'Edit' });
    expect(parseCometHookRequest('{broken')).toEqual({
      intent: 'unknown',
      targets: [],
      toolName: null,
    });
    expect(
      parseCometHookRequest(
        JSON.stringify({
          tool_name: 'FutureWriteTool',
          tool_input: { file_path: 'src/future.ts' },
        }),
      ),
    ).toEqual({
      intent: 'unknown',
      targets: ['src/future.ts'],
      toolName: 'FutureWriteTool',
    });
  });

  it('collects nested Kiro operation targets atomically', () => {
    expect(
      parseCometHookRequest(
        JSON.stringify({
          tool_name: 'write',
          tool_input: {
            operations: [
              { mode: 'Line', path: 'src/a.ts' },
              { mode: 'Line', path: 'src/b.ts' },
            ],
          },
        }),
      ),
    ).toEqual({
      intent: 'write',
      targets: ['src/a.ts', 'src/b.ts'],
      toolName: 'write',
    });
  });

  it.each(PLATFORM_FIXTURES)(
    'handles $id multi-file, patch, non-write, and malformed input',
    () => {
      expect(
        parseCometHookRequest(
          JSON.stringify({
            tool_name: 'Edit',
            tool_input: { file_paths: ['src/a.ts', 'src/b.ts'] },
          }),
        ),
      ).toMatchObject({ intent: 'write', targets: ['src/a.ts', 'src/b.ts'] });
      expect(
        parseCometHookRequest(
          JSON.stringify({
            tool_name: 'apply_patch',
            tool_input: {
              patch: '*** Update File: src/a.ts\n*** Add File: src/b.ts',
            },
          }),
        ),
      ).toMatchObject({ intent: 'write', targets: ['src/a.ts', 'src/b.ts'] });
      expect(
        parseCometHookRequest(
          JSON.stringify({ tool_name: 'Read', tool_input: { path: 'src/a.ts' } }),
        ),
      ).toEqual({ intent: 'non-write', targets: [], toolName: 'Read' });
      expect(parseCometHookRequest('{broken')).toEqual({
        intent: 'unknown',
        targets: [],
        toolName: null,
      });
    },
  );

  it('renders Copilot structured denial without granting permission on allow', () => {
    expect(
      renderCometHookDecision('github-copilot', { allowed: false, reason: 'blocked' }),
    ).toEqual({
      exitCode: 0,
      stdout: '{"permissionDecision":"deny","permissionDecisionReason":"blocked"}\n',
      stderr: '',
    });
    expect(renderCometHookDecision('github-copilot', { allowed: true, reason: 'allowed' })).toEqual(
      {
        exitCode: 0,
        stdout: '{}\n',
        stderr: '',
      },
    );
  });

  it.each(PLATFORM_FIXTURES.filter(({ id }) => id !== 'github-copilot'))(
    'renders $id allow and deny through its exit-code protocol',
    ({ id }) => {
      expect(renderCometHookDecision(id, { allowed: true, reason: 'allowed' })).toEqual({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });
      expect(renderCometHookDecision(id, { allowed: false, reason: 'blocked' })).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: 'blocked\n',
      });
    },
  );

  it('rejects an unknown platform instead of guessing its denial protocol', () => {
    expect(
      renderCometHookDecision('unknown-platform', { allowed: false, reason: 'blocked' }),
    ).toEqual({
      exitCode: 64,
      stdout: '',
      stderr: 'Unsupported Comet Hook platform: unknown-platform\n',
    });
  });
});
