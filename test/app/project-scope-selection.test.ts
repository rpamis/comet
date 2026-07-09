import { beforeEach, describe, expect, it, vi } from 'vitest';
import { select } from '@inquirer/prompts';

import {
  assertProjectScopeOptions,
  resolveProjectScopeMode,
} from '../../app/commands/project-scope-selection.js';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue('all-projects'),
}));

const mockedSelect = vi.mocked(select);

describe('project scope selection', () => {
  beforeEach(() => {
    mockedSelect.mockReset();
    mockedSelect.mockResolvedValue('all-projects' as never);
  });

  it('rejects conflicting all/current project flags', () => {
    expect(() => assertProjectScopeOptions({ allProjects: true, currentProject: true })).toThrow(
      '--all-projects cannot be combined with --current-project',
    );
  });

  it('rejects all projects with global scope', () => {
    expect(() => assertProjectScopeOptions({ allProjects: true, scope: 'global' })).toThrow(
      '--all-projects cannot be combined with --scope global',
    );
  });

  it('returns all-projects when the explicit flag is passed', async () => {
    await expect(resolveProjectScopeMode('update', { allProjects: true }, 0)).resolves.toBe(
      'all-projects',
    );
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it('returns current-project for JSON mode unless all-projects is explicit', async () => {
    await expect(resolveProjectScopeMode('update', { json: true }, 3)).resolves.toBe(
      'current-project',
    );
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it('returns current-project for force mode unless all-projects is explicit', async () => {
    await expect(resolveProjectScopeMode('uninstall', { force: true }, 3)).resolves.toBe(
      'current-project',
    );
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it('prompts interactively with all indexed projects first', async () => {
    await expect(resolveProjectScopeMode('uninstall', {}, 2)).resolves.toBe('all-projects');

    expect(mockedSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Uninstall scope:',
        choices: [
          { name: 'All indexed projects', value: 'all-projects' },
          { name: 'Current project only', value: 'current-project' },
        ],
      }),
    );
  });

  it('does not prompt when there are no indexed projects', async () => {
    await expect(resolveProjectScopeMode('update', {}, 0)).resolves.toBe('current-project');
    expect(mockedSelect).not.toHaveBeenCalled();
  });
});
