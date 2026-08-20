import { describe, expect, test } from 'vitest';

import { runBoundedRipgrep } from '../../../platform/process/ripgrep.js';

describe('bounded ripgrep process adapter', () => {
  test('decodes UTF-8 characters that span stdout chunks', async () => {
    const line = `${JSON.stringify({
      type: 'match',
      data: { path: { text: 'docs/知识.md' }, line_number: 1, lines: { text: '知识\n' } },
    })}\n`;
    const marker = Buffer.from('知');
    const bytes = Buffer.from(line);
    const split = bytes.indexOf(marker) + 1;
    const script = [
      `const bytes = Buffer.from(${JSON.stringify(line)});`,
      `process.stdout.write(bytes.subarray(0, ${split}));`,
      `setTimeout(() => process.stdout.write(bytes.subarray(${split})), 30);`,
    ].join('');

    const result = await runBoundedRipgrep({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', script],
      timeoutMs: 2000,
      maxOutputBytes: 4096,
      maxMatches: 10,
    });

    expect(result.stdout).toBe(line);
  });

  test('keeps only complete stdout lines when the byte limit truncates an event', async () => {
    const complete = `${JSON.stringify({ type: 'match', data: { path: { text: 'docs/a.md' } } })}\n`;
    const partial = JSON.stringify({ type: 'match', data: { path: { text: 'docs/b.md' } } });
    const output = `${complete}${partial}`;
    const result = await runBoundedRipgrep({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', `process.stdout.write(${JSON.stringify(output)})`],
      timeoutMs: 2000,
      maxOutputBytes: Buffer.byteLength(complete) + 8,
      maxMatches: 10,
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe(complete);
  });
});
