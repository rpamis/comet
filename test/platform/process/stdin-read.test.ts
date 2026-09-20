import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readStdinTextWithTimeout,
  readStdinTextWithTimeoutAsync,
} from '../../../platform/process/stdin-read.js';

class FakeStdin extends EventEmitter {
  isTTY = false;
  readableEnded = false;
  nextRead: Buffer | string | null = null;

  read(): Buffer | string | null {
    return this.nextRead;
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }
}

describe('stdin read helpers', () => {
  const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');

  afterEach(() => {
    if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin);
  });

  function stdin(): FakeStdin {
    const input = new FakeStdin();
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      enumerable: true,
      value: input,
      writable: true,
    });
    return input;
  }

  it('handles synchronous TTY, invalid, ended, and bounded reads', () => {
    const input = stdin();
    input.isTTY = true;
    expect(readStdinTextWithTimeout()).toEqual({ text: '' });

    input.isTTY = false;
    expect(readStdinTextWithTimeout(0)).toEqual({ text: null });
    input.readableEnded = true;
    expect(readStdinTextWithTimeout()).toEqual({ text: '' });

    input.readableEnded = false;
    input.nextRead = Buffer.from('buffer input');
    expect(readStdinTextWithTimeout()).toEqual({ text: 'buffer input' });
    input.nextRead = 'string input';
    expect(readStdinTextWithTimeout()).toEqual({ text: 'string input' });
    input.nextRead = Buffer.alloc(1024 * 1024 + 1, 'x');
    expect(readStdinTextWithTimeout()).toEqual({ text: 'x'.repeat(1024 * 1024) });
    input.nextRead = null;
    expect(readStdinTextWithTimeout()).toEqual({ text: null });
  });

  it('returns early for asynchronous TTY, invalid, and ended input', async () => {
    const input = stdin();
    input.isTTY = true;
    await expect(readStdinTextWithTimeoutAsync()).resolves.toEqual({ text: '' });
    input.isTTY = false;
    await expect(readStdinTextWithTimeoutAsync(0)).resolves.toEqual({ text: null });
    input.readableEnded = true;
    await expect(readStdinTextWithTimeoutAsync()).resolves.toEqual({ text: '' });
  });

  it('resolves asynchronous data on end and bounds oversized chunks', async () => {
    const input = stdin();
    const received = readStdinTextWithTimeoutAsync(100);
    input.emit('data', Buffer.from('async input'));
    input.emit('end');
    await expect(received).resolves.toEqual({ text: 'async input' });

    const oversized = readStdinTextWithTimeoutAsync(100);
    input.emit('data', Buffer.alloc(1024 * 1024 + 1, 'x'));
    await expect(oversized).resolves.toEqual({ text: null });
  });

  it('returns null when asynchronous input closes, errors, or times out', async () => {
    const input = stdin();
    const closed = readStdinTextWithTimeoutAsync(100);
    input.emit('close');
    await expect(closed).resolves.toEqual({ text: null });

    const errored = readStdinTextWithTimeoutAsync(100);
    input.emit('error', new Error('stdin failed'));
    await expect(errored).resolves.toEqual({ text: null });

    await expect(readStdinTextWithTimeoutAsync(1)).resolves.toEqual({ text: null });
  });
});
