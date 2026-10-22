const { message } = require("telegraf/filters");

// Invoices are sent with ctx.replyWithInvoice(); these handle the user paying
module.exports = (bot) => {
  // Must be answered within 10 seconds or the payment fails
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on(message("successful_payment"), async (ctx) => {
    const { total_amount, currency } = ctx.message.successful_payment;
    await ctx.reply(`Payment received: ${total_amount / 100} ${currency}`);
  });
};
