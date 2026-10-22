const actions = require("./actions");
const inline = require("./inline");
const hears = require("./hears");
const media = require("./media");
const sharing = require("./sharing");
const edited = require("./edited");
const chatMember = require("./chatMember");
const payments = require("./payments");
const webApp = require("./webApp");
const text = require("./text");

// Add new update handlers here. Order matters: the first match wins,
// so keep specific handlers (like hears) before the catch-all text handler
const handlers = [
  actions,
  inline,
  hears,
  media,
  sharing,
  edited,
  chatMember,
  payments,
  webApp,
  text,
];

function registerHandlers(bot) {
  for (const register of handlers) register(bot);
}

module.exports = registerHandlers;
