import assert from 'node:assert/strict';
import test from 'node:test';

import type {NextFunction, Request, RequestHandler, Response} from 'express';

import {
  ADMIN_MUTATION_LIMIT,
  ADMIN_MUTATION_WINDOW_MS,
  createActorRateLimiter,
  createGuildBoardInteractionRateLimiter,
  GUILD_BOARD_INTERACTION_LIMIT,
  GUILD_BOARD_INTERACTION_WINDOW_MS,
} from './admin-rate-limit.js';

function invoke(
  middleware: RequestHandler,
  actor: string,
  guildId = '500',
): {status: number | null; body: unknown; nextCalled: boolean; retryAfter: string | null} {
  let status: number | null = null;
  let body: unknown;
  let nextCalled = false;
  let retryAfter: string | null = null;
  const response = {
    locals: {discordUserId: actor},
    set: (name: string, value: string) => {
      if (name === 'Retry-After') retryAfter = value;
      return response;
    },
    status: (value: number) => {
      status = value;
      return response;
    },
    json: (value: unknown) => {
      body = value;
      return response;
    },
    sendStatus: (value: number) => {
      status = value;
      return response;
    },
  } as unknown as Response;
  middleware(
    {params: {guildid: guildId}} as unknown as Request,
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return {status, body, nextCalled, retryAfter};
}

test('rate limiter counts per authenticated actor and resets by window', () => {
  let timestamp = 1_000;
  const middleware = createActorRateLimiter({limit: 2, windowMs: 10_000, now: () => timestamp});

  assert.equal(invoke(middleware, '1').nextCalled, true);
  assert.equal(invoke(middleware, '1').nextCalled, true);
  const limited = invoke(middleware, '1');
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, {error: 'RATE_LIMITED'});
  assert.equal(limited.retryAfter, '10');

  assert.equal(invoke(middleware, '2').nextCalled, true);
  timestamp += 10_000;
  assert.equal(invoke(middleware, '1').nextCalled, true);
});

test('sensitive admin mutation limiter keeps its stricter existing defaults', () => {
  assert.equal(ADMIN_MUTATION_LIMIT, 30);
  assert.equal(ADMIN_MUTATION_WINDOW_MS, 10 * 60 * 1000);
});

test('board interaction limiter permits sustained gestures then returns safe 429 metadata', () => {
  const middleware = createGuildBoardInteractionRateLimiter({now: () => 1_000});
  assert.equal(GUILD_BOARD_INTERACTION_LIMIT, 120);
  assert.equal(GUILD_BOARD_INTERACTION_WINDOW_MS, 60_000);
  for (let index = 0; index < GUILD_BOARD_INTERACTION_LIMIT; index += 1) {
    assert.equal(invoke(middleware, '100', '500').nextCalled, true);
  }
  const limited = invoke(middleware, '100', '500');
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, {error: 'RATE_LIMITED'});
  assert.equal(limited.retryAfter, '60');
});

test('board interaction quota is independent by authenticated actor and target guild', () => {
  const middleware = createGuildBoardInteractionRateLimiter({
    limit: 1,
    windowMs: 10_000,
    now: () => 1_000,
  });
  assert.equal(invoke(middleware, '100', '500').nextCalled, true);
  assert.equal(invoke(middleware, '100', '500').status, 429);
  assert.equal(invoke(middleware, '100', '501').nextCalled, true);
  assert.equal(invoke(middleware, '101', '500').nextCalled, true);
});

test('malformed guild IDs cannot create unbounded rate-limit keys', () => {
  const middleware = createGuildBoardInteractionRateLimiter({limit: 1});
  assert.equal(invoke(middleware, '100', 'not-a-guild').nextCalled, true);
  assert.equal(invoke(middleware, '100', '9223372036854775808').status, 429);
});
