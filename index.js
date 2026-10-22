const http = require("http");
const { Telegraf } = require("telegraf");
require("dotenv").config();

const API_KEY = process.env.API_KEY;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN; // e.g. my-bot.deno.dev
const PORT = process.env.PORT || 8000;

if (!API_KEY) console.error("API_KEY is not set");

const bot = new Telegraf(API_KEY);

bot.on("text", async (ctx) => {
  await ctx.reply("Hello There");
});

const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
const webhook = bot.webhookCallback(webhookPath);

// Start listening right away so the platform's warm-up check passes
http
  .createServer((req, res) => {
    if (req.url === webhookPath) return webhook(req, res);
    res.end("ok");
  })
  .listen(PORT, () => console.log(`Server listening on ${PORT}`));

if (WEBHOOK_DOMAIN) {
  bot.telegram
    .setWebhook(`https://${WEBHOOK_DOMAIN}${webhookPath}`)
    .then(() => console.log(`Webhook set for ${WEBHOOK_DOMAIN}`))
    .catch((err) => console.error("Failed to set webhook:", err.message));
} else {
  console.warn("WEBHOOK_DOMAIN not set, falling back to long polling");
  bot.launch().catch((err) => console.error("Failed to launch bot:", err.message));
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
