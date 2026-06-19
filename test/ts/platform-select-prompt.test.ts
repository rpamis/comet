import { describe, expect, it } from 'vitest';
import {
  formatSelectedSummary,
  getSelectedChoiceNames,
  invertChoices,
  renderSelectedSummaryLine,
  selectAllChoices,
  toggleChoice,
  type PlatformSelectChoice,
} from '../../src/commands/platform-select-prompt.js';

describe('platform select prompt state helpers', () => {
  const choices: PlatformSelectChoice<string>[] = [
    { name: 'Cursor', value: 'cursor' },
    { name: 'Codex (detected)', value: 'codex', checked: true },
    { name: 'OpenCode', value: 'opencode' },
  ];

  it('prefers summary names over display names for selected choices', () => {
    const selectedChoices: PlatformSelectChoice<string>[] = [
      { name: 'Cursor', value: 'cursor' },
      { name: 'Codex (detected)', summaryName: 'Codex', value: 'codex', checked: true },
      { name: 'OpenCode', value: 'opencode' },
    ];

    expect(getSelectedChoiceNames(selectedChoices)).toEqual(['Codex']);
  });

  it('formats selected summary with selected names', () => {
    expect(formatSelectedSummary('Selected:', ['Codex (detected)'], 'none')).toBe(
      'Selected: Codex (detected)',
    );
  });

  it('formats selected summary with empty label when nothing is selected', () => {
    expect(formatSelectedSummary('Selected:', [], 'none')).toBe('Selected: none');
  });

  it('returns checked choice names in display order', () => {
    expect(getSelectedChoiceNames(choices)).toEqual(['Codex (detected)']);
  });

  it('toggles one choice and updates selected names', () => {
    const next = toggleChoice(choices, 'cursor');
    expect(getSelectedChoiceNames(next)).toEqual(['Cursor', 'Codex (detected)']);
  });

  it('selects all choices', () => {
    const next = selectAllChoices(choices);
    expect(getSelectedChoiceNames(next)).toEqual(['Cursor', 'Codex (detected)', 'OpenCode']);
  });

  it('inverts choices', () => {
    const next = invertChoices(choices);
    expect(getSelectedChoiceNames(next)).toEqual(['Cursor', 'OpenCode']);
  });
});

describe('platform select prompt rendering helpers', () => {
  it('renders a stable selected summary line outside choices', () => {
    expect(renderSelectedSummaryLine('Selected:', ['Codex', 'Windsurf'], 'none')).toBe(
      '  Selected: Codex, Windsurf',
    );
  });

  it('renders the localized empty label when there are no selected choices', () => {
    expect(renderSelectedSummaryLine('已选择：', [], '无')).toBe('  已选择： 无');
  });
});
