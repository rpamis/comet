import type {
  ProjectKnowledgeDashboardSnapshot,
  ProjectKnowledgeDashboardSnapshotOptions,
} from './types.js';

const MAX_SCOPE_LENGTH = 512;
const TOKEN_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function createProjectKnowledgeDashboardSnapshot(
  options: ProjectKnowledgeDashboardSnapshotOptions,
): ProjectKnowledgeDashboardSnapshot {
  const { config } = options;
  if (config.provider !== 'remote') {
    return {
      provider: 'local',
      configured: true,
      retrieval:
        options.language === 'en'
          ? 'Local uses a workspace-isolated section index with bounded ripgrep fallback.'
          : 'Local 使用按工作区隔离的 section 索引与项目外 Record 存储；不会在项目中生成知识文件。',
      diagnostics: [],
    };
  }

  const remote = config.remote;
  const endpoint = safeEndpoint(remote?.endpoint);
  const timeoutMs = remote?.timeout_ms ?? 0;
  const tokenEnv = safeTokenEnv(remote?.token_env);
  const scope = safeScope(remote?.scope);
  const configured =
    endpoint !== null && Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30000;
  const remoteSummary = remote
    ? {
        endpoint: endpoint ?? '',
        ...(tokenEnv === undefined ? {} : { tokenEnv }),
        tokenConfigured:
          tokenEnv === undefined ? true : Boolean(options.env?.[tokenEnv] ?? process.env[tokenEnv]),
        ...(scope === undefined ? {} : { scope }),
        timeoutMs,
      }
    : undefined;

  return {
    provider: 'remote',
    configured,
    ...(remoteSummary === undefined ? {} : { remote: remoteSummary }),
    retrieval:
      options.language === 'en'
        ? 'Remote uses the configured Project Knowledge Provider v1 settings; status reports the latest provider health.'
        : 'Remote 使用已配置的 Project Knowledge Provider v1；状态会显示最近一次 Provider 健康情况。',
    diagnostics: [],
  };
}

function safeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function safeTokenEnv(value: unknown): string | undefined {
  if (typeof value !== 'string' || !TOKEN_ENV_PATTERN.test(value)) return undefined;
  return value;
}

function safeScope(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const scope = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim()
    .slice(0, MAX_SCOPE_LENGTH);
  return scope.length === 0 ? undefined : scope;
}
