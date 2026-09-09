import { describe, expect, it } from 'vitest';
import { handoffSourceHash } from '../../../domains/comet-classic/classic-handoff-source.js';

describe('Classic handoff task content identity', () => {
  const hash = (text: string) => handoffSourceHash('/change/tasks.md', text);
  it('ignores only completed task markers', () => {
    expect(hash('- [ ] 1.1 implement\r\n')).toBe(hash('- [x] 1.1 implement\r\n'));
    expect(hash('- [X] 1.1 implement\n')).toBe(hash('- [ ] 1.1 implement\n'));
  });
  it('keeps task requirements, order and deleted tasks significant', () => {
    const original = hash('- [ ] first\n- [ ] second\n');
    for (const text of [
      '- [ ] changed\n- [ ] second\n',
      '- [ ] second\n- [ ] first\n',
      '- [ ] first\n',
    ]) {
      expect(hash(text)).not.toBe(original);
    }
  });
  it('does not normalize code examples or non-task source files', () => {
    expect(hash('```md\n- [x] example\n```\n')).not.toBe(hash('```md\n- [ ] example\n```\n'));
    expect(handoffSourceHash('/change/design.md', '- [x] choice')).not.toBe(
      handoffSourceHash('/change/design.md', '- [ ] choice'),
    );
  });
});
