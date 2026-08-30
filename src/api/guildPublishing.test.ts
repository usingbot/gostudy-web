import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchManageableGuilds,
  GuildPublishingApiError,
  saveGuildPublication,
} from './guildPublishing.js';

test('manageable guild list uses same-origin authenticated JSON request', async () => {
  const originalFetch = globalThis.fetch;
  let request: {input: string | URL | Request; init?: RequestInit} | null = null;
  globalThis.fetch = async (input, init) => {
    request = {input, init};
    return Response.json({guilds: [], authorizationRefresh: 'next-login'});
  };
  try {
    await fetchManageableGuilds();
    assert.equal(String(request!.input), '/api/admin/servers');
    assert.equal(request!.init?.credentials, 'same-origin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publication save sends strict fields and no actor or OAuth authorization claims', async () => {
  const originalFetch = globalThis.fetch;
  let request: {input: string | URL | Request; init?: RequestInit} | null = null;
  globalThis.fetch = async (input, init) => {
    request = {input, init};
    return Response.json({guild: {guildid: '500'}});
  };
  const body = {
    slug: 'study-forum',
    isPublic: true,
    invite: 'https://discord.gg/example',
    tags: ['Study'],
  };
  try {
    await saveGuildPublication('500', body);
    assert.equal(String(request!.input), '/api/admin/servers/500');
    assert.equal(request!.init?.method, 'PUT');
    assert.equal(request!.init?.body, JSON.stringify(body));
    assert.deepEqual(Object.keys(JSON.parse(String(request!.init?.body))).sort(), ['invite', 'isPublic', 'slug', 'tags']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Guild Publishing API preserves safe server conflict codes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({error: 'GUILD_SLUG_CONFLICT'}, {status: 409});
  try {
    await assert.rejects(
      saveGuildPublication('500', {slug: 'study-forum', isPublic: false, invite: null, tags: []}),
      (error: unknown) => error instanceof GuildPublishingApiError
        && error.status === 409
        && error.code === 'GUILD_SLUG_CONFLICT',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
