import {randomBytes, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import connectPgSimple from 'connect-pg-simple';
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import session from 'express-session';
import helmet from 'helmet';
import type {Pool} from 'pg';

import type {AppConfig} from './config.js';
import {createDiscordAuthorizationUrl, exchangeCodeForDiscordUser} from './discord.js';
import {
  getCatalog,
  getDashboardData,
  getInventoryPage,
  PaginationValidationError,
  parseInventoryPagination,
} from './product-data.js';

const SESSION_COOKIE_NAME = 'gostudy.sid';
const DEFAULT_RETURN_TO = '/dashboard';
const ALLOWED_RETURN_TO = new Set(['/dashboard', '/inventory', '/settings'] as const);

type AllowedReturnTo = '/dashboard' | '/inventory' | '/settings';

export interface CreateAppOptions {
  sessionStore?: session.Store;
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => error ? reject(error) : resolve());
  });
}

function readReturnTo(value: unknown): AllowedReturnTo {
  if (value === undefined) {
    return DEFAULT_RETURN_TO;
  }
  if (typeof value !== 'string' || !ALLOWED_RETURN_TO.has(value as AllowedReturnTo)) {
    throw new Error('Invalid returnTo path');
  }
  return value as AllowedReturnTo;
}

function statesMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function readAuthenticatedUserId(request: Request, response: Response): string | null {
  const discordUserId = request.session.discordUserId;
  if (typeof discordUserId !== 'string' || !/^\d+$/.test(discordUserId)) {
    response.sendStatus(401);
    return null;
  }
  return discordUserId;
}

export function createApp(
  config: AppConfig,
  pool: Pool,
  options: CreateAppOptions = {},
): express.Express {
  const app = express();
  const PgSessionStore = connectPgSimple(session);
  const secureCookie = config.nodeEnv === 'production';

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
      },
    },
  }));
  const sessionStore = options.sessionStore ?? new PgSessionStore({
    pool,
    schemaName: 'public',
    tableName: 'web_sessions',
    createTableIfMissing: false,
    ttl: config.sessionTtlSeconds,
    errorLog: () => console.error('Session store operation failed'),
  });
  const sessionMiddleware = session({
    name: SESSION_COOKIE_NAME,
    store: sessionStore,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
      path: '/',
      maxAge: config.sessionTtlSeconds * 1000,
    },
  });
  app.use(['/api', '/auth'], sessionMiddleware);

  app.get('/auth/discord', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store');
    let returnTo: AllowedReturnTo;
    try {
      returnTo = readReturnTo(request.query.returnTo);
    } catch {
      response.status(400).send('Invalid returnTo path');
      return;
    }

    const state = randomBytes(32).toString('base64url');
    request.session.oauthState = state;
    request.session.oauthReturnTo = returnTo;
    await saveSession(request);

    response.redirect(createDiscordAuthorizationUrl(config, state));
  }));

  app.get('/auth/discord/callback', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const receivedState = request.query.state;
    const code = request.query.code;
    const expectedState = request.session.oauthState;
    const returnTo = request.session.oauthReturnTo ?? DEFAULT_RETURN_TO;

    delete request.session.oauthState;
    delete request.session.oauthReturnTo;

    if (typeof receivedState !== 'string'
      || typeof expectedState !== 'string'
      || !statesMatch(receivedState, expectedState)) {
      await saveSession(request);
      response.status(400).send('Invalid OAuth state');
      return;
    }
    if (typeof code !== 'string' || code.length === 0) {
      await saveSession(request);
      response.status(400).send('Missing OAuth authorization code');
      return;
    }

    const discordUser = await exchangeCodeForDiscordUser(config, code);

    await regenerateSession(request);
    request.session.discordUserId = discordUser.id;
    request.session.username = discordUser.username;
    request.session.globalName = discordUser.globalName;
    request.session.avatarHash = discordUser.avatarHash;
    await saveSession(request);

    response.redirect(returnTo);
  }));

  app.get('/api/me', (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (typeof request.session.discordUserId !== 'string'
      || typeof request.session.username !== 'string') {
      response.sendStatus(401);
      return;
    }

    response.json({
      id: request.session.discordUserId,
      username: request.session.username,
      globalName: request.session.globalName ?? null,
      avatarHash: request.session.avatarHash ?? null,
    });
  });

  app.get('/api/dashboard', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store');
    const discordUserId = readAuthenticatedUserId(request, response);
    if (!discordUserId) {
      return;
    }
    response.json(await getDashboardData(pool, discordUserId));
  }));

  app.get('/api/inventory', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store');
    const discordUserId = readAuthenticatedUserId(request, response);
    if (!discordUserId) {
      return;
    }

    try {
      const pagination = parseInventoryPagination(request.query);
      response.json(await getInventoryPage(pool, discordUserId, pagination));
    } catch (error) {
      if (error instanceof PaginationValidationError) {
        response.status(400).json({error: 'Invalid inventory pagination'});
        return;
      }
      throw error;
    }
  }));

  app.get('/api/catalog', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'private, no-store');
    if (!readAuthenticatedUserId(request, response)) {
      return;
    }
    response.json(await getCatalog(pool));
  }));

  app.post('/api/logout', asyncHandler(async (request, response) => {
    response.set('Cache-Control', 'no-store');
    await destroySession(request);
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
      path: '/',
    });
    response.json({success: true});
  }));

  app.use(['/api', '/auth'], (_request, response) => {
    response.sendStatus(404);
  });

  if (config.nodeEnv === 'production') {
    const frontendDirectory = fileURLToPath(new URL('../dist', import.meta.url));
    const indexFile = fileURLToPath(new URL('../dist/index.html', import.meta.url));
    app.use(express.static(frontendDirectory));
    app.get('*', (_request, response) => {
      response.sendFile(indexFile);
    });
  }

  const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    console.error(`Request failed: ${request.method} ${request.path}`);
    response.status(500).json({error: 'Internal server error'});
  };
  app.use(errorHandler);

  return app;
}
