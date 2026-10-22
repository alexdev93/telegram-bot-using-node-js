const { Telegraf } = require("telegraf");
const config = require("./config");
const logger = require("./middlewares/logger");
const { registerCommands } = require("./commands");
const registerHandlers = require("./handlers");

function createBot() {
  const bot = new Telegraf(config.apiKey);

  bot.use(logger);
  // Commands first, so generic handlers like "text" don't swallow "/start"
  registerCommands(bot);
  registerHandlers(bot);

  bot.catch((err, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, err);
  });

  return bot;
}

module.exports = createBot;
