const { Telegraf } = require("telegraf");
require('dotenv').config();

API_KEY = process.env.API_KEY

const bot = new Telegraf(`${API_KEY}`);

bot.on("text", async (ctx) => {
 await ctx.reply("Hello There");
});

bot.launch();
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));