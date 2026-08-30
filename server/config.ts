import 'dotenv/config';

import type {PoolConfig} from 'pg';

type NodeEnvironment = 'development' | 'test' | 'production';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  appUrl: URL;
  port: number;
  databaseUrl: string;
  databaseSsl: PoolConfig['ssl'];
  pgPoolMax: number;
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  trustProxy: boolean | number | string;
  r2?: R2Config | null;
}

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readPositiveInteger(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readNodeEnvironment(): NodeEnvironment {
  const value = process.env.NODE_ENV?.trim() || 'development';
  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  return value;
}

function readHttpUrl(name: string): URL {
  const url = new URL(readRequired(name));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }
  return url;
}

function readDatabaseSsl(nodeEnv: NodeEnvironment): PoolConfig['ssl'] {
  const mode = process.env.DATABASE_SSL_MODE?.trim().toLowerCase()
    || (nodeEnv === 'production' ? 'verify-full' : 'disable');

  if (mode === 'disable') {
    return false;
  }
  if (mode === 'require') {
    return {rejectUnauthorized: false};
  }
  if (mode === 'verify-full') {
    return {rejectUnauthorized: true};
  }
  throw new Error('DATABASE_SSL_MODE must be disable, require, or verify-full');
}

function readTrustProxy(): boolean | number | string {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value || value === 'false') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

function readR2Config(): R2Config | null {
  const names = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ] as const;
  const values = Object.fromEntries(
    names.map((name) => [name, process.env[name]?.trim() || '']),
  ) as Record<(typeof names)[number], string>;
  if (names.every((name) => values[name] === '')) {
    return null;
  }
  const missing = names.filter((name) => values[name] === '');
  if (missing.length > 0) {
    throw new Error(`R2 configuration is incomplete: ${missing.join(', ')} required`);
  }
  if (!/^[0-9a-f]{32}$/.test(values.R2_ACCOUNT_ID)) {
    throw new Error('R2_ACCOUNT_ID must be a lowercase 32-character hexadecimal account ID');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(values.R2_BUCKET)) {
    throw new Error('R2_BUCKET must be a canonical 3-63 character R2 bucket name');
  }
  return {
    accountId: values.R2_ACCOUNT_ID,
    accessKeyId: values.R2_ACCESS_KEY_ID,
    secretAccessKey: values.R2_SECRET_ACCESS_KEY,
    bucket: values.R2_BUCKET,
  };
}

export function loadConfig(): AppConfig {
  const nodeEnv = readNodeEnvironment();
  const appUrl = readHttpUrl('APP_URL');
  const discordRedirectUri = readHttpUrl('DISCORD_REDIRECT_URI');
  const discordClientId = readRequired('DISCORD_CLIENT_ID');
  const sessionSecret = readRequired('SESSION_SECRET');

  if (appUrl.pathname !== '/') {
    throw new Error('APP_URL must not include a path');
  }
  if (nodeEnv === 'production' && appUrl.protocol !== 'https:') {
    throw new Error('APP_URL must use https in production');
  }
  if (discordRedirectUri.origin !== appUrl.origin
    || discordRedirectUri.pathname !== '/auth/discord/callback') {
    throw new Error('DISCORD_REDIRECT_URI must be the APP_URL origin plus /auth/discord/callback');
  }
  if (!/^\d+$/.test(discordClientId)) {
    throw new Error('DISCORD_CLIENT_ID must be a decimal string');
  }
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  }

  return {
    nodeEnv,
    appUrl,
    port: readPositiveInteger('PORT', 8787),
    databaseUrl: readRequired('DATABASE_URL'),
    databaseSsl: readDatabaseSsl(nodeEnv),
    pgPoolMax: readPositiveInteger('PG_POOL_MAX', 10),
    discordClientId,
    discordClientSecret: readRequired('DISCORD_CLIENT_SECRET'),
    discordRedirectUri: discordRedirectUri.toString(),
    sessionSecret,
    sessionTtlSeconds: readPositiveInteger('SESSION_TTL_SECONDS', 7 * 24 * 60 * 60),
    trustProxy: readTrustProxy(),
    r2: readR2Config(),
  };
}
