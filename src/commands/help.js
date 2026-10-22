module.exports = {
  name: "help",
  description: "List available commands",
  handler: async (ctx) => {
    const commands = await ctx.telegram.getMyCommands();
    const lines = commands.map((c) => `/${c.command} - ${c.description}`);
    await ctx.reply(lines.join("\n") || "No commands available");
  },
};
