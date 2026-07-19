import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mergeManagedMarkdownBlock,
  removeManagedMarkdownBlock,
} from '../../../domains/skill/managed-markdown.js';

const CRLF = '\r\n';
let tmpDir: string;
let filePath: string;

describe('managed markdown blocks', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-managed-md-'));
    filePath = path.join(tmpDir, 'AGENTS.md');
  });

  it('creates a missing file with one managed block', async () => {
    const result = await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'body\n',
    });

    expect(result.action).toBe('created');
    expect(await fs.readFile(filePath, 'utf8')).toBe(
      '<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n',
    );
  });

  it('returns unchanged when managed block content is already up to date', async () => {
    await fs.writeFile(
      filePath,
      'before\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n\nafter\n',
      'utf8',
    );

    const result = await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'body\n',
    });

    expect(result.action).toBe('unchanged');
    expect(result.changed).toBe(false);
    expect(await fs.readFile(filePath, 'utf8')).toBe(
      'before\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n\nafter\n',
    );
  });

  it('appends a managed block without changing user content', async () => {
    await fs.writeFile(filePath, '# User Rules\n\nKeep this.\n', 'utf8');

    await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'body\n',
    });

    expect(await fs.readFile(filePath, 'utf8')).toBe(
      '# User Rules\n\nKeep this.\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n',
    );
  });

  it('updates managed block content while preserving CRLF', async () => {
    await fs.writeFile(
      filePath,
      [
        'before',
        '',
        '<comet-ambient-resume>',
        'old',
        '</comet-ambient-resume>',
        '',
        'after',
        '',
      ].join(CRLF),
      'utf8',
    );

    await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'new\r\n',
    });

    expect(await fs.readFile(filePath, 'utf8')).toBe(
      [
        'before',
        '',
        '<comet-ambient-resume>',
        'new',
        '</comet-ambient-resume>',
        '',
        'after',
        '',
      ].join(CRLF),
    );
  });

  it('normalizes CRLF content when merging into an existing CRLF file', async () => {
    await fs.writeFile(filePath, `before${CRLF}`, 'utf8');

    await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'line1\r\nline2\r\n',
    });

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toBe(
      [
        'before',
        '',
        '<comet-ambient-resume>',
        'line1',
        'line2',
        '</comet-ambient-resume>',
        '',
      ].join(CRLF),
    );
    expect(updated).not.toMatch(/\r\r\n/);
  });

  it('keeps trailing spaces while trimming trailing line endings from content', async () => {
    const result = await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'body  \r\n',
    });

    expect(result.action).toBe('created');
    expect(await fs.readFile(filePath, 'utf8')).toBe(
      '<comet-ambient-resume>\nbody  \n</comet-ambient-resume>\n',
    );
  });

  it('replaces only the managed block', async () => {
    await fs.writeFile(
      filePath,
      'before\n\n<comet-ambient-resume>\nold\n</comet-ambient-resume>\n\nafter\n',
      'utf8',
    );

    await mergeManagedMarkdownBlock(filePath, {
      tagName: 'comet-ambient-resume',
      content: 'new\n',
    });

    expect(await fs.readFile(filePath, 'utf8')).toBe(
      'before\n\n<comet-ambient-resume>\nnew\n</comet-ambient-resume>\n\nafter\n',
    );
  });

  it('rejects incomplete blocks', async () => {
    await fs.writeFile(filePath, '<comet-ambient-resume>\nbody\n', 'utf8');

    await expect(
      mergeManagedMarkdownBlock(filePath, {
        tagName: 'comet-ambient-resume',
        content: 'new\n',
      }),
    ).rejects.toThrow(/incomplete managed block/);
  });

  it('removes only the managed block', async () => {
    await fs.writeFile(
      filePath,
      'before\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n\nafter\n',
      'utf8',
    );

    const result = await removeManagedMarkdownBlock(filePath, 'comet-ambient-resume');

    expect(result.action).toBe('removed');
    expect(await fs.readFile(filePath, 'utf8')).toBe('before\n\nafter\n');
  });

  it('removes managed block while preserving surrounding content spacing', async () => {
    await fs.writeFile(
      filePath,
      [
        'before',
        '',
        '<comet-ambient-resume>',
        'body',
        '</comet-ambient-resume>',
        '',
        'after',
        '',
      ].join(CRLF),
      'utf8',
    );

    const result = await removeManagedMarkdownBlock(filePath, 'comet-ambient-resume');

    expect(result.action).toBe('removed');
    expect(await fs.readFile(filePath, 'utf8')).toBe(['before', '', 'after', ''].join(CRLF));
  });

  it('rejects duplicate blocks', async () => {
    await fs.writeFile(
      filePath,
      'before\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\nafter\n',
      'utf8',
    );

    await expect(
      mergeManagedMarkdownBlock(filePath, {
        tagName: 'comet-ambient-resume',
        content: 'new\n',
      }),
    ).rejects.toThrow(/duplicate managed block/);
  });

  it('rejects malformed blocks', async () => {
    await fs.writeFile(
      filePath,
      '<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n</comet-ambient-resume>\n',
      'utf8',
    );

    await expect(removeManagedMarkdownBlock(filePath, 'comet-ambient-resume')).rejects.toThrow(
      /malformed managed block/,
    );
  });

  it('rejects invalid tag names in merge and remove', async () => {
    await expect(
      mergeManagedMarkdownBlock(filePath, {
        tagName: 'Comet-ambient-resume',
        content: 'body\n',
      }),
    ).rejects.toThrow(/Invalid managed block tag name/);

    await expect(removeManagedMarkdownBlock(filePath, 'Comet_ambient')).rejects.toThrow(
      /Invalid managed block tag name/,
    );
  });

  it('returns missing when removing from a missing file', async () => {
    const result = await removeManagedMarkdownBlock(filePath, 'comet-ambient-resume');
    expect(result.action).toBe('missing');
    expect(result.changed).toBe(false);
  });

  it('returns missing when removing an existing file with no managed block', async () => {
    const original = ['before', 'body text', 'after'].join(CRLF);
    await fs.writeFile(filePath, original, 'utf8');

    const result = await removeManagedMarkdownBlock(filePath, 'comet-ambient-resume');

    expect(result.action).toBe('missing');
    expect(result.changed).toBe(false);
    expect(await fs.readFile(filePath, 'utf8')).toBe(original);
  });
});
