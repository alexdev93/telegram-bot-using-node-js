const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const createBot = require("../src/bot");
const { BOT_ACCESS_PATH, createBotAccessReporter } = require("../src/botAccess/reporter");
const { startFakeTelegram } = require("./support/fakeTelegram");
const { startFakeAuthService } = require("./support/fakeAuthService");

const TOKEN = "123456:TEST-TOKEN";
const CLIENT_ID = "telegram-bot";
const SECRET = "e".repeat(40);
const DOMAIN = "ma-mech-yet.vercel.app";
const BOT = { id: 999, is_bot: true, first_name: "Test", username: "test_bot" };
const USER = { id: 123456789, is_bot: false, first_name: "Ada" };
const PRIVATE_CHAT = { id: USER.id, type: "private", first_name: "Ada" };

let telegram;
let auth;
let logs;
let nextUpdateId;

function silentLog() {
  logs = [];
  return {
    info: (event, fields) => logs.push({ level: "info", event, ...fields }),
    warn: (event, fields) => logs.push({ level: "warn", event, ...fields }),
    error: (event, fields) => logs.push({ level: "error", event, ...fields }),
  };
}

function makeBot(reporterOptions = {}) {
  const log = silentLog();
  const reporter = createBotAccessReporter({
    authServiceUrl: auth.url,
    clientId: CLIENT_ID,
    secret: SECRET,
    timeoutMs: 500,
    retryBaseDelayMs: 1,
    log,
    ...reporterOptions,
  });
  const bot = createBot({
    token: TOKEN,
    telegram: { apiRoot: telegram.url },
    reporter,
    loginDomains: [DOMAIN],
    log,
  });
  bot.botInfo = BOT;
  return bot;
}

const messageUpdate = (fields) => ({
  update_id: nextUpdateId++,
  message: { message_id: 10, date: 1_800_000_000, chat: PRIVATE_CHAT, from: USER, ...fields },
});

const memberUpdate = (oldStatus, newStatus, chat = PRIVATE_CHAT) => ({
  update_id: nextUpdateId++,
  my_chat_member: {
    chat,
    from: USER,
    date: 1_800_000_100,
    old_chat_member: { user: BOT, status: oldStatus },
    new_chat_member: { user: BOT, status: newStatus, ...(newStatus === "kicked" && { until_date: 0 }) },
  },
});

before(async () => {
  telegram = await startFakeTelegram();
  auth = await startFakeAuthService({ clientId: CLIENT_ID, secret: SECRET });
});
after(async () => {
  await telegram.close();
  await auth.close();
});

beforeEach(() => {
  nextUpdateId = 5000;
  telegram.calls.length = 0;
  auth.calls.length = 0;
  auth.respond = () => ({ status: 200, json: { duplicate: false, applied: true } });
});

describe("grant from Telegram Login (connected_website)", () => {
  it("reports a signed 'granted' event for our website", async () => {
    await makeBot().handleUpdate(messageUpdate({ connected_website: DOMAIN }));

    assert.equal(auth.calls.length, 1);
    const [call] = auth.calls;
    assert.equal(call.verified, true);
    assert.equal(call.path, BOT_ACCESS_PATH);
    assert.equal(call.headers["x-client-id"], CLIENT_ID);
    assert.deepEqual(call.body, {
      eventId: "tg-999-5000",
      telegramUserId: "123456789",
      status: "granted",
      source: "website_login",
      occurredAt: "2027-01-15T08:00:00.000Z",
    });
    // The grant is a service message: the bot doesn't answer it
    assert.equal(telegram.calls.length, 0);
  });

  it("matches the domain case-insensitively", async () => {
    await makeBot().handleUpdate(messageUpdate({ connected_website: DOMAIN.toUpperCase() }));
    assert.equal(auth.calls.length, 1);
  });

  it("ignores logins on other websites that use the same bot", async () => {
    await makeBot().handleUpdate(messageUpdate({ connected_website: "evil.example" }));
    assert.equal(auth.calls.length, 0);
    assert.ok(logs.some((l) => l.event === "bot_access_event_ignored"));
  });
});

