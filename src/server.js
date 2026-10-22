const http = require("http");
const config = require("./config");
const { commands } = require("./commands");

async function start(bot) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  const webhook = bot.webhookCallback(webhookPath);

  // Listen right away so the platform's warm-up check passes
  http
    .createServer((req, res) => {
      if (req.url === webhookPath) return webhook(req, res);
      res.end("ok");
    })
    .listen(config.port, () => console.log(`Server listening on ${config.port}`));

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
