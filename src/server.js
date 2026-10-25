const http = require("http");
const config = require("./config");
const { commands } = require("./commands");
const { createInternalApi, notConfigured } = require("./internal");
const { createPool, createOtpStore } = require("./db/otpStore");
const { createSendMessage } = require("./telegram/sendMessage");

const MIN_SECRET_LENGTH = 32;

function buildInternalApi() {
  const { internalApi } = config;
  const problems = [];
  if (!config.apiKey) problems.push("TELEGRAM_BOT_TOKEN is not set");
  if (!config.databaseUrl) problems.push("DATABASE_URL is not set");
  if (!internalApi.clientId) problems.push("BOT_SERVICE_CLIENT_ID is not set");
  if (internalApi.clientSecrets.length === 0) problems.push("BOT_SERVICE_CLIENT_SECRET is not set");
  if (internalApi.clientSecrets.some((secret) => secret.length < MIN_SECRET_LENGTH)) {
    problems.push(`client secrets must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (problems.length) {
    console.warn(`Internal OTP API disabled: ${problems.join("; ")}`);
    return notConfigured;
  }

  return createInternalApi({
    clients: new Map([[internalApi.clientId, internalApi.clientSecrets]]),
    store: createOtpStore(createPool(config.databaseUrl)),
    sendMessage: createSendMessage({ token: config.apiKey, timeoutMs: internalApi.telegramApiTimeoutMs }),
    maxAttempts: internalApi.maxAttempts,
    clientRateLimit: internalApi.clientRateLimit,
    recipientRateLimit: internalApi.recipientRateLimit,
    otpMaxTtlSeconds: internalApi.otpMaxTtlSeconds,
  });
}

async function start(bot) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  const webhook = bot.webhookCallback(webhookPath);
  const internalApi = buildInternalApi();

  // Listen right away so the platform's warm-up check passes
  const server = http.createServer((req, res) => {
    if (req.url === webhookPath) return webhook(req, res);
    if (req.url.startsWith("/internal/")) return internalApi(req, res);
    res.end("ok");
  });
  // Bounds how long a client may take to send its request, not how long we take to answer
  server.requestTimeout = 15_000;
  server.listen(config.port, () => console.log(`Server listening on ${config.port}`));

  try {
    // Shows the command menu in Telegram
    await bot.telegram.setMyCommands(
      commands.map(({ name, description }) => ({ command: name, description }))
    );

    if (config.webhookDomain) {
      await bot.telegram.setWebhook(`https://${config.webhookDomain}${webhookPath}`);
      console.log(`Webhook set for ${config.webhookDomain}`);
    } else {
      console.warn("WEBHOOK_DOMAIN not set, falling back to long polling");
      process.once("SIGINT", () => bot.stop("SIGINT"));
      process.once("SIGTERM", () => bot.stop("SIGTERM"));
      await bot.launch();
    }
  } catch (err) {
    console.error("Failed to start bot:", err.message);
  }
}

module.exports = start;
