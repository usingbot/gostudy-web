import type {NextFunction, Request, RequestHandler, Response} from 'express';
import type {Pool, QueryResultRow} from 'pg';

export type UserRole = 'owner' | 'admin' | 'tester' | 'user';

export interface RoleCapabilities {
  accessAdmin: boolean;
  searchUsers: boolean;
  viewChalk: boolean;
  adjustChalk: boolean;
  manageTester: boolean;
  manageAdmin: boolean;
  manageOwner: false;
}

interface RoleRow extends QueryResultRow {
  role: unknown;
}

const NO_ADMIN_CAPABILITIES: RoleCapabilities = Object.freeze({
  accessAdmin: false,
  searchUsers: false,
  viewChalk: false,
  adjustChalk: false,
  manageTester: false,
  manageAdmin: false,
  manageOwner: false,
});

const ADMIN_CAPABILITIES: RoleCapabilities = Object.freeze({
  accessAdmin: true,
  searchUsers: true,
  viewChalk: true,
  adjustChalk: true,
  manageTester: true,
  manageAdmin: false,
  manageOwner: false,
});

const OWNER_CAPABILITIES: RoleCapabilities = Object.freeze({
  ...ADMIN_CAPABILITIES,
  manageAdmin: true,
});

export function isUserRole(value: unknown): value is UserRole {
  return value === 'owner' || value === 'admin' || value === 'tester' || value === 'user';
}

export async function getUserRole(pool: Pool, userId: string): Promise<UserRole> {
  const result = await pool.query<RoleRow>(
    `SELECT role
       FROM public.web_user_roles
      WHERE userid = $1::bigint
      LIMIT 1`,
    [userId],
  );
  if (result.rows.length === 0) {
    return 'user';
  }
  const role = result.rows[0].role;
  if (role !== 'owner' && role !== 'admin' && role !== 'tester') {
    throw new Error('Stored web role was invalid');
  }
  return role;
}

export function getRoleCapabilities(role: UserRole): RoleCapabilities {
  if (role === 'owner') {
    return OWNER_CAPABILITIES;
  }
  if (role === 'admin') {
    return ADMIN_CAPABILITIES;
  }
  return NO_ADMIN_CAPABILITIES;
}

export function requireAdmin(pool: Pool): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const actorUserId = response.locals.discordUserId;
    if (typeof actorUserId !== 'string') {
      response.sendStatus(401);
      return;
    }

    void getUserRole(pool, actorUserId)
      .then((role) => {
        if (!getRoleCapabilities(role).accessAdmin) {
          response.status(403).json({error: 'ADMIN_ACCESS_REQUIRED'});
          return;
        }
        response.locals.userRole = role;
        next();
      })
      .catch(next);
  };
}

export function requireOwner(pool: Pool): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const actorUserId = response.locals.discordUserId;
    if (typeof actorUserId !== 'string') {
      response.sendStatus(401);
      return;
    }

    void getUserRole(pool, actorUserId)
      .then((role) => {
        if (role !== 'owner') {
          response.status(403).json({error: 'OWNER_ACCESS_REQUIRED'});
          return;
        }
        response.locals.userRole = role;
        next();
      })
      .catch(next);
  };
}
