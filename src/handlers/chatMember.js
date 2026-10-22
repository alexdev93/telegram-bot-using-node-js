// The bot itself being added to, removed from, or promoted in a chat
module.exports = (bot) => {
  bot.on("my_chat_member", async (ctx) => {
    const { chat, new_chat_member } = ctx.myChatMember;
    console.log(`Bot status in "${chat.title ?? chat.id}" is now ${new_chat_member.status}`);

    if (new_chat_member.status === "member" && chat.type !== "private") {
      await ctx.reply("Thanks for adding me!");
    }
  });
};
