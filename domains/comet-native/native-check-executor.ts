import {
  accessSync,
  existsSync,
  promises as fs,
  constants as fsConstants,
  statSync,
} from 'node:fs';
import path from 'node:path';

import { spawnOwnedCommand } from '../../platform/process/owned-command.js';
import { observeRuntimeOperation } from '../../platform/process/runtime-performance.js';
import {
  assertSafeWindowsBatchArguments,
  resolveWindowsCommand,
} from '../../platform/process/spawn-command.js';
import { terminateProcessTreeConfirmed } from '../../platform/process/terminate-process-tree.js';
import { redactNativeCredentialText } from './native-redaction.js';

/** 不确定的停止不能当作普通失败清除登记或允许重试。 */
export class NativeCheckTerminationUnconfirmedError extends Error {
  constructor(
    readonly diagnostics?: {
      timeoutMs: number;
      timedOut: boolean;
      commandStarted: boolean;
      resultReceived: boolean;
      commandExitCode: number | null;
      supervisorError: string | null;
    },
    options?: ErrorOptions,
  ) {
    super(
      '检查进程树的停止尚未确认；保留原执行登记，不能验收或重试' +
        (diagnostics
          ? `；计划时限=${diagnostics.timeoutMs}ms，命令超时=${diagnostics.timedOut ? '是' : '否'}，命令完成回报=${diagnostics.resultReceived ? `已收到（退出码 ${diagnostics.commandExitCode}）` : '未收到'}${diagnostics.supervisorError ? `，监管器错误=${diagnostics.supervisorError}` : ''}`
          : ''),
      options,
    );
    this.name = 'NativeCheckTerminationUnconfirmedError';
  }
}

export function isNativeCheckTerminationUnconfirmedError(error: unknown): boolean {
  return error instanceof NativeCheckTerminationUnconfirmedError;
}

/** 本次命令实例；恢复不依赖历史 PID 或进程创建时间。 */
export interface NativeCheckInstance {
  instanceId: string;
}

export interface NativeCheckPlan {
  id: string;
  name: string;
  executable: string;
  argv: string[];
  cwdRef: string;
  timeoutMs: number;
  repeatable: boolean;
  /** Agent 判断原命令结果仍适用于当前实现时允许复用。 */
  reusable?: boolean;
  /** 项目相对的测试产物路径；已跟踪文件仍参与输入核对。 */
  outputs?: string[];
}

export function normalizeNativeCheckOutputs(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (ref) =>
        typeof ref !== 'string' ||
        !ref ||
        /[\0:*?"<>|[\]{}]/u.test(ref) ||
        ref.startsWith('~') ||
        ref.includes('\\') ||
        path.posix.isAbsolute(ref) ||
        path.posix.normalize(ref) !== ref ||
        ref.split('/').some((part) => ['..', '.git', '.comet'].includes(part)) ||
        !ref
          .split('/')
          .slice(0, -1)
          .some((part) =>
            [
              'build',
              'dist',
              'gen',
              'generated',
              'out',
              'target',
              '.next',
              '.nuxt',
              '.output',
              '.svelte-kit',
            ].includes(part),
          ),
    )
  )
    throw new Error(
      'Native check outputs must name normalized project-relative paths inside a generated output directory',
    );
  return [...new Set(value as string[])].sort();
}

export interface NativeExecutedCheck {
  id: string;
  name: string;
  argvDisplay: string[];
  cwdRef: string;
  status: 'passed' | 'failed' | 'interrupted';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  repeatable: boolean;
  logRef: string;
}

function inside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function resolveNativeCheckCwd(projectRoot: string, cwdRef: string): string {
  if (
    cwdRef.length === 0 ||
    cwdRef.includes('\\') ||
    path.posix.isAbsolute(cwdRef) ||
    /^(?:[A-Za-z]:|~)/u.test(cwdRef) ||
    cwdRef.split('/').includes('..') ||
    path.posix.normalize(cwdRef) !== cwdRef
  ) {
    throw new Error('Native check cwd must be a normalized project-relative ref');
  }
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, ...cwdRef.split('/'));
  if (!inside(root, target)) throw new Error('Native check cwd escaped the project root');
  let targetStat: ReturnType<typeof statSync>;
  try {
    targetStat = statSync(target);
  } catch (error) {
    throw new Error(`Native check cwd does not exist: ${cwdRef}`, { cause: error });
  }
  if (!targetStat.isDirectory()) {
    throw new Error(`Native check cwd is not a directory: ${cwdRef}`);
  }
  return target;
}

