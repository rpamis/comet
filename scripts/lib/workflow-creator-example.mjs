#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 隔离项目中的固定SDK样例；没有真实模型、第三方Skill或外部发布。
const project = path.resolve(process.argv[2]);
const sdkPackage = fileURLToPath(import.meta.resolve('@rpamis/comet/package.json'));
const sdk = JSON.parse(await fs.readFile(sdkPackage, 'utf8'));
const cli = path.join(path.dirname(sdkPackage), 'bin/comet.js');
await fs.mkdir(path.join(project, '.comet/requests'), { recursive: true });
const request = path.join(project, '.comet/requests/creator-example.json');
const call = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, [cli, 'creator', ...args, '--project', project, '--json'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
let run = call(
  'start',
  'creator-package-example',
  '--goal',
  'Create a local report with approval before publication',
  '--install-target',
  'exports/report',
  '--host',
  'codex',
);
const dispatch = async (value) => {
  await fs.writeFile(
    request,
    JSON.stringify({ runId: run.runId, expectedRevision: run.revision, ...value }),
  );
  run = call('dispatch', run.runId, '--request', request);
};
const action = run.actions[0];
await dispatch({
  operation: 'claim',
  actionId: action.id,
  attempt: action.attempt,
  inputHash: action.inputHash,
  executorId: 'creator-host',
  sessionId: 'package-fixture',
  claimToken: 'package-fixture',
  capabilities: ['skill-load', 'handoff'],
});
await dispatch({
  operation: 'record-outcome',
  outcome: {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: 'package-fixture',
    outcomeId: 'fixture-analysis',
    status: 'succeeded',
    output: {
      summary: 'Local report, approval, and verified publication.',
      failurePaths: ['Reject a draft and retain it; revise and request approval again.'],
      limitations: ['No real host or model execution.'],
      proposal: {
        schema: 'comet.workflow.application.plan.v1',
        manifest: {
          schema: 'comet.workflow.application.v1',
          id: 'creator-package-report',
          version: '1',
          base: 'standalone',
          runtimeVersion: sdk.version,
          entrySkill: 'SKILL.md',
          module: 'application.mjs',
          skills: [],
          bindings: [],
        },
        composition: { kind: 'report' },
        modules: {},
        documents: {
          'SKILL.md':
            '---\nname: creator-package-report\ndescription: Generate a local source-backed report and publish only its approved content.\n---\n\n# Local report\n\nRead the title, body and sources. Generate the actual draft, ask for approval of that content, and publish the approved draft. Preserve rejected drafts; revisions require another approval. Check draft and published file hashes before completion.\n',
          'rules/workflow-guard.md':
            '# Report rules\n\nKeep sources traceable. Publish only approved content and retain rejected drafts. Changed content requires fresh approval and file verification.\n',
        },
      },
    },
  },
});
run = call('next', run.runId);
const choose = async (choice, expected) => {
  const wait = run.waits[0];
  if (wait?.stepId !== expected) throw new Error(`Expected ${expected}, received ${wait?.stepId}`);
  await dispatch({
    operation: 'resolve-wait',
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: `${wait.id}-${choice}`,
    choice,
  });
  run = call('next', run.runId);
};
await choose('approved', 'confirm-plan');
const verification = run.verification?.artifactVerification;
if (!verification || !verification.checks.some((check) => !check.accepted))
  throw new Error('Required positive and negative local checks did not run');
await choose('skip', 'confirm-eval');
await choose('approved', 'confirm-install');
if (run.status !== 'completed' || !run.delivered?.installation)
  throw new Error('Creator did not formally install the verified application');
const cold = call('status', run.runId);
if (
  cold.status !== 'completed' ||
  cold.verification.artifactVerification.packageHash !== verification.packageHash
)
  throw new Error('Creator cold recovery lost bound verification');
console.log(
  JSON.stringify({
    version: sdk.version,
    status: run.status,
    runId: run.runId,
    checks: verification.checks.length,
    installed: run.delivered.installation.id,
  }),
);
