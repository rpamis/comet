export type BoundedHttpRequestErrorCode = 'request-failed' | 'response-too-large' | 'timeout';

export class BoundedHttpRequestError extends Error {
  public readonly code: BoundedHttpRequestErrorCode;

  public constructor(code: BoundedHttpRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BoundedHttpRequestError';
    this.code = code;
  }
}

export interface BoundedHttpRequestOptions {
  readonly url: string;
  readonly init: Omit<RequestInit, 'signal'>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface BoundedHttpResponse {
  readonly response: Response;
  readonly bytes: Uint8Array;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new BoundedHttpRequestError('response-too-large', 'HTTP response exceeds byte limit');
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BoundedHttpRequestError('response-too-large', 'HTTP response exceeds byte limit');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function runBoundedHttpRequest(
  options: BoundedHttpRequestOptions,
): Promise<BoundedHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(options.url, {
      ...options.init,
      signal: controller.signal,
    });
    const bytes = response.ok
      ? await readBoundedResponse(response, options.maxResponseBytes)
      : new Uint8Array();
    return { response, bytes };
  } catch (error) {
    if (error instanceof BoundedHttpRequestError) throw error;
    if (controller.signal.aborted) {
      throw new BoundedHttpRequestError('timeout', 'HTTP request timed out', { cause: error });
    }
    throw new BoundedHttpRequestError('request-failed', 'HTTP request failed', { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
