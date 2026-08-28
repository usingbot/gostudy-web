const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const DISCORD_CURRENT_USER_URL = 'https://discord.com/api/v10/users/@me';

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
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForDiscordUser(
  config: DiscordOAuthConfig,
  code: string,
): Promise<DiscordUser> {
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

  const userResponse = await fetch(DISCORD_CURRENT_USER_URL, {
    headers: {Authorization: `Bearer ${tokenBody.access_token}`},
    signal: AbortSignal.timeout(10_000),
  });

  if (!userResponse.ok) {
    throw new Error('Discord user request failed');
  }

  const userBody = await readJson(userResponse);
  if (!isRecord(userBody)
    || typeof userBody.id !== 'string'
    || !/^\d+$/.test(userBody.id)
    || typeof userBody.username !== 'string'
    || userBody.username.length === 0
    || (userBody.global_name !== null && typeof userBody.global_name !== 'string')
    || (userBody.avatar !== null && typeof userBody.avatar !== 'string')) {
    throw new Error('Discord user response was invalid');
  }

  return {
    id: userBody.id,
    username: userBody.username,
    globalName: userBody.global_name,
    avatarHash: userBody.avatar,
  };
}
