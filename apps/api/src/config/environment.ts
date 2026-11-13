type NodeEnvironment = 'development' | 'production' | 'test';

export interface ApiEnvironment {
  NODE_ENV: NodeEnvironment;
  API_PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  WEB_ORIGINS: string;
  GUEST_TOKEN_ENCRYPTION_KEY?: string;
  GUEST_TOKEN_ENCRYPTION_KEY_ID?: string;
  APP_CONFIG_MASTER_KEY?: string;
  PLATFORM_BOOTSTRAP_TOKEN?: string;
  PAYMENTS_API_PUBLIC_URL?: string;
}

export function validateEnvironment(
  values: Record<string, unknown>,
): ApiEnvironment {
  const nodeEnv = String(values.NODE_ENV ?? 'development');
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, production, or test.');
  }

  const port = Number(values.API_PORT ?? 8002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }

  const databaseUrl = String(values.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }

  if (nodeEnv === 'production' && values.JWT_SECRET === undefined) {
    throw new Error('JWT_SECRET must be explicitly configured in production.');
  }
  const jwtSecret = String(
    values.JWT_SECRET ?? 'dev-jwt-secret-min-32-characters-long-service-business-cloud',
  ).trim();
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }

  const webOrigins = String(values.WEB_ORIGINS ?? 'http://localhost:3002').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (nodeEnv === 'production' && values.WEB_ORIGINS === undefined) {
    throw new Error('WEB_ORIGINS must list the exact browser application origin(s) in production.');
  }
  for (const origin of webOrigins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error('WEB_ORIGINS must contain valid origins.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error('Each WEB_ORIGINS value must be an origin without credentials, path, query or fragment.');
    }
    if (nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error('WEB_ORIGINS must use HTTPS in production.');
  }

  const guestTokenEncryptionKey = String(values.GUEST_TOKEN_ENCRYPTION_KEY ?? '').trim();
  if (guestTokenEncryptionKey && !/^[0-9a-f]{64}$/i.test(guestTokenEncryptionKey)) {
    throw new Error('GUEST_TOKEN_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hexadecimal characters.');
  }

  const guestTokenEncryptionKeyId = String(values.GUEST_TOKEN_ENCRYPTION_KEY_ID ?? 'v1').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(guestTokenEncryptionKeyId)) {
    throw new Error('GUEST_TOKEN_ENCRYPTION_KEY_ID must be 1-64 letters, numbers, dots, underscores or hyphens.');
  }

  const appConfigMasterKey = String(values.APP_CONFIG_MASTER_KEY ?? '').trim();
  if (appConfigMasterKey && !/^[0-9a-f]{64}$/i.test(appConfigMasterKey)) {
    throw new Error('APP_CONFIG_MASTER_KEY must be a dedicated 32-byte key encoded as 64 hexadecimal characters.');
  }
  if (appConfigMasterKey && guestTokenEncryptionKey && appConfigMasterKey.toLowerCase() === guestTokenEncryptionKey.toLowerCase()) {
    throw new Error('APP_CONFIG_MASTER_KEY must be different from GUEST_TOKEN_ENCRYPTION_KEY.');
  }

  const platformBootstrapToken = String(values.PLATFORM_BOOTSTRAP_TOKEN ?? '').trim();
  if (platformBootstrapToken && platformBootstrapToken.length < 32) {
    throw new Error('PLATFORM_BOOTSTRAP_TOKEN must contain at least 32 characters.');
  }

  const paymentsApiPublicUrl = String(values.PAYMENTS_API_PUBLIC_URL ?? '').trim();
  if (paymentsApiPublicUrl) {
    let parsed: URL;
    try { parsed = new URL(paymentsApiPublicUrl); } catch { throw new Error('PAYMENTS_API_PUBLIC_URL must be an absolute HTTP or HTTPS origin.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('PAYMENTS_API_PUBLIC_URL must be an origin without credentials, path, query, or fragment.');
    }
    if (nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error('PAYMENTS_API_PUBLIC_URL must use HTTPS in production.');
  }

  return {
    NODE_ENV: nodeEnv as NodeEnvironment,
    API_PORT: port,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    WEB_ORIGINS: webOrigins.join(','),
    GUEST_TOKEN_ENCRYPTION_KEY: guestTokenEncryptionKey || undefined,
    GUEST_TOKEN_ENCRYPTION_KEY_ID: guestTokenEncryptionKeyId,
    APP_CONFIG_MASTER_KEY: appConfigMasterKey || undefined,
    PLATFORM_BOOTSTRAP_TOKEN: platformBootstrapToken || undefined,
    PAYMENTS_API_PUBLIC_URL: paymentsApiPublicUrl || undefined,
  };
}
