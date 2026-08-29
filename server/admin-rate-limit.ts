import type {RequestHandler} from 'express';

export interface ActorRateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

interface ActorWindow {
  count: number;
  resetAt: number;
}

export const ADMIN_MUTATION_LIMIT = 30;
export const ADMIN_MUTATION_WINDOW_MS = 10 * 60 * 1000;

export function createActorRateLimiter(
  options: ActorRateLimiterOptions = {},
): RequestHandler {
  const limit = options.limit ?? ADMIN_MUTATION_LIMIT;
  const windowMs = options.windowMs ?? ADMIN_MUTATION_WINDOW_MS;
  const now = options.now ?? Date.now;
  const actorWindows = new Map<string, ActorWindow>();

  return (_request, response, next) => {
    const actorUserId = response.locals.discordUserId;
    if (typeof actorUserId !== 'string') {
      response.sendStatus(401);
      return;
    }

    const timestamp = now();
    const existing = actorWindows.get(actorUserId);
    const current = !existing || existing.resetAt <= timestamp
      ? {count: 0, resetAt: timestamp + windowMs}
      : existing;

    if (current.count >= limit) {
      response.set('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000))));
      response.status(429).json({error: 'RATE_LIMITED'});
      return;
    }

    current.count += 1;
    actorWindows.set(actorUserId, current);

    if (actorWindows.size > 1_000) {
      for (const [userId, window] of actorWindows) {
        if (window.resetAt <= timestamp) {
          actorWindows.delete(userId);
        }
      }
    }
    next();
  };
}
