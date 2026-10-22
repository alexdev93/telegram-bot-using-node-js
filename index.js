const http = require("http");
const { Telegraf } = require("telegraf");
require("dotenv").config();

const API_KEY = process.env.API_KEY;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN; // e.g. my-bot.deno.dev
const PORT = process.env.PORT || 8000;

const bot = new Telegraf(API_KEY);

bot.on("text", async (ctx) => {
  await ctx.reply("Hello There");
});

async function main() {
  if (WEBHOOK_DOMAIN) {
    // Hosted: Telegram pushes updates to us, and the platform sees a listening server
    const handler = await bot.createWebhook({ domain: WEBHOOK_DOMAIN });
    http.createServer(handler).listen(PORT, () => {
      console.log(`Webhook server listening on ${PORT}`);
    });
  } else {
    // Local: long polling
    bot.launch();
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  }
}

main();
