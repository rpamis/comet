import { describe, expect, it, vi } from 'vitest';

type TestKey = { name?: string; ctrl?: boolean };
type TestGlobal = typeof globalThis & { __cometPromptKeys?: TestKey[] };

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
  isSpaceKey: (key: TestKey) => key.name === 'space',
  isUpKey: (key: TestKey) => key.name === 'up',
  makeTheme: (theme: unknown) => theme,
  useKeypress: (handler: (key: TestKey) => void) => {
    const testGlobal = globalThis as TestGlobal;
    for (const key of testGlobal.__cometPromptKeys ?? []) handler(key);
    testGlobal.__cometPromptKeys = [];
  },
  usePagination: () => 'page',
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

describe('platform select prompt interaction branches', () => {
  it('handles navigation, selection, select-all, invert, and required submission', async () => {
    const testGlobal = globalThis as TestGlobal;
    testGlobal.__cometPromptKeys = [
      { name: 'down' },
      { name: 'up' },
      { name: 'space' },
      { name: 'a' },
      { name: 'a' },
      { name: 'i' },
      { name: 'enter' },
    ];
    const { platformSelectPrompt } = await import('../../app/commands/platform-select-prompt.js');

    await expect(
      platformSelectPrompt({
        message: 'Platforms',
        choices: [
          { name: 'Codex', value: 'codex', checked: true },
          { name: 'Claude', value: 'claude' },
        ],
        selectedLabel: 'Selected:',
        emptyLabel: 'none',
        required: true,
      }),
    ).resolves.toEqual(['codex']);
  });

  it('handles an empty required prompt and ignores navigation without choices', async () => {
    const testGlobal = globalThis as TestGlobal;
    testGlobal.__cometPromptKeys = [
      { name: 'down' },
      { name: 'space' },
      { name: 'a' },
      { name: 'i' },
      { name: 'enter' },
    ];
    const { platformSelectPrompt } = await import('../../app/commands/platform-select-prompt.js');

    await expect(
      platformSelectPrompt({
        message: 'Platforms',
        choices: [],
        selectedLabel: 'Selected:',
        emptyLabel: 'none',
        required: true,
        requiredErrorLabel: 'choose one',
      }),
    ).resolves.toContain('prefix');
  });
});
