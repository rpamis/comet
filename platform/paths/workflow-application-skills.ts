import os from 'node:os';
import path from 'node:path';

export function workflowApplicationSkillsRoot(options: {
  projectRoot: string;
  scope: 'project' | 'user';
  userRoot?: string;
  host: 'codex' | 'claude-code';
}): string {
  return path.join(
    options.scope === 'project' ? options.projectRoot : (options.userRoot ?? os.homedir()),
    options.host === 'codex' ? '.agents/skills' : '.claude/skills',
  );
}
