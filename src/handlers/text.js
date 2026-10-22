module.exports = (bot) => {
  bot.on("text", async (ctx) => {
    await ctx.reply("Hello There");
  });
};
