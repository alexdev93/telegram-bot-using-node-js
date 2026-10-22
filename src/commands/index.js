const start = require("./start");
const help = require("./help");
const menu = require("./menu");
const share = require("./share");

// Add new commands here
const commands = [start, help, menu, share];

function registerCommands(bot) {
  for (const { name, handler } of commands) bot.command(name, handler);
}

module.exports = { commands, registerCommands };
