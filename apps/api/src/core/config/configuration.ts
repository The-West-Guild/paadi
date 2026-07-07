export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? "development",
  apiPort: Number(process.env.API_PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  nomba: {
    baseUrl: process.env.NOMBA_BASE_URL ?? "",
    clientId: process.env.NOMBA_CLIENT_ID ?? "",
    clientSecret: process.env.NOMBA_CLIENT_SECRET ?? "",
    accountId: process.env.NOMBA_ACCOUNT_ID ?? "",
    webhookSigningKey: process.env.NOMBA_WEBHOOK_SIGNING_KEY ?? "",
    driver: process.env.NOMBA_DRIVER ?? "mock",
    checkoutCallbackUrl: process.env.NOMBA_CHECKOUT_CALLBACK_URL ?? "",
    checkoutEmail: process.env.NOMBA_CHECKOUT_EMAIL ?? "payments@paadi.app",
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? "",
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? "",
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshIdleDays: Number(process.env.JWT_REFRESH_IDLE_DAYS ?? 30),
    refreshAbsoluteDays: Number(process.env.JWT_REFRESH_ABSOLUTE_DAYS ?? 90),
  },
  crypto: {
    otpPepper: process.env.OTP_PEPPER ?? "",
    phoneEncryptionKey: process.env.PHONE_ENCRYPTION_KEY ?? "",
    phoneBlindIndexKey: process.env.PHONE_BLIND_INDEX_KEY ?? "",
    accountNumberEncryptionKey: process.env.ACCOUNT_NUMBER_ENCRYPTION_KEY ?? "",
  },
  otp: {
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 3),
    resendSeconds: Number(process.env.OTP_RESEND_SECONDS ?? 60),
    devBypassCode: process.env.OTP_DEV_BYPASS_CODE ?? "000000",
  },
  sendchamp: {
    apiKey: process.env.SENDCHAMP_API_KEY ?? "",
    sender: process.env.SENDCHAMP_SENDER ?? "Paadi",
    senderEmail: process.env.SENDCHAMP_SENDER_EMAIL ?? "",
    baseUrl: process.env.SENDCHAMP_BASE_URL ?? "https://api.sendchamp.com",
    driver: process.env.SENDCHAMP_DRIVER ?? "console",
  },
  nudges: {
    createdDelayMs: Number(
      process.env.NUDGE_CREATED_DELAY_MS ?? 24 * 60 * 60 * 1000,
    ),
    deadlineWindowMs: Number(
      process.env.NUDGE_DEADLINE_WINDOW_MS ?? 24 * 60 * 60 * 1000,
    ),
  },
  dojah: {
    appId: process.env.DOJAH_APP_ID ?? "",
    apiKey: process.env.DOJAH_API_KEY ?? "",
    webhookSecret: process.env.DOJAH_WEBHOOK_SECRET ?? "",
    baseUrl: process.env.DOJAH_BASE_URL ?? "https://sandbox.dojah.io",
    driver: process.env.DOJAH_DRIVER ?? "mock",
  },
  google: {
    clientIds: (process.env.GOOGLE_CLIENT_IDS ?? "").split(",").filter(Boolean),
    driver: process.env.GOOGLE_DRIVER ?? "mock",
  },
  expo: {
    accessToken: process.env.EXPO_ACCESS_TOKEN ?? "",
  },
  admin: {
    userIds: (process.env.PAADI_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  },
  apiKeys: {
    cacheTtlSeconds: Number(process.env.API_KEY_CACHE_TTL_SECONDS ?? 60),
    maxPerUser: Number(process.env.API_KEYS_MAX_PER_USER ?? 10),
  },
  rateLimit: {
    enabled: (process.env.RATE_LIMIT_ENABLED ?? "true") !== "false",
    windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
    authenticatedLimit: Number(
      process.env.RATE_LIMIT_AUTHENTICATED_LIMIT ?? 120,
    ),
    apiKeyLimit: Number(process.env.RATE_LIMIT_API_KEY_LIMIT ?? 60),
    publicLimit: Number(process.env.RATE_LIMIT_PUBLIC_LIMIT ?? 20),
  },
});
