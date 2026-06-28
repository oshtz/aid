import { createReadStream, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

export interface RunningServer {
  origin: string;
  close: () => Promise<void>;
}

export interface FakeProviderChatMessage {
  role?: string;
  content?: unknown;
}

export interface FakeProviderChatRequest {
  messages?: FakeProviderChatMessage[];
  [key: string]: unknown;
}

export interface FakeProviderServer extends RunningServer {
  chatRequests: FakeProviderChatRequest[];
  queueChatResponse: (response: FakeChatResponse) => void;
  waitForChatRequest: () => Promise<FakeProviderChatRequest>;
  waitForChatRequestAt: (index: number) => Promise<FakeProviderChatRequest>;
}

export type FakeChatResponse =
  | {
      kind: 'stream';
      content?: string;
      chunks?: string[];
      chunkDelayMs?: number;
      finishDelayMs?: number;
    }
  | {
      kind: 'error';
      status?: number;
      statusText?: string;
      body?: unknown;
    };

interface PendingRequestWaiter {
  index: number;
  resolve: (request: FakeProviderChatRequest) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const listen = (
  server: Server,
  options: { port?: number; host?: string } = {}
): Promise<number> => new Promise((resolveListen, rejectListen) => {
  const onError = (error: Error) => {
    rejectListen(error);
  };

  server.once('error', onError);
  server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
    server.off('error', onError);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    resolveListen(address.port);
  });
});

const closeServer = (server: Server): Promise<void> => new Promise((resolveClose, reject) => {
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }

    resolveClose();
  });
});

const contentTypeFor = (filePath: string): string => {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
};

export const createStaticFixtureServer = async (rootDir: string): Promise<RunningServer> => {
  const resolvedRoot = resolve(rootDir);
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const requestedPath = url.pathname === '/' ? '/x-timeline.html' : url.pathname;
    const normalizedPath = normalize(decodeURIComponent(requestedPath))
      .replace(/^[/\\]+/, '')
      .replace(/^(\.\.[/\\])+/, '');
    const filePath = resolve(join(resolvedRoot, normalizedPath));

    if (!filePath.startsWith(`${resolvedRoot}${sep}`) && filePath !== resolvedRoot) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    if (!existsSync(filePath)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': contentTypeFor(filePath),
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  });

  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  };
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const writeCorsHeaders = (response: ServerResponse, contentType: string) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type, authorization');
  response.setHeader('content-type', contentType);
};

const delay = (ms: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const writeStreamChunk = (
  response: ServerResponse,
  content: string,
  finishReason: string | null = null
) => {
  response.write(`data: ${JSON.stringify({
    id: 'aid-e2e',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'llava',
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  })}\n\n`);
};

const writeFakeChatResponse = async (
  response: ServerResponse,
  fakeResponse: FakeChatResponse
) => {
  if (fakeResponse.kind === 'error') {
    writeCorsHeaders(response, 'application/json; charset=utf-8');
    response.writeHead(fakeResponse.status ?? 500, fakeResponse.statusText);
    response.end(JSON.stringify(fakeResponse.body ?? { error: 'Fake provider failure' }));
    return;
  }

  const chunks = fakeResponse.chunks || [fakeResponse.content || 'Top posts: Ray Wang, Bybit, monokern.'];
  writeCorsHeaders(response, 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-cache');
  response.writeHead(200);

  for (const [index, chunk] of chunks.entries()) {
    if (index > 0 && fakeResponse.chunkDelayMs) {
      await delay(fakeResponse.chunkDelayMs);
    }
    writeStreamChunk(response, chunk);
  }

  if (fakeResponse.finishDelayMs) {
    await delay(fakeResponse.finishDelayMs);
  }
  writeStreamChunk(response, '', 'stop');
  response.write('data: [DONE]\n\n');
  response.end();
};

export const createFakeProviderServer = async (): Promise<FakeProviderServer> => {
  const chatRequests: FakeProviderChatRequest[] = [];
  const pendingWaiters: PendingRequestWaiter[] = [];
  const queuedChatResponses: FakeChatResponse[] = [];

  const flushPendingWaiters = () => {
    for (let index = pendingWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = pendingWaiters[index];
      if (!waiter) {
        continue;
      }

      const requestBody = chatRequests[waiter.index];
      if (!requestBody) {
        continue;
      }

      clearTimeout(waiter.timeout);
      pendingWaiters.splice(index, 1);
      waiter.resolve(requestBody);
    }
  };

  const resolveChatRequest = (request: FakeProviderChatRequest) => {
    chatRequests.push(request);
    flushPendingWaiters();
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (request.method === 'OPTIONS') {
      writeCorsHeaders(response, 'text/plain; charset=utf-8');
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/v1/models') {
      writeCorsHeaders(response, 'application/json; charset=utf-8');
      response.writeHead(200);
      response.end(JSON.stringify({ data: [{ id: 'llava', object: 'model', created: 1, owned_by: 'aid-e2e' }] }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readJsonBody(request) as FakeProviderChatRequest;
      resolveChatRequest(body);

      await writeFakeChatResponse(
        response,
        queuedChatResponses.shift() || { kind: 'stream' }
      );
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  const port = await listen(server, { host: 'localhost' });
  return {
    origin: `http://localhost:${port}`,
    chatRequests,
    queueChatResponse: (response) => {
      queuedChatResponses.push(response);
    },
    waitForChatRequest: () => {
      const latestRequest = chatRequests.at(-1);
      if (latestRequest) {
        return Promise.resolve(latestRequest);
      }

      return new Promise((resolveWait, rejectWait) => {
        const timeout = setTimeout(() => {
          const waiterIndex = pendingWaiters.findIndex((waiter) => waiter.resolve === resolveWait);
          if (waiterIndex !== -1) {
            pendingWaiters.splice(waiterIndex, 1);
          }
          rejectWait(new Error('Timed out waiting for fake provider chat request'));
        }, 10_000);

        pendingWaiters.push({
          index: 0,
          resolve: resolveWait,
          reject: rejectWait,
          timeout,
        });
      });
    },
    waitForChatRequestAt: (index: number) => {
      const requestBody = chatRequests[index];
      if (requestBody) {
        return Promise.resolve(requestBody);
      }

      return new Promise((resolveWait, rejectWait) => {
        const timeout = setTimeout(() => {
          const waiterIndex = pendingWaiters.findIndex((waiter) => waiter.resolve === resolveWait);
          if (waiterIndex !== -1) {
            pendingWaiters.splice(waiterIndex, 1);
          }
          rejectWait(new Error(`Timed out waiting for fake provider chat request ${index}`));
        }, 10_000);

        pendingWaiters.push({
          index,
          resolve: resolveWait,
          reject: rejectWait,
          timeout,
        });
      });
    },
    close: () => closeServer(server),
  };
};
