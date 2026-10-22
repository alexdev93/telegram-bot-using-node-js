const { Markup } = require("telegraf");

// Asks for location/contact; replies are handled in handlers/sharing.js
module.exports = {
  name: "share",
  description: "Share your location or contact",
  handler: async (ctx) => {
    await ctx.reply(
      "Tap a button to share:",
      Markup.keyboard([
        Markup.button.locationRequest("Send location"),
        Markup.button.contactRequest("Send contact"),
      ])
        .oneTime()
        .resize()
    );
  },
};
