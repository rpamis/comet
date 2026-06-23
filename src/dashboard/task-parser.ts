import type { TaskSectionSummary, TasksSummary } from './types.js';

/**
 * Parse a `tasks.md` file into structured progress data.
 *
 * Rules:
 *  - Markdown headings (`#` ~ `######`) become section titles. Tasks without
 *    a preceding heading land in a default section called `Tasks`.
 *  - Checkboxes (`- [x]`, `- [X]`, `- [ ]`) at any indentation count.
 *  - Section status: `done` when completed === total > 0, `active` when
 *    completed > 0 and < total, otherwise `pending` (including total === 0).
 */
export function parseTasksMarkdown(content: string): TasksSummary {
  if (!content || !content.trim()) {
    return { completed: 0, total: 0, incomplete: [], sections: [] };
  }

  const lines = content.split(/\r?\n/u);
  const sections: TaskSectionSummary[] = [];
  const incomplete: string[] = [];
  let completed = 0;
  let total = 0;

  let currentTitle: string | null = null;
  let currentSection: TaskSectionSummary | null = null;

  const ensureCurrentSection = (): TaskSectionSummary => {
    if (currentSection) return currentSection;
    const title = currentTitle ?? 'Tasks';
    currentSection = { title, completed: 0, total: 0, status: 'pending' };
    sections.push(currentSection);
    return currentSection;
  };

  for (const rawLine of lines) {
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (headingMatch) {
      currentTitle = headingMatch[2].trim();
      currentSection = null;
      // Reserve the heading as an empty section; if checkboxes follow it will
      // be reused (see ensureCurrentSection), otherwise it stays as a pending
      // placeholder so the UI can list every section the spec mentioned.
      const placeholder: TaskSectionSummary = {
        title: currentTitle,
        completed: 0,
        total: 0,
        status: 'pending',
      };
      sections.push(placeholder);
      currentSection = placeholder;
      continue;
    }

    const checkboxMatch = rawLine.match(/^\s*[-*+]\s+\[( |x|X)\]\s*(.*)$/u);
    if (!checkboxMatch) continue;

    const section = ensureCurrentSection();
    const isDone = checkboxMatch[1] === 'x' || checkboxMatch[1] === 'X';
    const text = checkboxMatch[2].trim();

    section.total += 1;
    total += 1;
    if (isDone) {
      section.completed += 1;
      completed += 1;
    } else if (text) {
      incomplete.push(text);
    }
  }

  // Sections introduced by headings but never followed by checkboxes are kept
  // as pending placeholders so the UI reflects the spec's section list verbatim.

  for (const section of sections) {
    if (section.total === 0) {
      section.status = 'pending';
    } else if (section.completed === section.total) {
      section.status = 'done';
    } else if (section.completed === 0) {
      section.status = 'pending';
    } else {
      section.status = 'active';
    }
  }

  return { completed, total, incomplete, sections };
}
