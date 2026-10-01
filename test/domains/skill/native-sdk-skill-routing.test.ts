import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const nativeSkill = path.resolve('assets/skills-zh/comet-native/SKILL.md');
const nativeCommands = path.resolve('assets/skills-zh/comet-native/reference/commands.md');
const nativeRecovery = path.resolve('assets/skills-zh/comet-native/reference/recovery.md');
const englishNativeSkill = path.resolve('assets/skills/comet-native/SKILL.md');
const englishNativeCommands = path.resolve('assets/skills/comet-native/reference/commands.md');
const englishNativeRecovery = path.resolve('assets/skills/comet-native/reference/recovery.md');

describe('Chinese Native SDK Skill route', () => {
  it('routes SDK-owned changes by the persisted Run projection and keeps legacy instructions separate', async () => {
    const skill = await fs.readFile(nativeSkill, 'utf8');
    expect(skill).toContain('comet.native.sdk-status.v1');
    expect(skill).toContain('reference/commands.md#sdk-run');
    expect(skill).not.toContain('--runtime sdk');
    expect(skill).toContain('当前 change 的 `comet-state.yaml`');
    expect(skill).toContain('reference/recovery.md#故障恢复');
    expect(await fs.readFile(nativeRecovery, 'utf8')).toContain(
      'comet native doctor <change-name> --repair --confirmed',
    );
    expect(skill).toContain('旧 Runtime');
  });

  it('uses the public SDK dispatch protocol for host work and binds user decisions', async () => {
    const commands = await fs.readFile(nativeCommands, 'utf8');
    expect(commands).toContain('## SDK Run');
    expect(commands).toContain('comet runtime dispatch --application native');
    expect(commands).toContain('claim');
    expect(commands).toContain('record-outcome');
    expect(commands).toContain('--proposal-hash');
    expect(commands).toContain('结果未知');
    expect(commands).toContain('supervisor.parent.deliver');
    expect(commands).toContain('不重新执行快进');
    expect(commands).toContain('pendingBuilderDecisions');
    expect(commands).toContain('--continue-builder');
  });

  it('keeps the English SDK path aligned with public Native commands', async () => {
    const skill = await fs.readFile(englishNativeSkill, 'utf8');
    const commands = await fs.readFile(englishNativeCommands, 'utf8');
    expect(skill).toContain('comet.native.sdk-status.v1');
    expect(skill).not.toContain('--runtime sdk');
    expect(skill).toContain('reference/recovery.md#fault-recovery');
    const recovery = await fs.readFile(englishNativeRecovery, 'utf8');
    expect(recovery).toContain('run_checkpoint');
    expect(recovery).toContain('saved phase');
    expect(recovery).toContain('comet native doctor <change-name> --repair --confirmed');
    expect(commands).toContain('comet runtime dispatch --application native');
    expect(commands).toContain('native next <change> --revise-requirements');
    expect(commands).toContain('native archive <change> --dry-run --json');
    expect(commands).toContain('supervisor.cleanup');
    expect(commands).toContain('supervisor.parent.deliver');
    expect(commands).toContain('does not repeat the fast-forward');
    expect(commands).toContain('native archive <change> --recover --json');
    expect(commands).toContain('pendingBuilderDecisions');
    expect(commands).toContain('--continue-builder');
  });
});
