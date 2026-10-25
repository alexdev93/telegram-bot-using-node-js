require("dotenv").config();

// Accept "my-bot.deno.net" or "https://my-bot.deno.net/"
function normalizeDomain(value) {
  if (!value) return undefined;
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function positiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const config = {
  // API_KEY is the original name, kept so existing deployments keep working
  apiKey: process.env.TELEGRAM_BOT_TOKEN || process.env.API_KEY,
  webhookDomain: normalizeDomain(process.env.WEBHOOK_DOMAIN),
  port: Number(process.env.PORT) || 8000,
  databaseUrl: process.env.DATABASE_URL,

  // Internal OTP API, see docs/contracts/telegram-otp.v1.md
  internalApi: {
    clientId: process.env.BOT_SERVICE_CLIENT_ID,
    // The previous secret stays valid while a rotation is in progress
    clientSecrets: [
      process.env.BOT_SERVICE_CLIENT_SECRET,
      process.env.BOT_SERVICE_CLIENT_SECRET_PREVIOUS,
    ].filter(Boolean),
    telegramApiTimeoutMs: positiveInt("TELEGRAM_API_TIMEOUT_MS", 5000),
    maxAttempts: positiveInt("NOTIFICATION_MAX_ATTEMPTS", 3),
    clientRateLimit: positiveInt("NOTIFICATION_RATE_LIMIT", 60),
    recipientRateLimit: positiveInt("OTP_RECIPIENT_RATE_LIMIT", 5),
    otpMaxTtlSeconds: positiveInt("OTP_MAX_TTL_SECONDS", 900),
  },
};

if (!config.apiKey) console.error("TELEGRAM_BOT_TOKEN is not set");

module.exports = config;
