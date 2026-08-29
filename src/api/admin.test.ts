import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adjustChalk,
  AdminApiError,
  fetchAdminUser,
  searchAdminUser,
} from './admin.js';

test('admin search is exact-ID only and encodes its query', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{input: string | URL | Request; init?: RequestInit}> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({input, init});
    return Response.json({users: [{userid: '123', identity: null, role: 'user'}]});
  };
  try {
    assert.equal((await searchAdminUser('123')).userid, '123');
    const request = requests[0];
    assert(request);
    assert.equal(String(request.input), '/api/admin/users?query=123');
    assert.equal(request.init?.credentials, 'same-origin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('adjustment sends the caller UUID unchanged in strict JSON', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{input: string | URL | Request; init?: RequestInit}> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({input, init});
    return Response.json({ok: true});
  };
  const body = {
    amount: '10',
    reason: 'Correction',
    requestId: '123e4567-e89b-42d3-a456-426614174000',
  };
  try {
    await adjustChalk('deduct', '9223372036854775807', body);
    const request = requests[0];
    assert(request);
    assert.equal(String(request.input), '/api/admin/users/9223372036854775807/chalk/deduct');
    assert.equal(request.init?.method, 'POST');
    assert.equal(request.init?.body, JSON.stringify(body));
    assert.equal((request.init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('detail pagination uses a bounded limit and encodes its cursor', async () => {
  const originalFetch = globalThis.fetch;
  let path = '';
  globalThis.fetch = async (input) => {
    path = String(input);
    return Response.json({});
  };
  try {
    await fetchAdminUser('42', '900');
    assert.equal(path, '/api/admin/users/42?limit=20&beforeTransactionId=900');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API failures retain status and stable server error code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    {error: 'ROLE_CHANGED'},
    {status: 409},
  );
  try {
    await assert.rejects(
      searchAdminUser('123'),
      (error: unknown) => error instanceof AdminApiError
        && error.status === 409
        && error.code === 'ROLE_CHANGED',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
