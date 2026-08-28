import type {Pool, PoolClient, QueryResultRow} from 'pg';

export const MAX_SEEN_REWARD_IDS = 50;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

interface OwnedRewardRow extends QueryResultRow {
  hour_rewardid: string | number;
}

export interface MarkRewardsSeenInput {
  rewardIds: string[];
}

export class RewardSeenValidationError extends Error {}
export class RewardSeenOwnershipError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRewardId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || value.length > 19) {
    throw new RewardSeenValidationError('Reward IDs must be positive decimal strings');
  }
  if (BigInt(value) > MAX_POSTGRES_BIGINT) {
    throw new RewardSeenValidationError('Reward ID is outside the PostgreSQL BIGINT range');
  }
  return value;
}

export function parseMarkRewardsSeenBody(value: unknown): MarkRewardsSeenInput {
  if (!isRecord(value)
    || Object.keys(value).length !== 1
    || !Object.prototype.hasOwnProperty.call(value, 'rewardIds')
    || !Array.isArray(value.rewardIds)) {
    throw new RewardSeenValidationError('Request body must contain only a rewardIds array');
  }
  if (value.rewardIds.length < 1 || value.rewardIds.length > MAX_SEEN_REWARD_IDS) {
    throw new RewardSeenValidationError(
      `rewardIds must contain between 1 and ${MAX_SEEN_REWARD_IDS} items`,
    );
  }

  const rewardIds = value.rewardIds.map(parseRewardId);
  if (new Set(rewardIds).size !== rewardIds.length) {
    throw new RewardSeenValidationError('rewardIds must not contain duplicates');
  }
  return {rewardIds};
}

function parseStoredRewardId(value: string | number): string {
  const rewardId = String(value);
  if (!/^[1-9]\d*$/.test(rewardId) || BigInt(rewardId) > MAX_POSTGRES_BIGINT) {
    throw new Error('Stored reward ID was invalid');
  }
  return rewardId;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original database failure while the client is released below.
  }
}

export async function markRewardsSeen(
  pool: Pool,
  discordUserId: string,
  rewardIds: readonly string[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ownedResult = await client.query<OwnedRewardRow>(
      `SELECT reward.rewardid AS hour_rewardid
         FROM public.gostudy_hour_rewards AS reward
        WHERE reward.userid = $1::bigint
          AND reward.rewardid = ANY($2::bigint[])
        FOR SHARE`,
      [discordUserId, rewardIds],
    );
    const ownedRewardIds = new Set(
      ownedResult.rows.map((row) => parseStoredRewardId(row.hour_rewardid)),
    );
    if (ownedRewardIds.size !== rewardIds.length
      || rewardIds.some((rewardId) => !ownedRewardIds.has(rewardId))) {
      throw new RewardSeenOwnershipError('One or more rewards were not owned by the current user');
    }

    await client.query(
      `INSERT INTO public.web_reward_seen_rewards (userid, hour_rewardid)
       SELECT $1::bigint, reward.rewardid
         FROM public.gostudy_hour_rewards AS reward
        WHERE reward.userid = $1::bigint
          AND reward.rewardid = ANY($2::bigint[])
       ON CONFLICT (userid, hour_rewardid) DO NOTHING`,
      [discordUserId, rewardIds],
    );
    await client.query('COMMIT');
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}