export function nativeCheckPlanKey(plan: NativeCheckPlan): string {
  return JSON.stringify([
    plan.executable,
    plan.argv,
    plan.cwdRef.replaceAll('\\', '/'),
    plan.timeoutMs,
    plan.repeatable,
    ...(plan.outputs?.length ? [plan.outputs] : []),
  ]);
}

/** 命令和工作目录定义同一次副作用；改 ID、超时或重试标记不能重复单次操作。 */
export function nativeCheckInvocationKey(plan: NativeCheckPlan): string {
  return JSON.stringify([plan.executable, plan.argv, plan.cwdRef.replaceAll('\\', '/')]);
}

function executableCandidates(executable: string, cwd: string): string[] {
  if (path.isAbsolute(executable) || /[\\/]/u.test(executable)) {
    return [path.resolve(cwd, executable)];
  }
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((directory) => directory.trim().replace(/^"(.*)"$/u, '$1'))
    .filter(Boolean)
    .map((directory) => path.join(directory, executable));
}

function assertExecutableAvailable(executable: string, cwd: string): void {
  if (process.platform === 'win32') {
    const resolved = resolveWindowsCommand(executable, process.env, cwd);
    const candidate = path.win32.isAbsolute(resolved)
      ? resolved
      : executableCandidates(executable, cwd).find((entry) => existsSync(entry));
    if (!candidate || !existsSync(candidate)) {
      throw new Error(`executable is not available: ${executable}`);
    }
    if (['.bat', '.cmd'].includes(path.win32.extname(candidate).toLowerCase())) {
      // spawnCommand uses a PowerShell shim for batch files; validate its
      // arguments at reservation time so an invalid plan cannot be persisted.
      return;
    }
    return;
  }
  const candidate = executableCandidates(executable, cwd).find((entry) => existsSync(entry));
  if (!candidate) throw new Error(`executable is not available: ${executable}`);
  try {
    accessSync(candidate, fsConstants.X_OK);
  } catch (error) {
    throw new Error(`executable is not executable: ${executable}`, { cause: error });
  }
}

