const text = require("./text");

// Add new update handlers here (messages, callback queries, photos, ...)
const handlers = [text];

function registerHandlers(bot) {
  for (const register of handlers) register(bot);
}

module.exports = registerHandlers;
