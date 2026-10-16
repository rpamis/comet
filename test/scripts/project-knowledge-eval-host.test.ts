import { expect, test } from 'vitest';
import { codexEvalHost } from '../../scripts/benchmark/project-knowledge-eval-host.mjs';

test('preserves the configured Windows sandbox implementation for isolated writable runs', () => {
  const host = codexEvalHost('model="configured-model"\n[windows]\nsandbox="elevated"\n');
  expect(host.args).toEqual(['-c', 'windows.sandbox="elevated"']);
  expect(codexEvalHost('model="configured-model"').args).toEqual([]);
  expect(() => codexEvalHost('[windows]\nsandbox="unrecognized"')).toThrow(/sandbox/);
});

test('keeps only nonsecret model routing and excludes user tools from Eval config', () => {
  const host = codexEvalHost(
    'model="configured-model"\nmodel_provider="custom"\n[model_providers.custom]\nname="Custom"\nbase_url="https://example.com/v1"\nwire_api="responses"\nrequires_openai_auth=true\n[mcp_servers.private]\ncommand="private-command"\n',
  );
  expect(host.model).toBe('configured-model');
  expect(host.args.join(' ')).toContain('model_provider="custom"');
  expect(host.args.join(' ')).not.toContain('private-command');
  expect(() =>
    codexEvalHost(
      'model_provider="custom"\n[model_providers.custom]\nexperimental_bearer_token="fixture-secret"',
    ),
  ).toThrow(/credentials/);
  expect(() =>
    codexEvalHost(
      'model_provider="custom"\n[model_providers.custom]\nbase_url="https://example.com/v1?token=fixture-secret"',
    ),
  ).toThrow(/credentials/);
});
