require("dotenv").config();

// Accept "my-bot.deno.net" or "https://my-bot.deno.net/"
function normalizeDomain(value) {
  if (!value) return undefined;
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

const config = {
  apiKey: process.env.API_KEY,
  webhookDomain: normalizeDomain(process.env.WEBHOOK_DOMAIN),
  port: Number(process.env.PORT) || 8000,
};

if (!config.apiKey) console.error("API_KEY is not set");

module.exports = config;
