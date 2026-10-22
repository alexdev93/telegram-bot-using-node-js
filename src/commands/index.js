const start = require("./start");
const help = require("./help");

// Add new commands here
const commands = [start, help];

function registerCommands(bot) {
  for (const { name, handler } of commands) bot.command(name, handler);
}

module.exports = { commands, registerCommands };