describe("/start", () => {
  it("reports 'granted' and still sends the welcome reply", async () => {
    const bot = makeBot();
    await bot.handleUpdate(
      messageUpdate({ text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] })
    );

    assert.equal(auth.calls.length, 1);
    assert.equal(auth.calls[0].body.status, "granted");
    assert.equal(auth.calls[0].body.source, "start");
    assert.equal(telegram.calls.length, 1);
    assert.equal(telegram.calls[0].path, `/bot${TOKEN}/sendMessage`);
    assert.match(telegram.calls[0].body.text, /Welcome, Ada/);
  });
});

describe("block and unblock (my_chat_member)", () => {
  it("reports 'revoked' when the user blocks the bot", async () => {
    await makeBot().handleUpdate(memberUpdate("member", "kicked"));
    assert.equal(auth.calls.length, 1);
    assert.equal(auth.calls[0].body.status, "revoked");
    assert.equal(auth.calls[0].body.source, "blocked");
    assert.equal(auth.calls[0].body.occurredAt, "2027-01-15T08:01:40.000Z");
  });

  it("reports 'granted' when the user unblocks the bot", async () => {
    await makeBot().handleUpdate(memberUpdate("kicked", "member"));
    assert.equal(auth.calls.length, 1);
    assert.equal(auth.calls[0].body.status, "granted");
    assert.equal(auth.calls[0].body.source, "unblocked");
  });

  it("ignores group membership changes", async () => {
    const group = { id: -100123, type: "supergroup", title: "Team" };
    await makeBot().handleUpdate(memberUpdate("left", "member", group));
    assert.equal(auth.calls.length, 0);
    // The existing handler still greets the group
    assert.match(telegram.calls[0].body.text, /Thanks for adding me/);
  });
});

describe("delivery to the auth service", () => {
  it("retries a 5xx and then succeeds, with a fresh signature each time", async () => {
    auth.respond = (_call, n) => (n === 1 ? { status: 503, json: {} } : { status: 200, json: { applied: true } });
    await makeBot().handleUpdate(messageUpdate({ connected_website: DOMAIN }));
    assert.equal(auth.calls.length, 2);
    assert.ok(auth.calls.every((c) => c.verified));
    assert.ok(logs.some((l) => l.event === "bot_access_event_reported" && l.attempts === 2));
  });

  it("does not retry a 4xx rejection", async () => {
    auth.respond = () => ({ status: 400, json: { error: { code: "invalid_request" } } });
    await makeBot().handleUpdate(messageUpdate({ connected_website: DOMAIN }));
    assert.equal(auth.calls.length, 1);
    assert.ok(logs.some((l) => l.event === "bot_access_event_failed" && l.httpStatus === 400));
  });

  it("gives up quietly when the auth service is down", async () => {
    const bot = makeBot({ authServiceUrl: "http://127.0.0.1:9" });
    await assert.doesNotReject(bot.handleUpdate(messageUpdate({ connected_website: DOMAIN })));
    assert.ok(logs.some((l) => l.event === "bot_access_event_failed" && l.attempts === 3));
  });

  it("skips reporting when not configured, without breaking /start", async () => {
    const bot = makeBot({ secret: undefined });
    await bot.handleUpdate(
      messageUpdate({ text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] })
    );
    assert.equal(auth.calls.length, 0);
    assert.equal(telegram.calls.length, 1);
  });

  it("never logs the Telegram user id", async () => {
    const bot = makeBot();
    await bot.handleUpdate(messageUpdate({ connected_website: DOMAIN }));
    await bot.handleUpdate(memberUpdate("member", "kicked"));
    assert.equal(logs.length, 2);
    assert.ok(!JSON.stringify(logs).includes(String(USER.id)));
  });
});
