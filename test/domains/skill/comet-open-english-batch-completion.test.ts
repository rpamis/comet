import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('comet-open English batch completion protocol', () => {
  it('uses the OpenSpec status graph instead of a hard-coded artifact order', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('From unfinished `ready` artifacts');
    expect(skill).toContain('Must not hard-code generation order');
    expect(skill).toContain('advance the `applyRequires` dependency closure');
    expect(skill).not.toContain(
      '**Standard Artifact Loop** (for each `artifact-id`: `proposal` → `design` → `tasks`)',
    );
  });

  it('requires every split item to pass the CLI completion checks', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('comet classic openspec -- status --change "<name>" --json');
    expect(skill).toContain('validates the full required closure');
    expect(skill).toContain('comet state artifacts <name> --json');
    expect(skill).toContain('isComplete is diagnostic');
    expect(skill).toContain('If any split item fails these checks');
    expect(skill).toContain('comet state check <name> design');
  });

  it('defines an explicit recovery action for done, ready, and blocked artifacts', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('On recovery, process the status in this order');
    expect(skill).toContain('`done`: keep the artifact unchanged and do not regenerate it');
    expect(skill).toContain('`ready`: fetch its instructions');
    expect(skill).toContain('`blocked`: follow `missingDeps`');
    expect(skill).toContain('dependencies in the `applyRequires` closure');
    expect(skill).toContain('until the full required closure is done or legitimately skipped');
    expect(skill).toContain('an optional artifact outside `applyRequires` must not block');
  });
});
