const { message } = require("telegraf/filters");

module.exports = (bot) => {
  bot.on(message("text"), async (ctx) => {
    await ctx.reply("Hello There");
  });
};
