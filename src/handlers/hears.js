// Keyword/pattern replies. Registered before the catch-all text handler
module.exports = (bot) => {
  bot.hears(/^(hi|hello|hey)\b/i, async (ctx) => {
    await ctx.reply(`Hi ${ctx.from.first_name}!`);
  });
};
