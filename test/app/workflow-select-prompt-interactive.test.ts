import { describe, expect, it, vi } from 'vitest';

type TestKey = { name?: string };
type TestGlobal = typeof globalThis & { __cometWorkflowPromptKeys?: TestKey[] };

vi.mock('@inquirer/ansi', () => ({ cursorHide: '' }));
vi.mock('@inquirer/figures', () => ({ default: { pointer: '>' } }));
vi.mock('@inquirer/core', () => ({
  createPrompt:
    (render: (config: unknown, done: (value: unknown) => void) => string) =>
    async (config: unknown) => {
      let value: unknown;
      const rendered = render(config, (next) => {
        value = next;
      });
      return value ?? rendered;
    },
  isDownKey: (key: TestKey) => key.name === 'down',
  isEnterKey: (key: TestKey) => key.name === 'enter',
  isUpKey: (key: TestKey) => key.name === 'up',
  makeTheme: (theme: unknown) => theme,
  useKeypress: (handler: (key: TestKey) => void) => {
    const testGlobal = globalThis as TestGlobal;
    for (const key of testGlobal.__cometWorkflowPromptKeys ?? []) handler(key);
    testGlobal.__cometWorkflowPromptKeys = [];
  },
  usePrefix: () => 'prefix',
  useState: <Value>(
    initial: Value,
  ): [Value, (next: Value | ((current: Value) => Value)) => void] => {
    let current = initial;
    return [
      current,
      (next) => {
        current = typeof next === 'function' ? (next as (current: Value) => Value)(current) : next;
      },
    ];
  },
}));

describe('workflow select prompt interaction branches', () => {
  it('renders details, handles navigation, and selects the configured default', async () => {
    const testGlobal = globalThis as TestGlobal;
    testGlobal.__cometWorkflowPromptKeys = [{ name: 'down' }, { name: 'up' }, { name: 'enter' }];
    const { workflowSelectPrompt } = await import('../../app/commands/workflow-select-prompt.js');

    await expect(
      workflowSelectPrompt({
        message: 'Workflow',
        default: 'native',
        choices: [
          { name: 'Classic', value: 'classic', details: ['传统', '检查', '归档'] },
          {
            name: 'Native 中文',
            short: 'Native',
            value: 'native',
            details: ['原生', '验证', '恢复'],
          },
        ],
      }),
    ).resolves.toBe('native');
  });

  it('rejects an empty choice list before rendering', async () => {
    const { workflowSelectPrompt } = await import('../../app/commands/workflow-select-prompt.js');

    await expect(workflowSelectPrompt({ message: 'Workflow', choices: [] })).rejects.toThrow(
      'Workflow selection requires at least one choice',
    );
  });
});
