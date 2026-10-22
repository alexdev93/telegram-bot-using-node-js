module.exports = (bot) => {
  bot.on("edited_message", async (ctx) => {
    await ctx.reply("I saw you edited a message", {
      reply_to_message_id: ctx.editedMessage.message_id,
    });
  });
};
