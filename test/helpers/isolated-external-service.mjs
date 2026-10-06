import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** 只连接本机隔离服务；认证信息只在请求头和当前进程闭包中存在。 */
export function createExternalFixtureClient(endpoint, credential) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('隔离 fixture 只允许 http://127.0.0.1');
  if (!credential) throw new Error('隔离 fixture 缺少当前进程认证信息');
  async function request(relative, options = {}) {
    const response = await fetch(new URL(relative, url), {
      ...options,
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    });
    if (!response.ok) throw new Error(`隔离服务请求失败：${response.status}`);
    return response.json();
  }
  return {
    execute: (command) =>
      request(`operations/${encodeURIComponent(command.actionId)}`, {
        method: 'POST',
        body: JSON.stringify(command),
      }),
    query: (actionId) => request(`operations/${encodeURIComponent(actionId)}`),
    stats: () => request('stats'),
  };
}

/** 故障只注入首个 POST；drop-after 已执行，drop-before 收到请求但未执行。 */
export async function startIsolatedExternalService({
  credential,
  firstRequestFault = 'none',
} = {}) {
  credential ??= process.env.COMET_EXTERNAL_FIXTURE_TOKEN;
  if (!credential) throw new Error('请在当前进程提供 COMET_EXTERNAL_FIXTURE_TOKEN');
  if (!['none', 'drop-before', 'drop-after'].includes(firstRequestFault))
    throw new Error('未知隔离服务故障模式');
  const serviceId = randomUUID();
  const operations = new Map();
  let executionRequests = 0;
  let executionCount = 0;
  let queryCount = 0;
  let fault = firstRequestFault;
  const server = createServer(async (request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.headers.authorization !== `Bearer ${credential}`) {
      reply(401, { error: 'Unauthorized fixture request' });
      return;
    }
    try {
      if (request.method === 'GET' && request.url === '/stats') {
        reply(200, { serviceId, executionRequests, executionCount, queryCount });
        return;
      }
      const route = request.url?.match(/^\/operations\/([^/]+)$/u);
      if (!route) {
        reply(404, { error: 'Unknown fixture route' });
        return;
      }
      const actionId = decodeURIComponent(route[1]);
      if (request.method === 'GET') {
        queryCount++;
        const outcome = operations.get(actionId);
        reply(
          200,
          outcome
            ? { resolution: 'executed', outcome }
            : {
                resolution: 'not-executed',
                evidence: JSON.stringify({
                  serviceId,
                  actionId,
                  resolution: 'not-executed',
                  executionCount,
                }),
              },
        );
        return;
      }
      if (request.method !== 'POST') {
        reply(405, { error: 'Unsupported fixture method' });
        return;
      }
      let body = '';
      for await (const chunk of request) body += chunk;
      const command = JSON.parse(body);
      if (
        command.actionId !== actionId ||
        !Number.isSafeInteger(command.attempt) ||
        command.attempt < 1 ||
        typeof command.inputHash !== 'string' ||
        typeof command.claimToken !== 'string' ||
        typeof command.topic !== 'string' ||
        Object.keys(command).some(
          (key) => !['actionId', 'attempt', 'inputHash', 'claimToken', 'topic'].includes(key),
        )
      ) {
        reply(400, { error: 'Invalid fixture command' });
        return;
      }
      executionRequests++;
      const requestFault = fault;
      fault = 'none';
      if (requestFault === 'drop-before') {
        response.destroy();
        return;
      }
      if (!operations.has(actionId)) {
        executionCount++;
        operations.set(actionId, {
          actionId,
          attempt: command.attempt,
          inputHash: command.inputHash,
          claimToken: command.claimToken,
          outcomeId: `isolated-service:${serviceId}:${actionId}:${command.attempt}`,
          status: 'succeeded',
          output: { title: `${command.topic} — reviewed` },
        });
      }
      if (requestFault === 'drop-after') {
        response.destroy();
        return;
      }
      reply(200, { resolution: 'executed', outcome: operations.get(actionId) });
    } catch {
      if (!response.destroyed) reply(400, { error: 'Invalid fixture request' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('隔离服务未取得本机端口');
  const endpoint = `http://127.0.0.1:${address.port}/`;
  return {
    endpoint,
    serviceId,
    client: createExternalFixtureClient(endpoint, credential),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

// 模型矩阵可直接启动；stdout 只有地址和服务身份，凭据由调用进程环境提供。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await startIsolatedExternalService({
    firstRequestFault: process.env.COMET_EXTERNAL_FIXTURE_FAULT ?? 'none',
  });
  console.log(JSON.stringify({ endpoint: service.endpoint, serviceId: service.serviceId }));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await service.close();
      process.exit(0);
    });
}
