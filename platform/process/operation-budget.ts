import { AsyncLocalStorage } from 'node:async_hooks';

interface OperationBudget {
  readonly deadline: number;
  readonly signal: AbortSignal;
}
const budgets = new AsyncLocalStorage<OperationBudget>();

export class OperationBudgetError extends Error {
  public readonly code = 'OPERATION_BUDGET_EXCEEDED';
  public constructor() {
    super('Operation time budget exceeded; unfinished work can be resumed.');
  }
}

export function operationSignal(): AbortSignal | undefined {
  return budgets.getStore()?.signal;
}
export function remainingOperationMs(maximum: number): number {
  return Math.max(
    0,
    Math.min(maximum, (budgets.getStore()?.deadline ?? Infinity) - performance.now()),
  );
}
export function throwIfOperationAborted(): void {
  const current = budgets.getStore();
  if (current && (current.signal.aborted || performance.now() >= current.deadline))
    throw new OperationBudgetError();
}

/** HTTP、进程与队列共用调用方预算；操作结束前等待取消清理，避免留下后台请求。 */
export async function withOperationBudget<T>(
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 2147483647
  )
    throw new Error('Operation timeout must be positive');
  const parent = budgets.getStore();
  const controller = new AbortController();
  const signals = [controller.signal, parent?.signal, options.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const signal = AbortSignal.any(signals);
  const deadline = Math.min(performance.now() + options.timeoutMs, parent?.deadline ?? Infinity);
  const timer = setTimeout(
    () => controller.abort(new OperationBudgetError()),
    Math.max(0, deadline - performance.now()),
  );
  try {
    return await budgets.run({ deadline, signal }, () => operation(signal));
  } finally {
    clearTimeout(timer);
    controller.abort(new OperationBudgetError());
  }
}

/** 已取消的工作仍需释放自己持有的持久化租约。 */
export function withoutOperationBudget<T>(operation: () => Promise<T>): Promise<T> {
  return budgets.exit(operation);
}
