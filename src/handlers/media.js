const { message } = require("telegraf/filters");

module.exports = (bot) => {
  bot.on(message("photo"), async (ctx) => {
    // Telegram sends several sizes; the last one is the largest
    const photo = ctx.message.photo.at(-1);
    await ctx.reply(`Got your photo (${photo.width}x${photo.height})`);
  });

  bot.on(message("video"), async (ctx) => {
    await ctx.reply(`Got your video (${ctx.message.video.duration}s)`);
  });

  bot.on(message("animation"), async (ctx) => {
    await ctx.reply("Got your GIF");
  });

  bot.on(message("video_note"), async (ctx) => {
    await ctx.reply("Got your round video");
  });

  bot.on(message("voice"), async (ctx) => {
    await ctx.reply(`Got your voice message (${ctx.message.voice.duration}s)`);
  });

  bot.on(message("audio"), async (ctx) => {
    const { title, performer } = ctx.message.audio;
    await ctx.reply(`Got your audio${title ? `: ${performer ?? ""} - ${title}` : ""}`);
  });

  bot.on(message("document"), async (ctx) => {
    await ctx.reply(`Got your file: ${ctx.message.document.file_name}`);
  });

  bot.on(message("sticker"), async (ctx) => {
    await ctx.reply(ctx.message.sticker.emoji ?? "Nice sticker");
  });
};
