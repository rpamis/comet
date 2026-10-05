import { createHash } from 'node:crypto';
import { Ajv, type ValidateFunction } from 'ajv';
import {
  hashRuntimeValue,
  type RuntimeValue,
  type RuntimeValidator,
  type RuntimeValidation,
} from '../engine/runtime.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { applicationError } from './skill-adapter.js';

type ValidationInput = Parameters<RuntimeValidator['validate']>[0];
type CandidateInput = Pick<ValidationInput, 'action' | 'run' | 'context'>;

export interface ApplicationArtifactCheck {
  ref: string;
  /** 提供时先解析实际文件的 JSON，再进行完整结构校验。 */
  schema?: RuntimeValue;
  /** 检查实际 UTF-8 内容；不能以宿主回报中的同名字段替代。 */
  requiredText?: readonly string[];
}

export interface ApplicationArtifactValidatorOptions {
  id: string;
  version: string;
  projectRoot: string;
  artifacts: readonly ApplicationArtifactCheck[];
  /** 读取当前真实候选，例如实际 Git SHA 或当前业务产物身份。 */
  currentCandidate(input: CandidateInput): RuntimeValue | Promise<RuntimeValue>;
  /** 原 Action 已绑定的候选；与当前候选不一致时必须重新派发检查。 */
  candidateFromAction(input: CandidateInput): RuntimeValue;
  validateActual?(
    input: ValidationInput & { files: Readonly<Record<string, string>>; candidate: RuntimeValue },
  ): RuntimeValidation | Promise<RuntimeValidation>;
}

/** 校验回报结构、原 Action、当前候选与实际字节；拒绝时不写文件或 Run。 */
export function createApplicationArtifactValidator(
  options: ApplicationArtifactValidatorOptions,
): RuntimeValidator {
  if (
    !options.id?.trim() ||
    !options.version?.trim() ||
    !options.artifacts.length ||
    typeof options.currentCandidate !== 'function' ||
    typeof options.candidateFromAction !== 'function'
  )
    applicationError('实际工件验证器缺少身份、候选读取或工件检查');
  const ajv = new Ajv({ strict: true, allErrors: true });
  const schemas = new Map<string, ValidateFunction>();
  const refs = new Set<string>();
  for (const artifact of options.artifacts) {
    if (!artifact.ref?.trim() || refs.has(artifact.ref))
      applicationError(`重复或空工件引用：${artifact.ref}`);
    refs.add(artifact.ref);
    if (artifact.schema === undefined && !artifact.requiredText?.length && !options.validateActual)
      applicationError(`工件缺少实际内容检查：${artifact.ref}`);
    if (artifact.requiredText?.some((text) => typeof text !== 'string' || !text.trim()))
      applicationError(`工件内容检查不能为空：${artifact.ref}`);
    if (artifact.schema !== undefined) {
      if (
        typeof artifact.schema !== 'boolean' &&
        (artifact.schema === null ||
          Array.isArray(artifact.schema) ||
          typeof artifact.schema !== 'object' ||
          artifact.schema.$async === true)
      )
        applicationError(`工件需要同步 JSON Schema：${artifact.ref}`);
      schemas.set(artifact.ref, ajv.compile(artifact.schema));
    }
  }
  const hashSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
  const validateOutput = ajv.compile({
    type: 'object',
    required: ['bindingHash', 'candidateHash', 'artifactHashes'],
    additionalProperties: false,
    properties: {
      bindingHash: hashSchema,
      candidateHash: hashSchema,
      artifactHashes: {
        type: 'object',
        required: [...refs],
        additionalProperties: false,
        properties: Object.fromEntries([...refs].map((ref) => [ref, hashSchema])),
      },
    },
  });
  return {
    id: options.id,
    version: options.version,
    async validate(input) {
      if (input.outcome.status === 'failed') return { accepted: true };
      try {
        if (!validateOutput(input.outcome.output))
          throw new Error(`检查结果结构无效：${ajv.errorsText(validateOutput.errors)}`);
        const output = input.outcome.output as {
          bindingHash: string;
          candidateHash: string;
          artifactHashes: Record<string, string>;
        };
        if (output.bindingHash !== hashRuntimeValue(input.action.input))
          throw new Error('回报未绑定原 Action 输入');
        const candidate = await options.currentCandidate(input);
        const candidateHash = hashRuntimeValue(candidate);
        if (
          candidateHash !== hashRuntimeValue(options.candidateFromAction(input)) ||
          output.candidateHash !== candidateHash
        )
          throw new Error('当前候选与原 Action 或回报不一致，请重新派发当前候选的检查');
        const files: Record<string, string> = {};
        for (const artifact of options.artifacts) {
          const actual = await readProtectedProjectFile(
            options.projectRoot,
            artifact.ref,
            16 * 1024 * 1024,
            { label: '实际验收工件' },
          );
          const digest = createHash('sha256').update(actual.bytes).digest('hex');
          if (output.artifactHashes[artifact.ref] !== digest)
            throw new Error(`实际工件摘要已变化：${artifact.ref}`);
          const text = actual.bytes.toString('utf8');
          files[artifact.ref] = text;
          const validate = schemas.get(artifact.ref);
          if (validate && !validate(JSON.parse(text)))
            throw new Error(
              `实际工件结构无效：${artifact.ref}，${ajv.errorsText(validate.errors)}`,
            );
          if (artifact.requiredText?.some((required) => !text.includes(required)))
            throw new Error(`实际工件不满足内容要求：${artifact.ref}`);
        }
        const business = await options.validateActual?.({ ...input, files, candidate });
        if (options.validateActual && business?.accepted !== true)
          throw new Error(business?.reason ?? '实际工件未通过业务检查');
        // 异步业务检查期间材料变化不能复用旧结果。
        if (candidateHash !== hashRuntimeValue(await options.currentCandidate(input)))
          throw new Error('验收期间候选已变化');
        for (const artifact of options.artifacts) {
          const actual = await readProtectedProjectFile(
            options.projectRoot,
            artifact.ref,
            16 * 1024 * 1024,
            { label: '验收后的实际工件' },
          );
          if (
            createHash('sha256').update(actual.bytes).digest('hex') !==
            output.artifactHashes[artifact.ref]
          )
            throw new Error(`验收期间工件已变化：${artifact.ref}`);
        }
        return { accepted: true };
      } catch (error) {
        return {
          accepted: false,
          reason: `${error instanceof Error ? error.message : String(error)}；保留现场，修正实际工件并核对当前候选后重新检查`,
        };
      }
    },
  };
}
