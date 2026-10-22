const { Markup } = require("telegraf");

// Sends inline buttons; presses are handled in handlers/actions.js
module.exports = {
  name: "menu",
  description: "Show a button menu",
  handler: async (ctx) => {
    await ctx.reply(
      "Choose an option:",
      Markup.inlineKeyboard([
        Markup.button.callback("Yes", "menu:yes"),
        Markup.button.callback("No", "menu:no"),
      ])
    );
  },
};
