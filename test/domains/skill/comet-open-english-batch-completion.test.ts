import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('comet-open English batch completion protocol', () => {
  it('uses the OpenSpec status graph instead of a hard-coded artifact order', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('select every item in `artifacts` with `status: "ready"`');
    expect(skill).toContain('Must not hard-code the artifact order');
    expect(skill).not.toContain(
      '**Standard Artifact Loop** (for each `artifact-id`: `proposal` → `design` → `tasks`)',
    );
  });

  it('requires every split item to pass the CLI completion checks', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('openspec status --change "<name>" --json');
    expect(skill).toContain('`isComplete` must be `true`');
    expect(skill).toContain('If any split item fails these checks');
    expect(skill).toContain('comet state check <name> design');
  });

  it('defines an explicit recovery action for done, ready, and blocked artifacts', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('On recovery, process the status in this order');
    expect(skill).toContain('`done`: the artifact is complete; keep its files unchanged');
    expect(skill).toContain('`ready`: its dependencies are satisfied and it can be generated now');
    expect(skill).toContain(
      '`blocked`: it cannot be generated yet; this does not mean waiting for the user or for time to pass',
    );
    expect(skill).toContain('complete the artifacts listed in `missingDeps` first');
    expect(skill).toContain(
      'Only `isComplete: true` means all OpenSpec open artifacts are complete',
    );
  });
});
