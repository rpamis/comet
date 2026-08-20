import { describe, expect, test } from 'vitest';

import {
  BoundedHttpRequestError,
  runBoundedHttpRequest,
} from '../../../platform/http/bounded-request.js';

describe('bounded HTTP request adapter', () => {
  test('returns a successful response within the configured byte bound', async () => {
    const result = await runBoundedHttpRequest({
      url: 'https://example.test/retrieve',
      init: { method: 'POST' },
      timeoutMs: 1000,
      maxResponseBytes: 64,
      fetch: async () => new Response('{"results":[]}'),
    });

    expect(result.response.status).toBe(200);
    expect(new TextDecoder().decode(result.bytes)).toBe('{"results":[]}');
  });

  test('rejects an oversized response inside the platform boundary', async () => {
    await expect(
      runBoundedHttpRequest({
        url: 'https://example.test/retrieve',
        init: { method: 'POST' },
        timeoutMs: 1000,
        maxResponseBytes: 4,
        fetch: async () => new Response('oversized'),
      }),
    ).rejects.toMatchObject<BoundedHttpRequestError>({ code: 'response-too-large' });
  });
});
