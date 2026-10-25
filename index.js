const createBot = require("./src/bot");
const start = require("./src/server");

start(createBot()).catch((err) => {
  // Without this an unexpected startup error is an unhandled rejection with no clear message
  console.error("Bot failed to start:", err.message);
  process.exitCode = 1;
});
