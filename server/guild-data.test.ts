import assert from 'node:assert/strict';
import test from 'node:test';

import type {Pool} from 'pg';

import {
  discordEmojiAssetUrl,
  discordGuildAssetUrl,
  discordStickerAssetUrl,
  getManageableGuilds,
  getPublicGuildBySlug,
  getPublicGuilds,
  upsertGuildPublication,
} from './guild-data.js';

function guildRow(overrides: Record<string, unknown> = {}) {
  return {
    guildid: '123',
    name: 'The Study Forum',
    icon_hash: 'a_abcdef',
    banner_hash: '123abc',
    description: 'Study together',
    member_count: 250,
    active: true,
    slug: 'the-study-forum',
    is_public: true,
    invite_code: 'Example',
    tags: ['Study', 'IELTS'],
    ...overrides,
  };
}

test('Discord assets derive from current guild metadata and animated hashes use GIF', () => {
  assert.equal(
    discordGuildAssetUrl('icons', '123', 'a_abcdef'),
    'https://cdn.discordapp.com/icons/123/a_abcdef.gif?size=128',
  );
  assert.equal(
    discordGuildAssetUrl('banners', '123', 'abcdef'),
    'https://cdn.discordapp.com/banners/123/abcdef.webp?size=1024',
  );
  assert.equal(discordGuildAssetUrl('icons', '123', null), null);
});

test('Discord decoration URLs preserve emoji animation and support only image-renderable sticker formats', () => {
  assert.equal(
    discordEmojiAssetUrl('700', false),
    'https://cdn.discordapp.com/emojis/700.png?size=1024&quality=lossless',
  );
  assert.equal(
    discordEmojiAssetUrl('700', true),
    'https://cdn.discordapp.com/emojis/700.gif?size=1024&quality=lossless',
  );
  assert.equal(discordStickerAssetUrl('800', 1), 'https://cdn.discordapp.com/stickers/800.png?size=320');
  assert.equal(discordStickerAssetUrl('800', 2), 'https://cdn.discordapp.com/stickers/800.png?size=320');
  assert.equal(discordStickerAssetUrl('800', 3), null);
  assert.equal(discordStickerAssetUrl('800', 4), 'https://media.discordapp.net/stickers/800.gif?size=320');
  assert.equal(discordStickerAssetUrl('800', 0), null);
  assert.equal(discordStickerAssetUrl('800', 99), null);
  assert.throws(() => discordEmojiAssetUrl('https://evil.example', false), /emoji ID/);
  assert.throws(() => discordStickerAssetUrl('0', 1), /sticker ID/);
});

test('manageable guild read joins settings and tags while filtering active authorized IDs', async () => {
  let call: {text: string; values?: unknown[]} | null = null;
  const pool = {
    query: async (text: string, values?: unknown[]) => {
      call = {text, values};
      return {rows: [guildRow()], rowCount: 1};
    },
  } as unknown as Pool;
  const guilds = await getManageableGuilds(pool, ['123'], false);
  assert.equal(guilds[0].name, 'The Study Forum');
  assert.deepEqual(guilds[0].publication?.tags, ['Study', 'IELTS']);
  assert.equal(guilds[0].publication?.inviteUrl, 'https://discord.gg/Example');
  assert.match(call!.text, /guild\.active = TRUE/);
  assert.match(call!.text, /web_guild_publications/);
  assert.match(call!.text, /web_guild_tags/);
  assert.deepEqual(call!.values, [false, ['123']]);
});

test('empty Discord descriptions remain valid bot-owned metadata', async () => {
  const pool = {
    query: async () => ({rows: [guildRow({description: ''})], rowCount: 1}),
  } as unknown as Pool;
  const guilds = await getManageableGuilds(pool, ['123'], false);
  assert.equal(guilds[0].description, '');
});

test('publication save calls only the narrow DB function and reloads settings', async () => {
  const calls: Array<{text: string; values?: unknown[]}> = [];
  const pool = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({text, values});
      return text.includes('web_upsert_guild_publication')
        ? {rows: [{}], rowCount: 1}
        : {rows: [guildRow()], rowCount: 1};
    },
  } as unknown as Pool;
  const result = await upsertGuildPublication(pool, '123', '999', {
    slug: 'the-study-forum', isPublic: true, inviteCode: 'Example', tags: ['Study'],
  });
  assert.equal(result?.publication?.slug, 'the-study-forum');
  assert.match(calls[0].text, /^SELECT public\.web_upsert_guild_publication/);
  assert.deepEqual(calls[0].values, ['123', 'the-study-forum', true, 'Example', ['Study'], '999']);
  assert.equal(calls.some((entry) => /UPDATE public\.gostudy_guilds/.test(entry.text)), false);
});

test('public read model includes only public active registry guilds', async () => {
  let sql = '';
  const pool = {
    query: async (text: string) => {
      sql = text;
      return {rows: [guildRow()], rowCount: 1};
    },
  } as unknown as Pool;
  const guilds = await getPublicGuilds(pool);
  assert.equal(guilds[0].slug, 'the-study-forum');
  assert.deepEqual(Object.keys(guilds[0]).sort(), [
    'bannerUrl',
    'description',
    'iconUrl',
    'inviteUrl',
    'memberCount',
    'name',
    'slug',
    'tags',
  ]);
  assert.equal('guildid' in guilds[0], false);
  assert.equal('active' in guilds[0], false);
  assert.equal('publication' in guilds[0], false);
  assert.match(sql, /guild\.active = TRUE/);
  assert.match(sql, /publication\.is_public = TRUE/);
});

test('public detail lookup independently filters by parameterized canonical slug', async () => {
  let call: {text: string; values?: unknown[]} | null = null;
  const pool = {
    query: async (text: string, values?: unknown[]) => {
      call = {text, values};
      return {rows: [guildRow()], rowCount: 1};
    },
  } as unknown as Pool;
  const guild = await getPublicGuildBySlug(pool, 'the-study-forum');
  assert.equal(guild?.name, 'The Study Forum');
  assert.match(call!.text, /guild\.active = TRUE/);
  assert.match(call!.text, /publication\.is_public = TRUE/);
  assert.match(call!.text, /publication\.slug = \$1::text/);
  assert.deepEqual(call!.values, ['the-study-forum']);
  assert.doesNotMatch(call!.text, /SELECT \*/);
});

test('hidden, inactive, and unknown public detail results remain absent', async () => {
  const pool = {
    query: async () => ({rows: [], rowCount: 0}),
  } as unknown as Pool;
  for (const slug of ['hidden-study', 'inactive-study', 'unknown-study']) {
    assert.equal(await getPublicGuildBySlug(pool, slug), null);
  }
});
