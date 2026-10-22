const { message } = require("telegraf/filters");

module.exports = (bot) => {
  bot.on(message("location"), async (ctx) => {
    const { latitude, longitude } = ctx.message.location;
    await ctx.reply(`You're at ${latitude}, ${longitude}`);
  });

  bot.on(message("contact"), async (ctx) => {
    const { first_name, phone_number } = ctx.message.contact;
    await ctx.reply(`Got contact: ${first_name} (${phone_number})`);
  });

  bot.on(message("poll"), async (ctx) => {
    await ctx.reply(`Got your poll: ${ctx.message.poll.question}`);
  });

  bot.on(message("dice"), async (ctx) => {
    const { emoji, value } = ctx.message.dice;
    await ctx.reply(`You rolled ${emoji} ${value}`);
  });
};
