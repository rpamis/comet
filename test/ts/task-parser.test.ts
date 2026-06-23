import { describe, expect, it } from 'vitest';
import { parseTasksMarkdown } from '../../src/dashboard/task-parser.js';

describe('parseTasksMarkdown', () => {
  it('returns empty summary for missing or blank content', () => {
    expect(parseTasksMarkdown('')).toEqual({
      completed: 0,
      total: 0,
      incomplete: [],
      sections: [],
    });
  });

  it('parses checkboxes under the default section when no headings exist', () => {
    const md = ['- [x] First done', '- [ ] Second todo', '- [X] Third done'].join('\n');

    const result = parseTasksMarkdown(md);

    expect(result.completed).toBe(2);
    expect(result.total).toBe(3);
    expect(result.incomplete).toEqual(['Second todo']);
    expect(result.sections).toEqual([
      { title: 'Tasks', completed: 2, total: 3, status: 'active' },
    ]);
  });

  it('groups tasks under preceding markdown headings', () => {
    const md = [
      '## Command Entry',
      '- [x] Wire CLI',
      '- [x] Register option',
      '',
      '## Dashboard API',
      '- [x] Implement endpoint',
      '- [ ] Document payload',
      '- [ ] Add error path',
      '',
      '## Refresh Flow',
      '- [ ] Manual refresh button',
    ].join('\n');

    const result = parseTasksMarkdown(md);

    expect(result.completed).toBe(3);
    expect(result.total).toBe(6);
    expect(result.incomplete).toEqual([
      'Document payload',
      'Add error path',
      'Manual refresh button',
    ]);
    expect(result.sections).toEqual([
      { title: 'Command Entry', completed: 2, total: 2, status: 'done' },
      { title: 'Dashboard API', completed: 1, total: 3, status: 'active' },
      { title: 'Refresh Flow', completed: 0, total: 1, status: 'pending' },
    ]);
  });

  it('marks sections with no checkboxes as pending', () => {
    const md = ['## Scope Review', 'Some narrative.', '', '## Inventory', '- [ ] Listing'].join(
      '\n',
    );

    const result = parseTasksMarkdown(md);

    expect(result.sections).toEqual([
      { title: 'Scope Review', completed: 0, total: 0, status: 'pending' },
      { title: 'Inventory', completed: 0, total: 1, status: 'pending' },
    ]);
  });

  it('handles nested checkboxes with arbitrary indentation', () => {
    const md = [
      '## Plan',
      '- [x] Top-level done',
      '    - [ ] Nested undone',
      '  - [x] Nested done',
    ].join('\n');

    const result = parseTasksMarkdown(md);

    expect(result.completed).toBe(2);
    expect(result.total).toBe(3);
    expect(result.incomplete).toEqual(['Nested undone']);
    expect(result.sections[0]).toEqual({
      title: 'Plan',
      completed: 2,
      total: 3,
      status: 'active',
    });
  });

  it('keeps every heading as a section, including empty parents', () => {
    const md = ['# Top', '## Sub A', '- [ ] task one', '## Sub B', '- [x] task two'].join('\n');

    const result = parseTasksMarkdown(md);

    expect(result.sections).toEqual([
      { title: 'Top', completed: 0, total: 0, status: 'pending' },
      { title: 'Sub A', completed: 0, total: 1, status: 'pending' },
      { title: 'Sub B', completed: 1, total: 1, status: 'done' },
    ]);
  });

  it('strips trailing checkbox text but preserves inline punctuation', () => {
    const md = ['- [ ] Implement `/api/dashboard` endpoint (P0)'].join('\n');

    const result = parseTasksMarkdown(md);

    expect(result.incomplete).toEqual(['Implement `/api/dashboard` endpoint (P0)']);
  });
});
