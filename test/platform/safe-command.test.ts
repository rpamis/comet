import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  minimalCommandEnvironment,
  redactCommandText,
  runSafeCommand,
} from '../../platform/process/safe-command.js';

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKillProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The expected path for descendants already removed by runSafeCommand.
  }
}

describe('runSafeCommand', () => {
  it('executes structured argv without shell interpretation', async () => {
    const marker = 'hello; echo should-not-run';
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', marker],
    });

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.excerpt).toBe(marker);
    expect(result.stderr.excerpt).toBe('');
  });

  it('uses the requested cwd and an allowlisted environment', async () => {
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: process.execPath,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify({cwd: process.cwd(), secret: process.env.COMET_TEST_SECRET ?? null, ci: process.env.CI}))',
      ],
    });
    const output = JSON.parse(result.stdout.excerpt) as Record<string, unknown>;

    expect(path.normalize(output.cwd as string)).toBe(path.normalize(os.tmpdir()));
    expect(output.secret).toBeNull();
    expect(output.ci).toBe('1');
  });

  it('bounds and hashes retained output', async () => {
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(4096))"],
      maxOutputBytes: 128,
    });

    expect(result.status).toBe('passed');
    expect(result.stdout.bytes).toBe(4096);
    expect(result.stdout.capturedBytes).toBe(128);
    expect(Buffer.byteLength(result.stdout.excerpt)).toBe(128);
    expect(result.stdout.truncated).toBe(true);
    expect(result.stdout.excerptHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('redacts common credentials from retained output', async () => {
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: process.execPath,
      args: [
        '-e',
        "process.stdout.write('API_KEY=top-secret Bearer abc.def.ghi password:guess-me')",
      ],
    });

    expect(result.stdout.excerpt).toBe('API_KEY=[REDACTED] Bearer [REDACTED] password:[REDACTED]');
    expect(result.stdout.excerpt).not.toContain('top-secret');
    expect(result.stdout.excerpt).not.toContain('abc.def.ghi');
    expect(result.stdout.excerpt).not.toContain('guess-me');
  });

  it('redacts JSON credentials and Basic authorization', async () => {
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: process.execPath,
      args: [
        '-e',
        `process.stdout.write(JSON.stringify({apiKey: 'json-secret', authorization: 'Basic dXNlcjpwYXNz'}))`,
      ],
    });

    expect(result.stdout.excerpt).toBe('{"apiKey":"[REDACTED]","authorization":"[REDACTED]"}');
    expect(result.stdout.excerpt).not.toContain('json-secret');
    expect(result.stdout.excerpt).not.toContain('dXNlcjpwYXNz');
  });

  it('redacts complete JSON secrets containing escaped quotes', () => {
    const secret = String.raw`prefix\"escaped-secret-suffix`;
    const redacted = redactCommandText(JSON.stringify({ clientSecret: secret }));

    expect(redacted).toBe('{"clientSecret":"[REDACTED]"}');
    expect(redacted).not.toContain('escaped-secret-suffix');
  });

  it('redacts prefixed environment keys, known tokens, URLs, and private keys', () => {
    const synthetic = [
      'OPENAI_API_KEY="synthetic-secret"',
      `github_pat_${'a'.repeat(24)}`,
      'https://user:password@example.test/path',
      '-----BEGIN PRIVATE KEY-----\nsynthetic-key\n-----END PRIVATE KEY-----',
    ].join('\n');
    const redacted = redactCommandText(synthetic);

    expect(redacted).not.toContain('synthetic-secret');
    expect(redacted).not.toContain('github_pat_');
    expect(redacted).not.toContain('user:password');
    expect(redacted).not.toContain('synthetic-key');
    expect(redacted).toContain('[REDACTED PRIVATE KEY]');
  });

  it('terminates on timeout', async () => {
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 25,
    });

    expect(result.status).toBe('timeout');
    expect(result.exitCode).toBeNull();
  });

  it('terminates descendants on timeout', async () => {
    const descendant = 'setInterval(() => {}, 1000)';
    const parent = [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });`,
      'process.stdout.write(String(child.pid));',
      'setInterval(() => {}, 1000);',
    ].join('');
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: process.execPath,
      args: ['-e', parent],
      timeoutMs: 100,
    });
    const descendantPid = Number(result.stdout.excerpt);

    try {
      expect(result.status).toBe('timeout');
      expect(descendantPid).toBeGreaterThan(0);
      expect(processExists(descendantPid)).toBe(false);
    } finally {
      forceKillProcess(descendantPid);
    }
  });

  it.runIf(process.platform === 'win32')(
    'terminates a detached Windows descendant on timeout',
    async () => {
      const descendant = 'setInterval(() => {}, 1000)';
      const parent = [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: true, stdio: 'ignore' });`,
        'process.stdout.write(String(child.pid));',
        'child.unref();',
        'setInterval(() => {}, 1000);',
      ].join('');
      const result = await runSafeCommand({
        cwd: os.tmpdir(),
        executable: 'node',
        args: ['-e', parent],
        timeoutMs: 50,
      });
      const descendantPid = Number(result.stdout.excerpt);

      try {
        expect(result.status).toBe('timeout');
        expect(descendantPid).toBeGreaterThan(0);
        expect(processExists(descendantPid)).toBe(false);
      } finally {
        forceKillProcess(descendantPid);
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'does not terminate an unrelated Windows sibling',
    async () => {
      const sibling = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      const siblingPid = sibling.pid;
      expect(siblingPid).toBeDefined();

      try {
        const result = await runSafeCommand({
          cwd: os.tmpdir(),
          executable: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          timeoutMs: 50,
        });

        expect(result.status).toBe('timeout');
        expect(processExists(siblingPid!)).toBe(true);
      } finally {
        forceKillProcess(siblingPid!);
      }
    },
  );

  it('reports spawn failures without throwing', async () => {
    const result = await runSafeCommand({
      cwd: os.tmpdir(),
      executable: `comet-command-that-does-not-exist-${process.pid}`,
    });

    expect(result.status).toBe('spawn-error');
    expect(result.exitCode).toBeNull();
    expect(result.errorCode).toBeTruthy();
  });
});

describe('safe command helpers', () => {
  it('rejects arbitrary environment variables', () => {
    expect(() => minimalCommandEnvironment({ COMET_TEST_SECRET: 'nope' })).toThrow(
      'Safe command environment variable is not allowed',
    );
  });

  it('does not redact ordinary hashes', () => {
    const hash = 'a'.repeat(64);
    expect(redactCommandText(`hash=${hash}`)).toBe(`hash=${hash}`);
  });
});
