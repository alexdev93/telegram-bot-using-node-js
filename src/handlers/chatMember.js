// The bot itself being added to, removed from, or promoted in a chat.
// Private chats (block/unblock) are reported to the auth service in botAccess/handlers.js
module.exports = (bot) => {
  bot.on("my_chat_member", async (ctx) => {
    const { chat, new_chat_member } = ctx.myChatMember;
    // A private chat id is the user's id, which is personal data, so only groups are named
    const where = chat.type === "private" ? "a private chat" : `"${chat.title ?? chat.id}"`;
    console.log(`Bot status in ${where} is now ${new_chat_member.status}`);

    if (new_chat_member.status === "member" && chat.type !== "private") {
      await ctx.reply("Thanks for adding me!");
    }
  });
};
