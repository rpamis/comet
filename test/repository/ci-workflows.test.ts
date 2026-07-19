import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';

async function readWorkflow(name: string): Promise<string> {
  return (await fs.readFile(`.github/workflows/${name}`, 'utf8')).replace(/\r\n/g, '\n');
}

describe('CI workflows', () => {
  it('runs the required CI contract for every pull request', async () => {
    const workflow = await readWorkflow('ci.yml');
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
      engines?: { node?: string };
    };

    expect(workflow).toMatch(/pull_request:\s*\n\s*permissions:/);
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('pnpm check:generated');
    expect(workflow.indexOf('pnpm check:generated')).toBeLessThan(workflow.indexOf('pnpm build'));
    expect(workflow).toContain('git diff --exit-code -- assets');
    expect(workflow).toContain('pnpm test:coverage');
    expect(workflow).toContain('pnpm test:runtime-smoke');
    expect(workflow).toContain('pnpm test:package-e2e');
    expect(workflow).toContain('pnpm test:dashboard-e2e');
    expect(workflow).toContain('uv sync --locked --extra dev --extra langsmith');
    expect(workflow).toContain(
      'uv run pytest -q local/tests/scaffold local/tests/tasks/test_validation_scripts.py',
    );
    expect(workflow).toContain('ci-required:');
    expect(packageJson.engines?.node).toBe('>=22');
    expect(packageJson.scripts?.['test:package-e2e']).toBe('node scripts/release/package-e2e.mjs');
  });

  it('pins third-party actions to immutable commit SHAs', async () => {
    const names = await fs.readdir('.github/workflows');
    for (const name of names.filter((entry) => entry.endsWith('.yml'))) {
      const workflow = await readWorkflow(name);
      for (const match of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
        const reference = match[1];
        if (reference.startsWith('docker://') || reference.startsWith('./')) continue;
        expect(reference, `${name}: ${reference}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it('keeps paid model regression manual and runs offline Eval tests in CI', async () => {
    const modelWorkflow = await readWorkflow('eval-regression.yml');
    const ciWorkflow = await readWorkflow('ci.yml');

    expect(modelWorkflow).toContain('workflow_dispatch:');
    expect(modelWorkflow).not.toContain('pull_request:');
    expect(modelWorkflow).toContain(
      'uv run python local/scripts/regression_check.py --count 1 --tolerance 0.10',
    );
    expect(ciWorkflow).toContain('eval-static:');
    expect(ciWorkflow).toContain('uv sync --locked --extra dev --extra langsmith');
    expect(ciWorkflow).toContain('uv run ruff check');
    expect(ciWorkflow).toContain(
      'uv run pytest -q local/tests/scaffold local/tests/tasks/test_validation_scripts.py',
    );
  });

  it('separates unstable external integrations into a strict scheduled canary', async () => {
    const workflow = await readWorkflow('integration-canary.yml');

    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('--workflow classic --json');
    expect(workflow).toContain("result[component] === 'failed'");
    expect(workflow).toContain('throw new Error(`External installer failures:');
  });

  it('runs dependency review and CodeQL with least-privilege permissions', async () => {
    const workflow = await readWorkflow('security.yml');
    const dependabot = await fs.readFile('.github/dependabot.yml', 'utf8');

    expect(workflow).toContain('actions/dependency-review-action@');
    expect(workflow).toContain('github/codeql-action/init@');
    expect(workflow).toContain('security-events: write');
    expect(workflow).toContain('fail-on-severity: high');
    expect(dependabot).toContain('package-ecosystem: npm');
    expect(dependabot).toContain('package-ecosystem: pip');
    expect(dependabot).toContain('package-ecosystem: github-actions');
  });

  it('defines PR title linting with Comet-specific semantic scopes', async () => {
    const workflow = await readWorkflow('pr-title-lint.yml');

    expect(workflow).toContain('name: PR Title Lint');
    expect(workflow).toContain('pull-requests: read');
    expect(workflow).toContain('types: [opened, edited, reopened, ready_for_review]');
    expect(workflow).toContain('requireScope: false');
    expect(workflow).toContain('subjectPattern: ^.{1,72}$');
  });

  it('defines stale PR auto-closing with a manual dry-run mode', async () => {
    const workflow = await readWorkflow('stale-prs.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('debug-only: ${{ inputs.dryRun || false }}');
    expect(workflow).toContain('days-before-stale: 90');
    expect(workflow).toContain('days-before-close: 30');
  });
});
