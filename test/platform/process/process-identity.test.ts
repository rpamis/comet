import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  inspectProcessLiveness,
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

  it('resolves three-state liveness with dead, alive, and unknown outcomes', async () => {
    await expect(inspectProcessLiveness(2_147_483_647)).resolves.toBe('dead');
    await expect(inspectProcessLiveness(2_147_483_647, 'linux:boot:1')).resolves.toBe('dead');
    await expect(inspectProcessLiveness(process.pid)).resolves.toBe('unknown');
    const identity = await readProcessIdentity(process.pid);
    await expect(inspectProcessLiveness(process.pid, identity!)).resolves.toBe('alive');
    // A mismatching identity on a live pid is a reuse verdict: the original owner exited.
    await expect(inspectProcessLiveness(process.pid, 'previous-instance')).resolves.toBe('dead');
  });

  it('treats the two Windows probe sources as interchangeable rather than as reuse', async () => {
    const identity = await readProcessIdentity(process.pid);
    if (!identity || !identity.startsWith('win32-')) return; // Windows-only probe pairing.
    const other = identity.startsWith('win32-wmic:') ? 'win32-ps:1' : 'win32-wmic:1';
    await expect(inspectProcessLiveness(process.pid, other)).resolves.toBe('unknown');
    // Unknown keeps the legacy boolean semantics of "may be alive".
    await expect(processInstanceMayBeAlive(process.pid, other)).resolves.toBe(true);
  });

  it('treats a changed identity from the same probe source as pid reuse', async () => {
    const identity = await readProcessIdentity(process.pid);
    expect(identity).toBeTruthy();
    await expect(inspectProcessLiveness(process.pid, `${identity}-previous`)).resolves.toBe('dead');
  });
});
