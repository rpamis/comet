import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  processInstanceMayBeAlive,
  readProcessIdentity,
} from '../../../platform/process/process-identity.js';

describe('process creation identity', () => {
  it('distinguishes a live instance from an exited owner with the same PID', async () => {
    const identity = await readProcessIdentity(process.pid);
    expect(identity).toBeTruthy();
    expect(await readProcessIdentity(process.pid)).toBe(identity);
    expect(await processInstanceMayBeAlive(process.pid, identity!)).toBe(true);
    expect(await processInstanceMayBeAlive(process.pid, 'previous-instance')).toBe(false);
    expect(await processInstanceMayBeAlive(process.pid)).toBe(true);
  });

  it('recognizes a reaped process and conservatively handles invalid legacy owners', async () => {
    const pid = Number(
      execFileSync(process.execPath, ['-p', 'process.pid'], { encoding: 'utf8' }).trim(),
    );
    expect(await processInstanceMayBeAlive(pid, 'previous-instance')).toBe(false);
    expect(await readProcessIdentity(-1)).toBeNull();
    expect(await processInstanceMayBeAlive(-1, 'invalid')).toBe(true);
  });
});
