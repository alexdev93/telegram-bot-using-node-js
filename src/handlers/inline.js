// "@yourbot something" typed in any chat. Enable with /setinline in @BotFather
module.exports = (bot) => {
  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query;
    if (!query) return ctx.answerInlineQuery([]);

    await ctx.answerInlineQuery([
      {
        type: "article",
        id: "echo",
        title: `Send "${query}"`,
        input_message_content: { message_text: query },
      },
    ]);
  });
};
