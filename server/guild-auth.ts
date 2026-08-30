import type {Pool, QueryResultRow} from 'pg';

import type {UserRole} from './admin-auth.js';
import {parseGuildId} from './guild-validation.js';

interface ExistsRow extends QueryResultRow {
  exists: unknown;
}

export function readSessionManageableGuildIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = new Set<string>();
  for (const candidate of value) {
    try {
      ids.add(parseGuildId(candidate));
    } catch {
      // Ignore corrupt or obsolete session values instead of trusting them.
    }
  }
  return [...ids];
}

export function mayManageGuild(
  role: UserRole,
  manageableGuildIds: readonly string[],
  guildId: string,
): boolean {
  return role === 'owner' || manageableGuildIds.includes(guildId);
}

export async function hasManageableActiveGuild(
  pool: Pool,
  role: UserRole,
  manageableGuildIds: readonly string[],
): Promise<boolean> {
  const result = await pool.query<ExistsRow>(
    `SELECT EXISTS (
       SELECT 1
         FROM public.gostudy_guilds AS guild
        WHERE guild.active = TRUE
          AND ($1::boolean OR guild.guildid = ANY($2::bigint[]))
     ) AS exists`,
    [role === 'owner', [...manageableGuildIds]],
  );
  return result.rows[0]?.exists === true;
}
