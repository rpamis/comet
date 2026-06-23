import { spawn } from 'child_process';

/**
 * Best-effort: open `url` in the user's default browser.
 *
 * Cross-platform without dependencies. Failures are swallowed (CI / headless
 * containers / SSH sessions are expected to fail) — callers should still log
 * the URL so the user can open it manually.
 */
export function openInBrowser(url: string): void {
  let command: string;
  let args: string[];

  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    // `start` is a cmd builtin; route through cmd /c to invoke it.
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.on('error', () => {
      // Silent — the surface command logged the URL already.
    });
    child.unref();
  } catch {
    // Same as above: failure is informational, not fatal.
  }
}
