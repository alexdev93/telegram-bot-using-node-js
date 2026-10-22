module.exports = {
  name: "start",
  description: "Start the bot",
  handler: async (ctx) => {
    await ctx.reply(`Welcome, ${ctx.from.first_name}!`);
  },
};
