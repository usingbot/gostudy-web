const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const DISCORD_CURRENT_USER_URL = 'https://discord.com/api/v10/users/@me';
const DISCORD_CURRENT_USER_GUILDS_URL = 'https://discord.com/api/v10/users/@me/guilds?limit=200';
const DISCORD_ADMINISTRATOR_PERMISSION = 1n << 3n;
const DISCORD_MANAGE_GUILD_PERMISSION = 1n << 5n;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export interface DiscordOAuthConfig {
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

export interface DiscordOAuthResult {
  user: DiscordUser;
  manageableGuildIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('Discord returned an invalid response');
  }
}

export function createDiscordAuthorizationUrl(
  config: DiscordOAuthConfig,
  state: string,
): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.discordClientId);
  url.searchParams.set('redirect_uri', config.discordRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  return url.toString();
}

function parseDiscordSnowflake(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  try {
    return BigInt(value) <= MAX_SIGNED_BIGINT ? value : null;
  } catch {
    return null;
  }
}

export function hasDiscordGuildManagementPermission(
  owner: unknown,
  permissions: unknown,
): boolean {
  if (owner === true) return true;
  if (owner !== false || typeof permissions !== 'string' || !/^\d+$/.test(permissions)) {
    return false;
  }
  const permissionBits = BigInt(permissions);
  return (permissionBits & DISCORD_ADMINISTRATOR_PERMISSION) !== 0n
    || (permissionBits & DISCORD_MANAGE_GUILD_PERMISSION) !== 0n;
}

export async function exchangeCodeForDiscordUser(
  config: DiscordOAuthConfig,
  code: string,
): Promise<DiscordOAuthResult> {
  const tokenResponse = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.discordRedirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) {
    throw new Error('Discord token exchange failed');
  }

  const tokenBody = await readJson(tokenResponse);
  if (!isRecord(tokenBody) || typeof tokenBody.access_token !== 'string') {
    throw new Error('Discord token response was incomplete');
  }

  const authorization = {Authorization: `Bearer ${tokenBody.access_token}`};
  const [userResponse, guildsResponse] = await Promise.all([
    fetch(DISCORD_CURRENT_USER_URL, {
      headers: authorization,
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(DISCORD_CURRENT_USER_GUILDS_URL, {
      headers: authorization,
      signal: AbortSignal.timeout(10_000),
    }),
  ]);

  if (!userResponse.ok) {
    throw new Error('Discord user request failed');
  }
  if (!guildsResponse.ok) {
    throw new Error('Discord guild list request failed');
  }

  const [userBody, guildsBody] = await Promise.all([
    readJson(userResponse),
    readJson(guildsResponse),
  ]);
  if (!isRecord(userBody)
    || typeof userBody.id !== 'string'
    || !/^\d+$/.test(userBody.id)
    || typeof userBody.username !== 'string'
    || userBody.username.length === 0
    || (userBody.global_name !== null && typeof userBody.global_name !== 'string')
    || (userBody.avatar !== null && typeof userBody.avatar !== 'string')) {
    throw new Error('Discord user response was invalid');
  }
  if (!Array.isArray(guildsBody)) {
    throw new Error('Discord guild list response was invalid');
  }

  const manageableGuildIds = new Set<string>();
  for (const guild of guildsBody) {
    if (!isRecord(guild)) {
      throw new Error('Discord guild list response was invalid');
    }
    const guildId = parseDiscordSnowflake(guild.id);
    if (!guildId || typeof guild.owner !== 'boolean'
      || typeof guild.permissions !== 'string' || !/^\d+$/.test(guild.permissions)) {
      throw new Error('Discord guild list response was invalid');
    }
    if (hasDiscordGuildManagementPermission(guild.owner, guild.permissions)) {
      manageableGuildIds.add(guildId);
    }
  }

  return {
    user: {
      id: userBody.id,
      username: userBody.username,
      globalName: userBody.global_name,
      avatarHash: userBody.avatar,
    },
    manageableGuildIds: [...manageableGuildIds],
  };
}
