import { describe, expect, it } from 'vitest';

import { shouldAutoStartCometDaemon } from '../../bin/comet-daemon-router.js';

describe('CLI daemon router', () => {
  it('does not auto-start a Windows daemon unless explicitly enabled', () => {
    expect(shouldAutoStartCometDaemon('win32', {})).toBe(false);
    expect(shouldAutoStartCometDaemon('win32', { COMET_DAEMON: 'on' })).toBe(true);
    expect(shouldAutoStartCometDaemon('linux', {})).toBe(true);
    expect(shouldAutoStartCometDaemon('linux', { COMET_DAEMON: 'off' })).toBe(false);
  });
});
