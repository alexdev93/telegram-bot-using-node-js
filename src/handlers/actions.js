// Inline button presses. Buttons are sent by commands such as /menu
module.exports = (bot) => {
  bot.action(/^menu:(.+)$/, async (ctx) => {
    const choice = ctx.match[1];
    await ctx.answerCbQuery(`You chose ${choice}`);
    await ctx.editMessageText(`You chose: ${choice}`);
  });

  // Fallback so the button spinner always stops, even for unknown buttons
  bot.on("callback_query", async (ctx) => {
    await ctx.answerCbQuery();
  });
};
