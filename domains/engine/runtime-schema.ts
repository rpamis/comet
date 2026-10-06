import { Ajv, type ValidateFunction } from 'ajv';
import { canonicalRuntimeJson, type RuntimeValue } from './runtime-json.js';

interface RuntimeSchemaValidator {
  validate: ValidateFunction;
  errorsText(): string;
}

// 限制长驻 Runtime 的缓存大小；身份只由严格 JSON 内容决定，不信任 $id 或对象引用。
const MAX_CACHED_SCHEMAS = 128;
const MAX_CACHED_SCHEMA_CHARACTERS = 1024 * 1024;
const validators = new Map<string, RuntimeSchemaValidator>();
let cachedCharacters = 0;

export function compileRuntimeSchema(schema: RuntimeValue): RuntimeSchemaValidator {
  const content = canonicalRuntimeJson(schema);
  const cached = validators.get(content);
  if (cached) {
    validators.delete(content);
    validators.set(content, cached);
    return cached;
  }

  // 独立编译器避免不同工作流重用 $id 时互相注册或解析外部引用。
  const ajv = new Ajv({ strict: true, allErrors: true });
  const validate = ajv.compile(JSON.parse(content) as boolean | object);
  const compiled = { validate, errorsText: () => ajv.errorsText(validate.errors) };
  if (content.length <= MAX_CACHED_SCHEMA_CHARACTERS) {
    while (
      validators.size >= MAX_CACHED_SCHEMAS ||
      cachedCharacters + content.length > MAX_CACHED_SCHEMA_CHARACTERS
    ) {
      const oldest = validators.keys().next().value!;
      validators.delete(oldest);
      cachedCharacters -= oldest.length;
    }
    validators.set(content, compiled);
    cachedCharacters += content.length;
  }
  return compiled;
}
