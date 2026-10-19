import { excludeClassicRuntimeSchemas } from '../../scripts/lib/runtime-schema-build.mjs';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { Ajv } from 'ajv';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  generateRuntimeSchemas,
  collectBuiltinRuntimeSchemas,
} from '../../scripts/build/build-runtime-schemas.mjs';
import { precompiledRuntimeSchemas } from '../../domains/engine/runtime-schema.generated.js';
import { compileRuntimeSchema } from '../../domains/engine/runtime-schema.js';
import type { RuntimeValue } from '../../domains/engine/runtime-json.js';

function sample(schema: any): any {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf || schema.oneOf) return sample((schema.anyOf ?? schema.oneOf)[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, child]) => [key, sample(child)]),
    );
  if (type === 'array')
    return Array.from({ length: schema.minItems ?? 0 }, () => sample(schema.items ?? {}));
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return schema.minimum ?? 0;
  if (type === 'null') return null;
  return 'x'.repeat(schema.minLength ?? 1);
}

describe('built-in Runtime schema generation', () => {
  it('regenerates exactly from all Classic profiles', async () => {
    expect(await generateRuntimeSchemas()).toBe(
      await readFile('domains/engine/runtime-schema.generated.ts', 'utf8'),
    );
    expect([...precompiledRuntimeSchemas.keys()].sort()).toEqual(
      await collectBuiltinRuntimeSchemas(),
    );
  });

  it('matches isolated AJV results, errors and error text for built-in schemas', () => {
    for (const content of precompiledRuntimeSchemas.keys()) {
      const schema = JSON.parse(content);
      const ajv = new Ajv({ strict: true, allErrors: true });
      const reference = ajv.compile(schema);
      const actual = compileRuntimeSchema(schema);
      const valid = sample(schema);
      const samples = [
        null,
        false,
        true,
        0,
        -1,
        1.5,
        '',
        '😀',
        'sample',
        [],
        [null],
        {},
        { unexpected: true },
        valid,
      ];
      if (valid && typeof valid === 'object' && !Array.isArray(valid)) {
        for (const key of Object.keys(valid)) {
          samples.push({ ...valid, [key]: null }, { ...valid, [key]: [] });
          const missing = { ...valid };
          delete missing[key];
          samples.push(missing);
        }
      }
      for (const value of samples) {
        expect(actual.validate(value), content).toBe(reference(value));
        expect(actual.validate.errors, content).toEqual(reference.errors);
        expect(actual.errorsText(), content).toBe(ajv.errorsText(reference.errors));
      }
    }
  });

  it('validates generated helpers in a real standalone Node ESM process', async () => {
    const result = await build({
      entryPoints: ['domains/engine/runtime-schema.generated.ts'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
    });
    const expected = [...precompiledRuntimeSchemas.keys()].map((content) => {
      const schema = JSON.parse(content);
      const value = sample(schema);
      const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
      return { value, valid: validate(value), errors: validate.errors };
    });
    const script =
      Buffer.from(result.outputFiles[0].contents).toString() +
      `\nconst samples = ${JSON.stringify(expected.map(({ value }) => value))}; console.log(JSON.stringify([...precompiledRuntimeSchemas.values()].map((validate, index) => ({valid: validate(samples[index]), errors: validate.errors}))));`;
    const stdout = execFileSync(process.execPath, ['--input-type=module'], {
      input: script,
      encoding: 'utf8',
    });
    expect(JSON.parse(stdout)).toEqual(expected.map(({ valid, errors }) => ({ valid, errors })));
  });

  it('excludes Classic schemas from Native assets while retaining dynamic validation', async () => {
    const result = await build({
      entryPoints: ['domains/engine/runtime-schema.ts'],
      plugins: [excludeClassicRuntimeSchemas()],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      banner: {
        js: "import { createRequire as __require } from 'node:module'; const require = __require(process.cwd() + '/package.json');",
      },
    });
    const code = Buffer.from(result.outputFiles[0].contents).toString();
    expect(code).not.toContain('subagent-driven-development');
    expect(code).not.toContain('classicStateSchema');
    const stdout = execFileSync(process.execPath, ['--input-type=module'], {
      input:
        code +
        `\nconst validator = compileRuntimeSchema({ type: 'string', minLength: 2 }); console.log(JSON.stringify([validator.validate('valid'), validator.validate('x'), validator.errorsText()]));`,
      encoding: 'utf8',
    });
    expect(JSON.parse(stdout)).toEqual([true, false, 'data must NOT have fewer than 2 characters']);
  });

  it('skips compilation only on full content matches and isolates changed or invalid schemas', () => {
    const schema = JSON.parse(precompiledRuntimeSchemas.keys().next().value!);
    const compile = vi.spyOn(Ajv.prototype, 'compile');
    try {
      compileRuntimeSchema(schema);
      expect(compile).not.toHaveBeenCalled();
      const changed = {
        ...schema,
        $id: 'https://example.invalid/precompiled-test',
        $comment: 'changed schema content',
      };
      compileRuntimeSchema(changed);
      expect(compile).toHaveBeenCalledTimes(1);
      expect(() => compileRuntimeSchema({ $ref: changed.$id })).toThrow();
      expect(() =>
        compileRuntimeSchema({ ...schema, type: 'invalid-type' } as RuntimeValue),
      ).toThrow();
      expect(() => compileRuntimeSchema({ ...schema, unknownKeyword: true })).toThrow();
    } finally {
      compile.mockRestore();
    }
  });
});
