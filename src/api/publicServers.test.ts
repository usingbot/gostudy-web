import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchPublicGuild,
  fetchPublicGuilds,
  PublicServersApiError,
} from './publicServers.js';

test('public gallery request omits credentials and reads the narrow response', async () => {
  const originalFetch = globalThis.fetch;
  let request: {input: string | URL | Request; init?: RequestInit} | null = null;
  globalThis.fetch = async (input, init) => {
    request = {input, init};
    return Response.json({servers: [{slug: 'study-forum'}]});
  };
  try {
    const servers = await fetchPublicGuilds();
    assert.equal(String(request!.input), '/api/servers');
    assert.equal(request!.init?.credentials, 'omit');
    assert.equal(servers[0].slug, 'study-forum');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public detail encodes the slug and preserves a safe status-only error', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({error: 'SERVER_NOT_FOUND'}, {status: 404});
  };
  try {
    await assert.rejects(
      fetchPublicGuild('bad/value'),
      (error: unknown) => error instanceof PublicServersApiError
        && error.status === 404
        && !error.message.includes('SERVER_NOT_FOUND'),
    );
    assert.equal(requests[0], '/api/servers/bad%2Fvalue');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
