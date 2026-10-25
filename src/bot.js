const { Telegraf } = require("telegraf");
const config = require("./config");
const logger = require("./middlewares/logger");
const { registerCommands } = require("./commands");
const registerHandlers = require("./handlers");
const { registerBotAccess } = require("./botAccess/handlers");
const { createBotAccessReporter } = require("./botAccess/reporter");

// Options exist for tests: a fake token, a local Telegram API, a stub reporter and log
function createBot({
  token = config.apiKey,
  telegram,
  reporter = createBotAccessReporter(config.botEvents),
  loginDomains = config.botEvents.loginDomains,
  log,
} = {}) {
  const bot = new Telegraf(token, telegram ? { telegram } : undefined);

  bot.use(logger);
  // Before the commands: its /start step reports access, then hands over to the /start command
  registerBotAccess(bot, { reporter, loginDomains, log });
  // Commands first, so generic handlers like "text" don't swallow "/start"
  registerCommands(bot);
  registerHandlers(bot);

  bot.catch((err, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, err);
  });

  return bot;
}

module.exports = createBot;
