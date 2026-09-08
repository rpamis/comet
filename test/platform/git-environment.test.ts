import { expect, it } from 'vitest';
import { independentGitEnvironment } from '../../platform/process/git-environment.js';

it('isolates repository state while preserving global configuration and authentication', () => {
  const input = {
    HOME: '/home/user',
    GIT_CONFIG_GLOBAL: '/home/user/.gitconfig',
    GIT_ASKPASS: 'askpass-helper',
    SSH_AUTH_SOCK: '/agent/socket',
    GIT_DIR: '/other/.git',
    git_index_file: '/other/index',
    GIT_WORK_TREE: '/other',
    GIT_OBJECT_DIRECTORY: '/other/objects',
    GIT_CONFIG_PARAMETERS: "'core.worktree'='/other'",
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: '/other',
  };
  expect(independentGitEnvironment(input)).toEqual({
    HOME: '/home/user',
    GIT_CONFIG_GLOBAL: '/home/user/.gitconfig',
    GIT_ASKPASS: 'askpass-helper',
    SSH_AUTH_SOCK: '/agent/socket',
  });
  expect(input.GIT_DIR).toBe('/other/.git');
});
