import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GuildPublicationValidationError,
  parseDiscordInvite,
  parseGuildId,
  parseGuildPublicationBody,
  parseGuildSlug,
  parseGuildTags,
} from './guild-validation.js';

test('guild IDs and slugs require canonical positive BIGINT and lowercase slug syntax', () => {
  assert.equal(parseGuildId('9223372036854775807'), '9223372036854775807');
  assert.equal(parseGuildSlug('the-study-forum'), 'the-study-forum');
  for (const value of ['0', '-1', '01', '9223372036854775808', 123]) {
    assert.throws(() => parseGuildId(value), GuildPublicationValidationError);
  }
  for (const value of ['The-Study', '-study', 'study-', 'study--forum', 'ab', 'a'.repeat(65)]) {
    assert.throws(() => parseGuildSlug(value), GuildPublicationValidationError);
  }
});

test('Discord invite parsing accepts only canonical hosts and persists only the code', () => {
  assert.equal(parseDiscordInvite('https://discord.gg/AbC-123'), 'AbC-123');
  assert.equal(parseDiscordInvite('https://discord.com/invite/example'), 'example');
  assert.equal(parseDiscordInvite(''), null);
  assert.equal(parseDiscordInvite(null), null);
  for (const value of [
    'http://discord.gg/example',
    'https://evil.example/discord.gg/example',
    'https://discord.gg@example.com/example',
    'https://discord.gg/example?redirect=evil',
    'https://discord.gg/example#fragment',
    'javascript:alert(1)',
    'data:text/plain,example',
    ' https://discord.gg/example',
  ]) {
    assert.throws(() => parseDiscordInvite(value), GuildPublicationValidationError);
  }
});

test('tags are trimmed display text, capped at five, and unique case-insensitively', () => {
  assert.deepEqual(parseGuildTags([' Study ', 'SAT', 'Việt Nam']), ['Study', 'SAT', 'Việt Nam']);
  assert.deepEqual(parseGuildTags([]), []);
  assert.throws(() => parseGuildTags(['Study', 'study']), /unique/);
  assert.throws(() => parseGuildTags(['a', 'b', 'c', 'd', 'e', 'f']), /at most five/);
  assert.throws(() => parseGuildTags(['']), /visible/);
  assert.throws(() => parseGuildTags(['a'.repeat(25)]), /visible/);
  assert.throws(() => parseGuildTags(['bad\nvalue']), /visible/);
  assert.throws(() => parseGuildTags(['zero\u200bwidth']), /visible/);
});

test('publication bodies reject unknown or missing JSON fields', () => {
  assert.deepEqual(parseGuildPublicationBody({
    slug: 'study-forum',
    isPublic: true,
    invite: 'https://discord.gg/example',
    tags: ['Study'],
  }), {
    slug: 'study-forum',
    isPublic: true,
    inviteCode: 'example',
    tags: ['Study'],
  });
  assert.throws(() => parseGuildPublicationBody({
    slug: 'study-forum', isPublic: true, invite: null, tags: [], guildid: '1',
  }), GuildPublicationValidationError);
  assert.throws(() => parseGuildPublicationBody({
    slug: 'study-forum', isPublic: true, invite: null,
  }), GuildPublicationValidationError);
});
