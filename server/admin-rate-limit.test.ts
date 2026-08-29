import assert from 'node:assert/strict';
import test from 'node:test';

import type {NextFunction, Request, Response} from 'express';

import {createActorRateLimiter} from './admin-rate-limit.js';

function invoke(
  middleware: ReturnType<typeof createActorRateLimiter>,
  actor: string,
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
  middleware({} as Request, response, (() => { nextCalled = true; }) as NextFunction);
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
