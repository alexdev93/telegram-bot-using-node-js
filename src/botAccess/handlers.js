const { message } = require("telegraf/filters");
const defaultLog = require("../log");

// Telegram tells only the bot, never the website, whether the bot may message a user.
// These updates are the source of truth, so each one is reported to the auth service:
// - connected_website: the user allowed messages while logging in on a website (Telegram Login)
// - /start in a private chat: the user opened the conversation themselves
// - my_chat_member in a private chat: sent only when the user blocks or unblocks the bot
function registerBotAccess(bot, { reporter, loginDomains, log = defaultLog } = {}) {
  const allowedDomains = new Set(loginDomains.map((domain) => domain.toLowerCase()));

  // update_id is unique per bot, which makes it a stable idempotency key across webhook retries
  const event = (ctx, status, source, unixDate) => ({
    eventId: `tg-${ctx.botInfo.id}-${ctx.update.update_id}`,
    telegramUserId: String(ctx.from.id),
    status,
    source,
    occurredAt: new Date(unixDate * 1000).toISOString(),
  });

  bot.on(message("connected_website"), async (ctx) => {
    if (ctx.chat.type !== "private") return;
    if (!allowedDomains.has(ctx.message.connected_website.toLowerCase())) {
      log.info("bot_access_event_ignored", { reason: "other_website" });
      return;
    }
    await reporter.report(event(ctx, "granted", "website_login", ctx.message.date));
  });

  // Registered before the commands, so the /start command still replies afterwards
  bot.start(async (ctx, next) => {
    if (ctx.chat.type === "private") {
      await reporter.report(event(ctx, "granted", "start", ctx.message.date));
    }
    return next();
  });

  bot.on("my_chat_member", async (ctx, next) => {
    const { chat, new_chat_member: member, date } = ctx.myChatMember;
    if (chat.type === "private") {
      if (member.status === "kicked") await reporter.report(event(ctx, "revoked", "blocked", date));
      if (member.status === "member") await reporter.report(event(ctx, "granted", "unblocked", date));
    }
    return next();
  });
}

module.exports = { registerBotAccess };
