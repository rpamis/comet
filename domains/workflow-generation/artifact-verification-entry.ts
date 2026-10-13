import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  hashRuntimeValue,
  createRuntime,
  createMemoryRuntimeStore,
  type WorkflowRun,
  type RuntimeValue,
  type RuntimeValidator,
} from '../engine/runtime.js';
import {
  loadWorkflowApplication,
  collectApplicationArtifactEvidence,
  validateApplicationArtifactOutcome,
  createApplicationSkillExecutor,
  type SkillExecutionHost,
  type ApplicationArtifactContract,
} from '../workflow-application/index.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import type {
  ApplicationArtifactTestCase,
  ApplicationArtifactVerification,
} from './artifact-verification.js';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports, registerHooks, createRequire } from 'node:module';
import { Ajv, type AnySchema } from 'ajv';
import type { ApplicationCompositionPlan } from './compiler.js';

function blockNetwork() {
  const deny = () => {
    throw new Error('产物验证器只允许本地检查，不能访问网络或监听端口');
  };
  for (const [target, names] of [
    [net, ['connect', 'createConnection']],
    [net.Socket.prototype, ['connect']],
    [net.Server.prototype, ['listen']],
    [tls, ['connect']],
    [http, ['request', 'get']],
    [https, ['request', 'get']],
    [http2, ['connect']],
    [dgram.Socket.prototype, ['bind', 'send', 'connect']],
    [dns, ['lookup', 'resolve', 'resolve4', 'resolve6']],
    [dns.promises, ['lookup', 'resolve', 'resolve4', 'resolve6']],
  ] as const) {
    for (const name of names)
      Object.defineProperty(target, name, { value: deny, configurable: false, writable: false });
  }
  globalThis.fetch = deny;
  syncBuiltinESMExports();
}

