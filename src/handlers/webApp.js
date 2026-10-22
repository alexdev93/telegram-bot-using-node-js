const { message } = require("telegraf/filters");

// Data sent from a Mini App via Telegram.WebApp.sendData()
module.exports = (bot) => {
  bot.on(message("web_app_data"), async (ctx) => {
    await ctx.reply(`Mini App sent: ${ctx.message.web_app_data.data}`);
  });
};
