import { parse } from 'smol-toml';

/** Reuse host routing in memory while excluding hooks, plugins, history, and credentials. */
export function codexEvalHost(configText) {
  const config = parse(configText);
  const provider = config.model_provider;
  const args = [];
  const windowsSandbox = config.windows?.sandbox;
  if (windowsSandbox !== undefined) {
    if (!['elevated', 'unelevated', 'mxc'].includes(windowsSandbox))
      throw new Error('Unsupported Windows sandbox implementation');
    args.push('-c', `windows.sandbox=${JSON.stringify(windowsSandbox)}`);
  }
  if (typeof provider === 'string' && provider !== 'openai') {
    if (!/^[A-Za-z0-9_-]+$/u.test(provider)) throw new Error('Unsupported model provider name');
    const settings = config.model_providers?.[provider];
    if (!settings || typeof settings !== 'object')
      throw new Error('Configured model provider is unavailable');
    if (settings.experimental_bearer_token || settings.http_headers || settings.query_params) {
      throw new Error(
        'Eval requires provider credentials in host auth or environment, not static config fields',
      );
    }
    args.push('-c', `model_provider=${JSON.stringify(provider)}`);
    for (const key of [
      'name',
      'base_url',
      'env_key',
      'requires_openai_auth',
      'supports_websockets',
      'wire_api',
    ]) {
      const value = settings[key];
      if (value === undefined) continue;
      if (key === 'base_url') {
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash)
          throw new Error('Eval provider URL must not contain credentials or query parameters');
      }
      if (typeof value !== 'string' && typeof value !== 'boolean')
        throw new Error('Unsupported model provider setting');
      args.push('-c', `model_providers.${provider}.${key}=${JSON.stringify(value)}`);
    }
  }
  return { args, model: typeof config.model === 'string' ? config.model : undefined };
}