/** Validate every plan before the Runtime creates durable execution state. */
export function preflightNativeCheckPlans(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
): void {
  const seenIds = new Set<string>();
  plans.forEach((plan, index) => {
    if (seenIds.has(plan.id)) {
      throw new Error(`Native check plan duplicate ID ${plan.id} at /checks/${index}/id`);
    }
    seenIds.add(plan.id);
    let cwd: string;
    try {
      cwd = validateNativeCheckPlan(projectRoot, plan);
      if (process.platform === 'win32') {
        const resolved = resolveWindowsCommand(plan.executable, process.env, cwd);
        const extension = path.win32.extname(resolved).toLowerCase();
        if (extension === '.bat' || extension === '.cmd') {
          assertSafeWindowsBatchArguments(plan.argv);
        }
      }
      assertExecutableAvailable(plan.executable, cwd);
    } catch (error) {
      throw new Error(
        `Native check ${plan.id} is invalid at /checks/${index}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  });
}

const SENSITIVE_VALUE_FLAG =
  /^(?:-p|-u|--(?:[a-z0-9]+[-_])*(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|secret(?:[-_]?access)?[-_]?key|private[-_]?key|token|password|passwd|secret|authorization|cookie|set[-_]?cookie|user))$/iu;

export function nativePortableArgvDisplay(argv: readonly string[]): string[] {
  let redactNext = false;
  return argv.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return '[REDACTED]';
    }
    const redacted = redactNativeCredentialText(argument);
    if (SENSITIVE_VALUE_FLAG.test(argument)) redactNext = true;
    return redacted;
  });
}

export function validateNativeCheckPlan(projectRoot: string, plan: NativeCheckPlan): string {
  safeSegment(plan.id, 'Native check ID');
  if (plan.name.trim().length === 0 || plan.executable.trim().length === 0) {
    throw new Error('Native check name and executable must be non-empty');
  }
  if (!Number.isSafeInteger(plan.timeoutMs) || plan.timeoutMs < 1) {
    throw new Error('Native check timeout must be a positive integer');
  }
  return resolveNativeCheckCwd(projectRoot, plan.cwdRef);
}

async function executeNativeCheckOperation(options: {
  projectRoot: string;
  runtimeDir: string;
  operationId: string;
  plan: NativeCheckPlan;
  now?: () => Date;
  signal?: AbortSignal;
  onSpawn?: (child: NativeCheckInstance & { signal: AbortSignal }) => Promise<void>;
  onTerminated?: (child: NativeCheckInstance, confirmed: boolean) => Promise<void>;
}): Promise<NativeExecutedCheck> {
  const { plan } = options;
  safeSegment(options.operationId, 'Native check operation ID');
  const cwd = validateNativeCheckPlan(options.projectRoot, plan);
  const logDirectory = path.join(options.runtimeDir, 'logs', 'checks');
  const logFile = path.join(logDirectory, `${options.operationId}-${plan.id}.log`);
  if (!inside(path.resolve(options.runtimeDir), path.resolve(logFile))) {
    throw new Error('Native check log path escaped the Runtime root');
  }
  await fs.mkdir(logDirectory, { recursive: true });
  const logHandle = await fs.open(logFile, 'wx');
  const stream = logHandle.createWriteStream();
  const started = (options.now ?? (() => new Date()))();

  return new Promise<NativeExecutedCheck>((resolve, reject) => {
    let child;
    let start: () => void;
    let ready: Promise<void>;
    let instanceId: string;
    try {
      ({ child, start, ready, instanceId } = spawnOwnedCommand(plan.executable, plan.argv, {
        cwd,
        env: process.env,
        timeoutMs: plan.timeoutMs,
        confirmTermination: true,
      }));
    } catch (error) {
      stream.destroy();
      reject(error);
      return;
    }

    let timedOut = false;
    let supervisorInterrupted = false;
    let supervisorResult: { exitCode: number | null; signal: NodeJS.Signals | null } | null = null;
    let instance: NativeCheckInstance | undefined;
    let termination: Promise<boolean> | undefined;
    let terminationCause: unknown;
    let pipeCloseDeadline: NodeJS.Timeout | undefined;
    const stop = () => {
      termination ??= terminateProcessTreeConfirmed(child)
        .catch((error: unknown) => {
          terminationCause = error;
          try {
            child.kill('SIGKILL');
          } catch {
            /* 保留无法确认的停止状态。 */
          }
          return false;
        })
        .then((confirmed) => {
          if (confirmed && !closed) {
            // 系统已确认整树停止；继承的管道句柄不能无限延长检查的结束等待。
            pipeCloseDeadline = setTimeout(() => {
              if (closed) return;
              supervisorInterrupted = true;
              supervisorResult = null;
              child.stdout.unpipe(stream);
              child.stderr.unpipe(stream);
              child.stdout.destroy();
              child.stderr.destroy();
              finishCheck(null, 'SIGKILL');
            }, 1000);
          }
          if (!confirmed) {
            // 兜底 kill 可能没有 close 事件；停止无法证明时不能永远等待继承的句柄。
            void registration.then(() => {
              clearTimeout(timer);
              stream.destroy();
              reject(terminationError());
            });
          }
          return confirmed;
        });
      return termination;
    };
    let spawnError: Error | null = null;
    let registrationError: unknown = null;
    let registration = Promise.resolve();
    let registrationSettled = false;
    let commandStarted = false;
    const terminationError = () =>
      new NativeCheckTerminationUnconfirmedError(
        {
          timeoutMs: plan.timeoutMs,
          timedOut,
          commandStarted,
          resultReceived: supervisorResult !== null,
          commandExitCode: supervisorResult?.exitCode ?? null,
          supervisorError: spawnError ? redactNativeCredentialText(spawnError.message) : null,
        },
        { cause: terminationCause },
      );
    const registrationController = new AbortController();
    let cancelRegistration: ((error: Error) => void) | undefined;
    const registrationDeadline = new Promise<never>((_resolve, rejectDeadline) => {
      cancelRegistration = rejectDeadline;
    });
    void registrationDeadline.catch(() => {});
    let closed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!registrationSettled) registrationController.abort();
      if (!registrationSettled)
        cancelRegistration?.(new Error('检查进程登记超过执行时限；未放行的命令不会启动'));
      void stop();
    }, plan.timeoutMs);
    timer.unref?.();

    child.on(
      'message',
      (message: {
        type?: string;
        reason?: string;
        message?: string;
        exitCode?: number | null;
        signal?: NodeJS.Signals | null;
      }) => {
        if (message.type === 'completed')
          supervisorResult = { exitCode: message.exitCode ?? null, signal: message.signal ?? null };
        if (message.type === 'interrupted') {
          supervisorInterrupted = true;
          if (message.reason === 'timeout') timedOut = true;
        }
        if (message.type === 'spawn-error') {
          spawnError = new Error(message.message ?? '检查启动失败');
          const text = `\n[comet] failed to start check: ${redactNativeCredentialText(spawnError.message)}\n`;
          stream.write(text);
        }
        if (
          commandStarted &&
          ['completed', 'interrupted', 'spawn-error'].includes(message.type ?? '')
        )
          clearTimeout(timer);
        // Windows 的 opt-in 监管器等 owner 执行 taskkill /T，再退出。
        // POSIX 监管器自行终止进程组，close 后仍核验整个进程组。
        if (['completed', 'interrupted', 'spawn-error'].includes(message.type ?? '')) void stop();
      },
    );
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    // These listeners observe the same event order as the log stream writes.
    // Outcome validation must still hash the finished file before committing it.
    child.once('error', (error) => {
      spawnError = error;
      const message = `\n[comet] failed to start check: ${redactNativeCredentialText(error.message)}\n`;
      stream.write(message);
      if (!commandStarted && !registrationSettled) {
        registrationController.abort();
        cancelRegistration?.(error);
      }
      if (child.pid !== undefined) void stop();
    });
    const processStopped = async () => !child.pid || (termination ? await termination : false);
    const finishCheck = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (closed) return;
      closed = true;
      clearTimeout(pipeCloseDeadline);
      options.signal?.removeEventListener('abort', onAbort);
      if (registrationSettled) clearTimeout(timer);
      const completed = (options.now ?? (() => new Date()))();
      void registration
        .then(async () => {
          clearTimeout(timer);
          if (supervisorResult) {
            exitCode = supervisorResult.exitCode;
            signal = supervisorResult.signal;
          }
          const confirmed = await processStopped();
          if (instance) await options.onTerminated?.(instance, confirmed);
          if (!confirmed) {
            stream.destroy();
            reject(terminationError());
            return;
          }
          if (registrationError !== null) {
            stream.destroy();
            reject(registrationError);
            return;
          }
          stream.end(() => {
            const interrupted =
              supervisorInterrupted || timedOut || spawnError !== null || signal !== null;
            resolve({
              id: plan.id,
              name: plan.name,
              argvDisplay: nativePortableArgvDisplay(plan.argv),
              cwdRef: plan.cwdRef,
              status: interrupted ? 'interrupted' : exitCode === 0 ? 'passed' : 'failed',
              exitCode,
              signal,
              timedOut,
              durationMs: Math.max(0, completed.getTime() - started.getTime()),
              startedAt: started.toISOString(),
              completedAt: completed.toISOString(),
              repeatable: plan.repeatable,
              logRef: path.relative(options.runtimeDir, logFile).split(path.sep).join('/'),
            });
          });
        })
        .catch((error) => {
          stream.destroy();
          reject(error);
        });
    };
    child.once('close', finishCheck);
    stream.once('error', (error) => {
      registrationError ??= error;
      if (!registrationSettled) {
        registrationController.abort();
        cancelRegistration?.(error);
      }
      if (closed) {
        // close 可能早于 taskkill 的结果；日志错误不能抢先清除尚未确认停止的登记。
        void registration
          .then(async () => {
            reject((await processStopped()) ? registrationError : terminationError());
          })
          .catch(reject);
      } else void stop();
      // The close listener rejects only once the process is gone and any pending
      // registration has settled, even though this log stream is already destroyed.
    });
    const onAbort = () => {
      supervisorInterrupted = true;
      registrationController.abort();
      if (!registrationSettled) cancelRegistration?.(new Error('原检查已请求停止'));
      void stop();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    // Register after all lifecycle listeners are installed. A fast child can close
    // while its identity is being persisted; a failed registration must not orphan it.
    if (child.pid !== undefined) {
      registration = Promise.race([
        Promise.resolve().then(async () => {
          await ready;
          registrationController.signal.throwIfAborted();
          instance = { instanceId };
          await options.onSpawn?.({ ...instance, signal: registrationController.signal });
        }),
        registrationDeadline,
      ])
        .then(() => {
          if (!closed && registrationError === null) {
            commandStarted = true;
            start();
          }
        })
        .catch(async (error) => {
          registrationError = error;
          if (child.exitCode === null && child.signalCode === null) await stop();
        })
        .finally(() => {
          registrationSettled = true;
          if (closed) clearTimeout(timer);
        });
    }
  });
}

export function executeNativeCheck(
  options: Parameters<typeof executeNativeCheckOperation>[0],
): ReturnType<typeof executeNativeCheckOperation> {
  return observeRuntimeOperation(
    {
      projectRoot: () => options.projectRoot,
      workflow: 'native',
      kind: 'check',
      command: 'check',
      traceName: options.plan.name,
      exitCode: (result) => (result.status === 'passed' ? 0 : result.exitCode || 1),
    },
    () => executeNativeCheckOperation(options),
  );
}
