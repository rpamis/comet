import { spawnSync } from 'child_process';

import { resolveNodeCliCommand } from '../../platform/process/node-cli-command.js';
import { projectCliAgentObservation } from '../workflow-contract/output-envelope.js';
import { classicIssue } from './classic-issues.js';

import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import { assertClassicLayoutWritable, discoverClassicProject } from './classic-layout.js';
import { assertClassicOpenSpecRootHealthy } from './classic-openspec-root.js';

function normalizedArguments(args: readonly string[]): string[] {
  return args[0] === '--' ? args.slice(1) : [...args];
}

export async function executeClassicOpenSpec(
  args: readonly string[],
  startPath = process.cwd(),
): Promise<ClassicCommandResult> {
  const openSpecArgs = normalizedArguments(args);
  if (openSpecArgs.length === 0) {
    return {
      exitCode: 64,
      stderr: 'Usage: comet classic openspec -- <openspec-args...>',
    };
  }

  const projectRoot = await discoverClassicProject(startPath);
  const layout = await assertClassicLayoutWritable(projectRoot);
  await assertClassicOpenSpecRootHealthy(projectRoot, layout);
  const command = process.env.COMET_OPENSPEC || 'openspec';
  const launch = resolveNodeCliCommand(command, openSpecArgs, { cwd: layout.openSpecBase });
  const result = spawnSync(launch.command, launch.args, {
    cwd: layout.openSpecBase,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    ...(launch.env ? { env: launch.env } : {}),
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return {
      exitCode: code === 'ENOENT' ? 127 : 70,
      stdout: result.stdout || undefined,
      stderr:
        result.stderr ||
        (code === 'ENOENT' ? `OpenSpec CLI not found: ${command}` : result.error.message),
    };
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || undefined,
    stderr: result.stderr || undefined,
  };
}

async function agentOpenSpec(args: string[]): Promise<ClassicCommandResult> {
  const forwarded = normalizedArguments(args.slice(1));
  const root = await discoverClassicProject(process.cwd());
  const layout = await assertClassicLayoutWritable(root);
  let result: ClassicCommandResult;
  try {
    result = await executeClassicOpenSpec(forwarded, root);
  } catch (error) {
    result = { exitCode: 70, stderr: error instanceof Error ? error.message : String(error) };
  }
  let upstream: unknown = null;
  try {
    upstream = JSON.parse(result.stdout ?? '');
  } catch {
    /* upstream text remains available */
  }
  const changeIndex = forwarded.indexOf('--change');
  const change =
    forwarded[0] === 'new' && forwarded[1] === 'change'
      ? forwarded[2]
      : changeIndex >= 0
        ? forwarded[changeIndex + 1]
        : undefined;
  const status =
    upstream && typeof upstream === 'object' ? (upstream as Record<string, unknown>) : {};
  const artifacts = Array.isArray(status.artifacts)
    ? (status.artifacts as Array<Record<string, unknown>>)
    : [];
  const required = new Set<string>(['proposal', 'tasks']);
  for (const id of Array.isArray(status.applyRequires) ? status.applyRequires : [])
    if (typeof id === 'string') required.add(id);
  for (const id of required) {
    const artifact = artifacts.find((item) => item.id === id);
    for (const dependency of Array.isArray(artifact?.requires) ? artifact.requires : [])
      if (typeof dependency === 'string') required.add(dependency);
  }
  const ready = artifacts.find(
    (artifact) =>
      artifact.status === 'ready' && typeof artifact.id === 'string' && required.has(artifact.id),
  );
  const complete =
    artifacts.length > 0 &&
    [...required].every((id) =>
      artifacts.some(
        (artifact) => artifact.id === id && ['done', 'skipped'].includes(String(artifact.status)),
      ),
    );
  const nextArgs = change
    ? ready && forwarded[0] === 'status'
      ? ['instructions', String(ready.id), '--change', change, '--json']
      : ['status', '--change', change, '--json']
    : null;
  const data = {
    projectRoot: root,
    workspace: { projectRoot: root },
    issues:
      result.exitCode === 0
        ? []
        : [
            classicIssue(result.stderr ?? 'OpenSpec command failed', {
              code: 'CLASSIC_OPENSPEC_FAILED',
              path: 'upstream',
              actual: result.exitCode,
              expected: 0,
              remediation: 'Repair the upstream command error and retry through this adapter.',
            }),
          ],
    upstream: {
      cwd: layout.openSpecBase,
      exitCode: result.exitCode,
      data: upstream,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    },
    nextAction:
      result.exitCode === 0 && nextArgs
        ? {
            kind: 'openspec',
            cwd: root,
            argv:
              forwarded[0] === 'status' && complete
                ? ['comet', 'state', 'artifacts', change!, '--json']
                : ['comet', 'classic', 'openspec', '--agent-json', '--', ...nextArgs],
            reason:
              forwarded[0] === 'instructions'
                ? 'Complete the instructed artifact, then refresh status using this action.'
                : 'Continue through the configured Classic OpenSpec adapter.',
          }
        : null,
  };
  return {
    exitCode: result.exitCode,
    data,
    stdout:
      JSON.stringify({
        command: 'openspec',
        exitCode: result.exitCode,
        data,
        agent: projectCliAgentObservation({ ...data, continuation: data.nextAction }),
      }) + '\n',
  };
}

export const classicOpenSpecCommand: ClassicCommandHandler = async (args) => {
  // Opt-in agent projection leaves the historical raw upstream stdout/JSON contract intact.
  if (args[0] !== '--agent-json') return executeClassicOpenSpec(args);
  try {
    return await agentOpenSpec(args);
  } catch (error) {
    const data = {
      issues: [
        classicIssue(error, {
          code: 'CLASSIC_OPENSPEC_FAILED',
          path: 'projectRoot',
          remediation: 'Restore the configured Classic project root before retrying the adapter.',
        }),
      ],
    };
    return {
      exitCode: 70,
      data,
      stdout:
        JSON.stringify({
          command: 'openspec',
          exitCode: 70,
          data,
          agent: projectCliAgentObservation(data),
        }) + '\n',
    };
  }
};
