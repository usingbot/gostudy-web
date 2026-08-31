import type {Request, RequestHandler} from 'express';

export interface ActorRateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
  key?: (request: Request, actorUserId: string) => string;
}

interface ActorWindow {
  count: number;
  resetAt: number;
}

export const ADMIN_MUTATION_LIMIT = 30;
export const ADMIN_MUTATION_WINDOW_MS = 10 * 60 * 1000;
export const GUILD_BOARD_INTERACTION_LIMIT = 120;
export const GUILD_BOARD_INTERACTION_WINDOW_MS = 60 * 1000;

const CANONICAL_GUILD_ID = /^[1-9]\d{0,18}$/;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

function guildBoardInteractionKey(request: Request, actorUserId: string): string {
  const guildId = request.params.guildid;
  const canonicalGuildId = typeof guildId === 'string'
    && CANONICAL_GUILD_ID.test(guildId)
    && BigInt(guildId) <= MAX_SIGNED_BIGINT
    ? guildId
    : 'invalid-guild';
  return `${actorUserId}:${canonicalGuildId}`;
}

export function createActorRateLimiter(
  options: ActorRateLimiterOptions = {},
): RequestHandler {
  const limit = options.limit ?? ADMIN_MUTATION_LIMIT;
  const windowMs = options.windowMs ?? ADMIN_MUTATION_WINDOW_MS;
  const now = options.now ?? Date.now;
  const key = options.key ?? ((_request: Request, actorUserId: string) => actorUserId);
  const actorWindows = new Map<string, ActorWindow>();

  return (request, response, next) => {
    const actorUserId = response.locals.discordUserId;
    if (typeof actorUserId !== 'string') {
      response.sendStatus(401);
      return;
    }

    const actorKey = key(request, actorUserId);
    const timestamp = now();
    const existing = actorWindows.get(actorKey);
    const current = !existing || existing.resetAt <= timestamp
      ? {count: 0, resetAt: timestamp + windowMs}
      : existing;

    if (current.count >= limit) {
      response.set('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000))));
      response.status(429).json({error: 'RATE_LIMITED'});
      return;
    }

    current.count += 1;
    actorWindows.set(actorKey, current);

    if (actorWindows.size > 1_000) {
      for (const [windowKey, window] of actorWindows) {
        if (window.resetAt <= timestamp) {
          actorWindows.delete(windowKey);
        }
      }
    }
    next();
  };
}

export function createGuildBoardInteractionRateLimiter(
  options: Omit<ActorRateLimiterOptions, 'key'> = {},
): RequestHandler {
  return createActorRateLimiter({
    ...options,
    limit: options.limit ?? GUILD_BOARD_INTERACTION_LIMIT,
    windowMs: options.windowMs ?? GUILD_BOARD_INTERACTION_WINDOW_MS,
    key: guildBoardInteractionKey,
  });
}