async function main() {
  blockNetwork();
  const sdkPackage = new URL('../../../package.json', import.meta.url);
  const sdk = JSON.parse(await fs.readFile(sdkPackage, 'utf8')) as {
    exports: Record<string, { import?: string }>;
  };
  registerHooks({
    resolve(specifier, context, next) {
      const entry = specifier.startsWith('@rpamis/comet/')
        ? sdk.exports[`./${specifier.slice('@rpamis/comet/'.length)}`]?.import
        : undefined;
      return next(entry ? new URL(entry, sdkPackage).href : specifier, context);
    },
  });
  const request = JSON.parse(await fs.readFile(process.argv[2], 'utf8')) as {
    file: string;
    tests: ApplicationArtifactTestCase[];
    contracts: ApplicationArtifactContract[];
    root: string;
    packageHash: string;
    composition: ApplicationCompositionPlan;
  };
  const checks: ApplicationArtifactVerification['checks'] = [];
  let sequence = 0;
  for (const test of request.tests) {
    const contract = request.contracts.find(
      (c) => c.workflowId === test.workflowId && c.stepId === test.stepId,
    )!;
    const attempt = async (
      name: string,
      files: Record<string, string>,
      output: RuntimeValue,
      mutation?: (project: string, artifacts: { uri: string; sha256: string }[]) => Promise<void>,
      expectPass = false,
    ) => {
      const project = path.join(request.root, `case-${++sequence}`);
      await fs.mkdir(project);
      for (const [ref, text] of Object.entries(files)) {
        // 源样例只创建在隔离目录；绝不删除或写入用户项目。
        const inspected = await inspectProtectedProjectPath(project, ref, {
          label: '产物验收样例',
        });
        await fs.mkdir(path.dirname(inspected.target), { recursive: true });
        await fs.writeFile(inspected.target, text, { flag: 'wx' });
      }
      const loaded = await loadWorkflowApplication({ file: request.file, projectRoot: project });
      const original = loaded.implementation.workflows.find((w) => w.id === test.workflowId)!;
      const rawStep = original.steps[test.stepId];
      let validators = loaded.implementation.validators;
      let validator = rawStep.validator;
      // 独立检查扩展作者的业务验证器；领域候选与审批仍在实际 Native/Classic Run 中核对。
      const composition = request.composition;
      if (composition.kind === 'native' || composition.kind === 'classic') {
        const extension = composition.extensions.find((entry) =>
          composition.kind === 'native'
            ? 'scopes' in entry &&
              entry.scopes.some((scope) => test.stepId === `native.extension.${scope}.${entry.id}`)
            : test.stepId === `classic.extension.${entry.id}`,
        );
        if (extension) {
          const module = createRequire(request.file)(
            path.join(path.dirname(request.file), 'bindings.mjs'),
          );
          const ports = await module.createBindings({
            ...loaded,
            projectRoot: project,
            packageRoot: path.dirname(request.file),
            createSkillExecutor(host: SkillExecutionHost) {
              return createApplicationSkillExecutor(loaded, host);
            },
          });
          const business = (ports.validators as RuntimeValidator[]).find(
            (v) => v.id === extension.validator.id && v.version === extension.validator.version,
          );
          if (!business) throw new Error('未注册固定扩展的业务验证器');
          validators = [business];
          validator = extension.validator;
        }
      }
      const step = {
        ...(rawStep.type === 'handoff' ||
        rawStep.type === 'invoke_skill' ||
        rawStep.type === 'call_tool'
          ? {
              type: rawStep.type,
              ref: rawStep.ref,
              ...(rawStep.requiredCapabilities
                ? { requiredCapabilities: rawStep.requiredCapabilities }
                : {}),
            }
          : { type: 'handoff' as const, ref: 'artifact-probe' }),
        ...(rawStep.input !== undefined ? { input: rawStep.input } : {}),
        ...(rawStep.outputSchema !== undefined ? { outputSchema: rawStep.outputSchema } : {}),
      };
      const initialState = test.state !== undefined ? test.state : original.initialState;
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [
          {
            id: original.id,
            version: original.version,
            entry: test.stepId,
            ...(test.activation !== undefined ? { commands: { fixture: test.stepId } } : {}),
            ...(initialState !== undefined
              ? { initialState, stateSchema: original.stateSchema ?? true }
              : {}),
            steps: {
              [test.stepId]: {
                ...step,
                ...(validator ? { validator } : {}),
              },
            },
          },
        ],
        validators,
        validateOutcome: async ({ outcome }) => {
          try {
            await validateApplicationArtifactOutcome(project, contract, outcome);
            return { accepted: true };
          } catch (error) {
            return {
              accepted: false,
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
      let run = await runtime.start({
        runId: 'artifact-probe',
        workflow: { id: original.id, version: original.version },
        input: test.input ?? {},
      });
      if (test.activation !== undefined)
        run = await runtime.dispatchCommand({
          runId: run.runId,
          expectedRevision: run.revision,
          commandId: 'fixture-activation',
          name: 'fixture',
          input: test.activation,
        });
      const action = run.actions.find((a) => a.status === 'pending')!;
      const claimToken = randomUUID();
      run = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'artifact-probe',
        claimToken,
        capabilities: action.requiredCapabilities,
      });
      let artifacts: { uri: string; sha256: string }[] = [];
      try {
        artifacts = (await collectApplicationArtifactEvidence(project, contract, output)).artifacts;
      } catch {
        /* 负例仍进入真实Runtime，让目标产物检查给出拒绝。 */
      }
      await mutation?.(project, artifacts);
      let accepted = false;
      try {
        const result = await runtime.recordOutcome({
          runId: run.runId,
          context: { requestId: `fixture-${sequence}`, projectRoot: project },
          outcome: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken,
            outcomeId: `probe-${sequence}`,
            status: 'succeeded',
            output,
            artifacts,
          },
        });
        accepted =
          result.status === 'completed' &&
          result.actions.find((a) => a.id === action.id)?.status === 'succeeded';
      } catch (error) {
        if (expectPass)
          throw new Error(
            `${test.workflowId}/${test.stepId} 正常样例未通过：${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        const rejected = await runtime.inspect(run.runId);
        if (
          rejected.actions.find((a) => a.id === action.id)?.status !== 'running' ||
          !rejected.actions.find((a) => a.id === action.id)?.rejectedOutcomes?.length
        )
          throw new Error('异常样例没有保留原Action和拒绝证据', { cause: error });
      }
      if (accepted !== expectPass)
        throw new Error(`${test.workflowId}/${test.stepId} ${name} 没有按预期阻止阶段完成`);
      checks.push({ workflowId: test.workflowId, stepId: test.stepId, name, accepted });
    };
    await attempt('valid', { ...test.files }, test.output, undefined, true);
    const refs = contract.artifacts.map(
      (a) =>
        a.ref ??
        (a
          .refFrom!.split('.')
          .reduce<unknown>(
            (value, name) =>
              value && typeof value === 'object'
                ? (value as Record<string, unknown>)[name]
                : undefined,
            test.output,
          ) as string),
    );
    for (const [index, ref] of refs.entries()) {
      await attempt(`missing:${ref}`, { ...test.files }, test.output, async (project) => {
        const target = await inspectProtectedProjectPath(project, ref, {
          label: '缺失产物反例',
          expected: 'file',
        });
        await fs.unlink(target.target);
      });
      if (contract.artifacts[index].nonEmpty !== false)
        await attempt(`empty:${ref}`, { ...test.files }, test.output, async (project) => {
          await fs.writeFile(path.join(project, ref), '');
        });
      if (
        contract.artifacts[index].schema !== undefined ||
        contract.artifacts[index].requiredText?.length ||
        contract.artifacts[index].requiredHeadings?.length
      )
        await attempt(
          `invalid-content:${ref}`,
          { ...test.files, [ref]: 'invalid-artifact-content' },
          test.output,
        );
      await attempt(`changed:${ref}`, { ...test.files }, test.output, async (project) => {
        await fs.appendFile(path.join(project, ref), '\nchanged-after-evidence\n');
      });
    }
    for (const invalid of test.invalidCases ?? []) {
      const output = invalid.output ?? test.output;
      const files = { ...test.files, ...invalid.files };
      // 业务反例不能靠通用文件条件或JSON回报格式失败来冒充业务检查。
      const precheck = path.join(request.root, `business-precheck-${++sequence}`);
      await fs.mkdir(precheck);
      for (const [ref, source] of Object.entries(files)) {
        const target = await inspectProtectedProjectPath(precheck, ref, { label: '业务反例样例' });
        await fs.mkdir(path.dirname(target.target), { recursive: true });
        await fs.writeFile(target.target, source);
      }
      await collectApplicationArtifactEvidence(precheck, contract, output);
      const preloaded = await loadWorkflowApplication({
        file: request.file,
        projectRoot: precheck,
      });
      const schema = preloaded.implementation.workflows.find((w) => w.id === test.workflowId)!
        .steps[test.stepId].outputSchema;
      if (schema !== undefined && !new Ajv({ strict: true }).compile(schema as AnySchema)(output))
        throw new Error('业务反例必须通过步骤回报结构检查');
      await attempt(invalid.name, files, output);
    }
  }
  process.stdout.write(
    JSON.stringify({
      schema: 'comet.workflow.artifact-verification.v1',
      packageHash: request.packageHash,
      contractsHash: hashRuntimeValue(request.contracts),
      checks,
    }),
  );
}
main().catch((error) => {
  const failure = error as Error & { code?: string; resource?: string };
  process.stderr.write(
    `${failure.message ?? String(error)}${failure.code === 'ERR_ACCESS_DENIED' ? ` (${failure.resource ?? 'unknown resource'})\n${failure.stack?.split('\n').slice(1, 5).join('\n') ?? ''}` : ''}`,
  );
  process.exitCode = 1;
});
