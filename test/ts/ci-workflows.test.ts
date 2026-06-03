import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';

describe('CI workflows', () => {
  it('validates init e2e through owned files and installer status', async () => {
    const workflow = (await fs.readFile('.github/workflows/ci.yml', 'utf-8')).replace(/\r\n/g, '\n');
    const projectVerify = workflow.slice(
      workflow.indexOf('- name: Verify Comet skills installed (project)'),
      workflow.indexOf('- name: Verify external installer status (project)'),
    );
    const globalVerify = workflow.slice(
      workflow.indexOf('- name: Verify Comet skills installed (global)'),
      workflow.indexOf('- name: Verify external installer status (global)'),
    );

    expect(workflow).toContain('comet-init-project.json');
    expect(workflow).toContain('comet-init-global.json');
    expect(workflow).toContain('export USERPROFILE="$RUNNER_TEMP/comet-e2e-global"');
    expect(workflow).toContain('check_file "$PROJ/$sd/comet/SKILL.md"');
    expect(workflow).toContain('check_file "$HOME_DIR/$sd/comet/SKILL.md"');
    expect(projectVerify).toContain('.opencode/skills');
    expect(projectVerify).not.toContain('.config/opencode/skills');
    expect(globalVerify).toContain('.config/opencode/skills');
    expect(globalVerify).not.toContain('.opencode/skills');
    expect(workflow).toContain('function extractJsonPayload(raw) {');
    expect(workflow).toContain("throw new Error('No JSON payload found in init output');");
    expect(workflow).toContain('const data = JSON.parse(extractJsonPayload(raw));');
    expect(workflow).toContain("const allowed = new Set(['installed', 'skipped', 'failed']);");
    expect(workflow).toContain("const components = ['openspec', 'superpowers'];");
    expect(workflow).toContain("r[component] === 'failed'");
    expect(workflow).toContain('External installer statuses validated for');
    expect(workflow).not.toContain('check_glob "$PROJ/$sd/openspec-*"');
    expect(workflow).not.toContain('check_dir "$PROJ/$sd/brainstorming"');
    expect(workflow).not.toContain('check_dir "$PROJ/$sd/using-superpowers"');
    expect(workflow).not.toContain('check_glob "$HOME_DIR/$sd/openspec-*"');
    expect(workflow).not.toContain('check_dir "$HOME_DIR/$sd/brainstorming"');
    expect(workflow).not.toContain('check_dir "$HOME_DIR/$sd/using-superpowers"');
    expect(workflow).toContain('All 28 platforms project Comet skills: OK');
    expect(workflow).toContain('All 28 platforms global Comet skills: OK');
  });

  it('defines PR title linting with Comet-specific semantic scopes', async () => {
    const workflow = (await fs.readFile('.github/workflows/pr-title-lint.yml', 'utf-8')).replace(/\r\n/g, '\n');

    expect(workflow).toContain('name: PR Title Lint');
    expect(workflow).toContain('pull-requests: read');
    expect(workflow).toContain('amannn/action-semantic-pull-request@v5');
    expect(workflow).toContain('types: [opened, edited, reopened, ready_for_review]');
    expect(workflow).not.toContain('synchronize');
    expect(workflow).toContain('requireScope: false');
    expect(workflow).toContain('subjectPattern: ^.{1,72}$');

    for (const scope of [
      'cli',
      'commands',
      'core',
      'skills',
      'assets',
      'scripts',
      'docs',
      'ci',
      'deps',
      'release',
    ]) {
      expect(workflow).toMatch(new RegExp(`\\n\\s+${scope}\\n`));
    }

    for (const outOfScope of ['common', 'api', 'spi', 'plugins', 'mcp', 'tools']) {
      expect(workflow).not.toMatch(new RegExp(`\\n\\s+${outOfScope}\\n`));
    }
  });

  it('defines stale PR auto-closing with a manual dry-run mode', async () => {
    const workflow = (await fs.readFile('.github/workflows/stale-prs.yml', 'utf-8')).replace(/\r\n/g, '\n');

    expect(workflow).toContain('name: Stale PRs');
    expect(workflow).toContain("cron: '30 3 * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('dryRun:');
    expect(workflow).toContain('operationsPerRun:');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('actions/stale@v9');
    expect(workflow).toContain('debug-only: ${{ inputs.dryRun || false }}');
    expect(workflow).toContain('operations-per-run: ${{ inputs.operationsPerRun || 500 }}');
    expect(workflow).toContain('ascending: true');
    expect(workflow).toContain('days-before-stale: 90');
    expect(workflow).toContain('days-before-close: 30');
    expect(workflow).toContain("stale-pr-label: 'stale'");
    expect(workflow).toContain("close-pr-label: 'closed-stale'");
    expect(workflow).toContain('stale-issue-label: ""');
    expect(workflow).toContain('days-before-issue-stale: -1');
    expect(workflow).toContain('days-before-issue-close: -1');
  });
});
