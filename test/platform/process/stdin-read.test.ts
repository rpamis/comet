import { describe, expect, it } from 'vitest';

import { readStdinTextWithTimeout } from '../../../platform/process/stdin-read.js';

describe('readStdinTextWithTimeout', () => {
  it('always returns within the timeout instead of blocking on a silent host', async () => {
    const started = Date.now();
    const result = readStdinTextWithTimeout(300);
    const elapsed = Date.now() - started;
    // Under a TTY the function answers immediately; under a piped, silent stdin
    // it must give up at the 300 ms deadline. Either way it never hangs.
    expect(elapsed).toBeLessThan(2_000);
    if (process.stdin.isTTY) {
      expect(result.text).toBe('');
    } else {
      expect(['', null]).toContain(result.text);
    }
  });

  it('answers empty for a TTY stdin without reading the descriptor', async () => {
    if (!process.stdin.isTTY) return;
    expect(readStdinTextWithTimeout(300).text).toBe('');
  });
});
