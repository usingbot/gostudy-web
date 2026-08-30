import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDiscordAuthorizationUrl,
  exchangeCodeForDiscordUser,
  hasDiscordGuildManagementPermission,
} from './discord.js';

const config = {
  discordClientId: '123456789',
  discordClientSecret: 'server-secret',
  discordRedirectUri: 'http://localhost:3000/auth/discord/callback',
};

test('Discord authorization requests identify and guilds scopes', () => {
  const url = new URL(createDiscordAuthorizationUrl(config, 'state-value'));
  assert.deepEqual(new Set(url.searchParams.get('scope')?.split(' ')), new Set(['identify', 'guilds']));
  assert.equal(url.searchParams.get('state'), 'state-value');
});

test('Discord owner, Manage Guild, and Administrator permission bits authorize management', () => {
  assert.equal(hasDiscordGuildManagementPermission(true, '0'), true);
  assert.equal(hasDiscordGuildManagementPermission(false, '32'), true);
  assert.equal(hasDiscordGuildManagementPermission(false, '8'), true);
  assert.equal(hasDiscordGuildManagementPermission(false, '40'), true);
  assert.equal(hasDiscordGuildManagementPermission(false, '2048'), false);
  assert.equal(hasDiscordGuildManagementPermission(false, String(1n << 60n)), false);
  assert.equal(hasDiscordGuildManagementPermission(false, 'not-a-number'), false);
});

test('OAuth fetches manageable guilds server-side and returns no token or member list', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{url: string; init?: RequestInit}> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({url, init});
    if (url.endsWith('/oauth2/token')) {
      return Response.json({access_token: 'temporary-oauth-token'});
    }
    if (url.endsWith('/users/@me')) {
      return Response.json({
        id: '100',
        username: 'guild-admin',
        global_name: 'Guild Admin',
        avatar: null,
      });
    }
    if (url.includes('/users/@me/guilds')) {
      return Response.json([
        {id: '201', owner: true, permissions: '0', name: 'Owned', members: [{id: 'x'}]},
        {id: '202', owner: false, permissions: '32', name: 'Managed'},
        {id: '203', owner: false, permissions: '8', name: 'Administered'},
        {id: '204', owner: false, permissions: '0', name: 'Ordinary'},
      ]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await exchangeCodeForDiscordUser(config, 'oauth-code');
    assert.deepEqual(result, {
      user: {
        id: '100',
        username: 'guild-admin',
        globalName: 'Guild Admin',
        avatarHash: null,
      },
      manageableGuildIds: ['201', '202', '203'],
    });
    assert.deepEqual(Object.keys(result).sort(), ['manageableGuildIds', 'user']);
    assert.equal(JSON.stringify(result).includes('temporary-oauth-token'), false);
    assert.equal(JSON.stringify(result).includes('members'), false);
    const guildRequest = requests.find((request) => request.url.includes('/users/@me/guilds'));
    assert(guildRequest);
    assert.equal((guildRequest.init?.headers as Record<string, string>).Authorization, 'Bearer temporary-oauth-token');
    assert.equal(requests.some((request) => request.url.includes('/members')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth rejects a malformed guild permission payload', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) return Response.json({access_token: 'temporary'});
    if (url.endsWith('/users/@me')) {
      return Response.json({id: '100', username: 'user', global_name: null, avatar: null});
    }
    return Response.json([{id: '201', owner: false, permissions: 32}]);
  };
  try {
    await assert.rejects(exchangeCodeForDiscordUser(config, 'code'), /guild list response was invalid/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
