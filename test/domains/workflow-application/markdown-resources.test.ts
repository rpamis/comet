import { expect, it } from 'vitest';
import { rewriteMarkdownResourceLinks } from '../../../domains/workflow-application/index.js';

it('keeps the full original Markdown unchanged when the callback only validates targets', () => {
  const source =
    '\uFEFF---\r\nname: sample\r\ndescription: 原始正文。\r\n---\r\n\r\n# 业务 😀\r\n[inline](references/a.md#part "title")\r\n[angle](<references/a b.md> \'说明\')\r\n[ref][guide]\r\n\r\n[guide]: references/a.md#part "原标题"\r\n';
  const seen: string[] = [];
  expect(
    rewriteMarkdownResourceLinks(source, (target) => {
      seen.push(target);
      return target;
    }),
  ).toBe(source);
  expect(seen).toContain('references/a.md#part');
  expect(seen).toContain('references/a b.md');
});

it('rewrites inline and reference definition targets while preserving labels, angles, titles, anchors and CRLF', () => {
  const source =
    '[inline](references/a.md#part "title")\r\n[angle](<references/a b.md> \'note\')\r\n[ref][guide]\r\n\r\n[guide]: references/a.md#part "title"\r\n';
  expect(rewriteMarkdownResourceLinks(source, (target) => '/fixed/' + target)).toBe(
    '[inline](/fixed/references/a.md#part "title")\r\n[angle](</fixed/references/a b.md> \'note\')\r\n[ref][guide]\r\n\r\n[guide]: /fixed/references/a.md#part "title"\r\n',
  );
});

it('preserves fenced and inline code examples even when their links also occur as real links', () => {
  const literal = '[same](references/a.md)';
  const source =
    '````markdown\n' +
    literal +
    '\n```\n````\n\n`' +
    literal +
    '`\n\n    ' +
    literal +
    '\n\n' +
    literal +
    '\n';
  expect(rewriteMarkdownResourceLinks(source, (target) => '/fixed/' + target)).toBe(
    source.slice(0, source.lastIndexOf(literal)) + '[same](/fixed/references/a.md)\n',
  );
});

it('handles balanced parentheses, escaped URL characters and nested image links without changing their labels', () => {
  expect(
    rewriteMarkdownResourceLinks(
      '[version](references/v(1).md) [escaped](references/v\\(1\\).md) [![image](references/picture.png)](references/a.md)',
      (target) => '/fixed/' + target,
    ),
  ).toBe(
    '[version](/fixed/references/v(1).md) [escaped](/fixed/references/v(1).md) [![image](/fixed/references/picture.png)](/fixed/references/a.md)',
  );
});

it('adds angle delimiters only when a rewritten unwrapped target requires them', () => {
  expect(
    rewriteMarkdownResourceLinks(
      '[guide](references/a.md "title")\n\n[ref]: references/a.md\n',
      (target) => '/fixed project/' + target,
    ),
  ).toBe(
    '[guide](</fixed project/references/a.md> "title")\n\n[ref]: </fixed project/references/a.md>\n',
  );
});

it('does not treat an explicit missing reference definition as a valid resource link', () => {
  expect(() => rewriteMarkdownResourceLinks('[guide][missing]', (target) => target)).toThrow(
    /引用|定义/,
  );
});

it('keeps reference-definition titles when a filename has an unmatched closing parenthesis', () => {
  expect(
    rewriteMarkdownResourceLinks(
      '[guide][ref]\n\n[ref]: references/edge).md "标题"\n',
      (target) => '/fixed/' + target,
    ),
  ).toBe('[guide][ref]\n\n[ref]: /fixed/references/edge).md "标题"\n');
});

it('preserves escaped literals and quoted fenced examples while rewriting the same real link', () => {
  const source =
    '\\[guide](references/a.md)\n\n> ```md\n> [guide](references/a.md)\n> ```\n\n[guide](references/a.md)\n';
  expect(rewriteMarkdownResourceLinks(source, (target) => '/fixed/' + target)).toBe(
    '\\[guide](references/a.md)\n\n> ```md\n> [guide](references/a.md)\n> ```\n\n[guide](/fixed/references/a.md)\n',
  );
});
