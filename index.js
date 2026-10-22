const createBot = require("./src/bot");
const start = require("./src/server");

start(createBot());
