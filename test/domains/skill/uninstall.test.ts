import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { PLATFORMS } from '../../../platform/install/platforms.js';
import { installCometHooksForPlatform } from '../../../domains/skill/platform-install.js';
import { removeCometHooksForPlatform } from '../../../domains/skill/uninstall.js';

describe('removeCometHooksForPlatform', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-uninstall-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ignores malformed historical Codex hooks after canonical cleanup succeeds', async () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
    const malformedLegacy = '{\n  "hooks": {\n';

    await installCometHooksForPlatform(tmpDir, codex, 'project');
    await fs.writeFile(legacyPath, malformedLegacy, 'utf8');

    await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });

    const cleanedCanonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
    expect(cleanedCanonical.hooks.PreToolUse[0].hooks).toEqual([]);
    await expect(fs.readFile(legacyPath, 'utf8')).resolves.toBe(malformedLegacy);
  });

  it('ignores unreadable historical Codex hook paths after canonical cleanup succeeds', async () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');

    await installCometHooksForPlatform(tmpDir, codex, 'project');
    await fs.mkdir(legacyPath, { recursive: true });

    await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
      removed: 1,
      failed: 0,
    });
  });
});
