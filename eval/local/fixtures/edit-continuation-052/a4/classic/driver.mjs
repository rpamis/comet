import { config, emit } from './common.mjs';
import { seed, checkpointJudgment, verify, approve } from './controller.mjs';
import { validate } from './validator.mjs';

const [mode, ...args] = process.argv.slice(2);
const handlers = {
  seed: ['SEED', seed],
  'checkpoint-judgment': ['JUDGMENT', checkpointJudgment],
  verify: ['VERIFY', verify],
  approve: ['APPROVE', approve],
  validate: ['VALIDATE', validate],
};
try {
  if (!Object.hasOwn(handlers, mode))
    throw new Error('Allowed modes: seed | checkpoint-judgment | verify | approve | validate');
  const c = config(args);
  const [marker, handler] = handlers[mode];
  emit(marker, await handler(c));
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      mode,
      error: error instanceof Error ? error.message : String(error),
      scope: 'Isolated A4 fixture only; preserve actual failure, no fallback or automatic replay',
    }),
  );
  process.exitCode = 1;
}
