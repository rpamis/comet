import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve('.');

describe('removed project rules plugin', () => {
  it('does not leave the unpublished plugin or its public entry points in the repository', () => {
    for (const relativePath of [
      'app/commands/project-rules.ts',
      'domains/project-rules',
      'test/app/project-rules-command.test.ts',
      'test/domains/project-rules/plugin.test.ts',
      'docs/comet/specs/project-rules/spec.md',
      'docs/comet/specs/memory-rules-dashboard/spec.md',
    ]) {
      expect(existsSync(path.join(repositoryRoot, relativePath))).toBe(false);
    }

    expect(existsSync(path.join(repositoryRoot, 'docs/comet/specs/memory-dashboard/spec.md'))).toBe(
      true,
    );

    const cliSource = readFileSync(path.join(repositoryRoot, 'app/cli/index.ts'), 'utf8');
    const pluginBridgeSource = readFileSync(
      path.join(repositoryRoot, 'domains/comet-plugin/integration.ts'),
      'utf8',
    );
    expect(cliSource).not.toContain(".command('rules')");
    expect(cliSource).not.toContain('projectRules');
    expect(pluginBridgeSource).not.toContain('comet.project-rules');
    expect(pluginBridgeSource).not.toContain('ProjectRules');
    expect(pluginBridgeSource).not.toContain('previous.rules');
    expect(pluginBridgeSource).not.toContain('contribution.rules');
  });

  it('does not mention the removed plugin in active personal memory documentation', () => {
    for (const relativePath of [
      'docs/operations/PERSONAL-MEMORY-ZH.md',
      'docs/operations/PERSONAL-MEMORY.md',
    ]) {
      const content = readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
      expect(content).not.toMatch(/Project Rules?/iu);
    }
  });
});
