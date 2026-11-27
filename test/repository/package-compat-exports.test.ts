import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');

beforeAll(() => ensureCliBuilt(repositoryRoot), 120_000);

it('keeps existing deep imports usable through the package name', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-compat-exports-'));
  try {
    const skill = path.join(project, '.comet', 'skills', 'demo');
    await fs.mkdir(path.join(skill, 'comet'), { recursive: true });
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Demo\n');
    await fs.writeFile(
      path.join(skill, 'comet', 'skill.yaml'),
      `apiVersion: comet/v1alpha1
kind: Skill
metadata: { name: demo, version: '1', description: Demo Skill }
goal: { statement: Complete the demo, inputs: [], outputs: [], success: [Done] }
orchestration:
  mode: deterministic
  entry: finish
  steps:
    - { id: finish, action: { type: checkpoint } }
skills: []
agents: []
tools: []
`,
    );
    await fs.mkdir(path.join(project, 'eval', 'archives', 'archived'), { recursive: true });

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import assert from 'node:assert/strict';
          import { skillInspectCommand, skillShowCommand, skillValidateCommand } from '@rpamis/comet/dist/app/commands/skill.js';
          import { listEvalArchiveSources } from '@rpamis/comet/dist/domains/eval/index.js';
          import { listEvalArchiveSources as listFromSource } from '@rpamis/comet/dist/domains/eval/eval-run-sources.js';
          import { sanitizeApplicationObservation } from '@rpamis/comet/dist/domains/dashboard/application-collector.js';

          const project = process.argv[1];
          const output = [];
          console.log = (value) => output.push(value);
          for (const command of [skillValidateCommand, skillInspectCommand, skillShowCommand]) {
            await command('demo', { project, json: true });
            await command('demo', { project });
          }
          const [validated, validateText, inspected, inspectText, shown, showText] = output;
          const { valid, name, version, origin, root, hash } = JSON.parse(shown);
          assert.deepEqual(JSON.parse(validated), { valid, name, version, origin, root, hash });
          assert.deepEqual(JSON.parse(inspected), JSON.parse(shown));
          assert.equal(validateText, 'Valid Comet Skill: demo@1 (project)\\nHash: ' + hash + '\\nRoot: ' + root);
          assert.equal(inspectText, [
            'demo@1 (project)', 'Demo Skill', 'Root: ' + root, 'Orchestration: deterministic',
            'Steps: 1', 'Skills: 0', 'Agents: 0', 'Tools: 0', 'Runtime checks: 0',
          ].join('\\n'));
          assert.equal(showText, 'Valid Comet Skill: ' + inspectText.replace('\\nOrchestration:', '\\nHash: ' + hash + '\\nOrchestration:'));
          assert.deepEqual(await listEvalArchiveSources(project), await listFromSource(project));
          assert.deepEqual((await listEvalArchiveSources(project)).map(({ id }) => id), ['archived']);
          assert.deepEqual(sanitizeApplicationObservation({ entries: [{ claimToken: 'fixture', status: 'passed' }] }), {
            entries: [{ status: 'passed' }],
          });
        `,
        project,
      ],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});
