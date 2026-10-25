const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const http = require("http");

const { createInternalApi, OTP_PATH } = require("../src/internal");
const { signRequest } = require("../src/internal/auth");
const { createSendMessage } = require("../src/telegram/sendMessage");
const { createMemoryStore } = require("./support/memoryStore");
const { startFakeTelegram } = require("./support/fakeTelegram");

const TOKEN = "123456:TEST-TOKEN";
const CLIENT_ID = "auth-service";
const SECRET = "s".repeat(40);
const PREVIOUS_SECRET = "p".repeat(40);

let telegram;
let app;

async function startApp(options = {}) {
  const store = createMemoryStore();
  const logs = [];
  const log = {
    info: (event, fields) => logs.push({ level: "info", event, ...fields }),
    warn: (event, fields) => logs.push({ level: "warn", event, ...fields }),
    error: (event, fields) => logs.push({ level: "error", event, ...fields }),
  };
  const handler = createInternalApi({
    clients: new Map([[CLIENT_ID, [SECRET, PREVIOUS_SECRET]]]),
    store,
    sendMessage: createSendMessage({ token: TOKEN, timeoutMs: 200, apiRoot: telegram.url }),
    retryBaseDelayMs: 1,
    log,
    ...options,
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    store,
    logs,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function validBody(overrides = {}) {
  return {
    challengeId: `ch_${crypto.randomBytes(12).toString("hex")}`,
    userId: "user-1",
    telegramUserId: "123456789",
    code: "482913",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    purpose: "login",
    ...overrides,
  };
}

async function call(body, opts = {}) {
  const {
    secret = SECRET,
    clientId = CLIENT_ID,
    timestamp = Math.floor(Date.now() / 1000),
    method = "POST",
    path = OTP_PATH,
    sign = true,
    headers = {},
  } = opts;
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const requestHeaders = {
    "content-type": "application/json",
    "x-client-id": clientId,
    "x-timestamp": String(timestamp),
  };
  if (sign) requestHeaders["x-signature"] = signRequest({ secret, method, path, timestamp, body: raw });
  const res = await fetch(app.url + path, {
    method,
    headers: { ...requestHeaders, ...headers },
    body: method === "GET" ? undefined : raw,
  });
  return { status: res.status, headers: res.headers, json: await res.json() };
}

before(async () => {
  telegram = await startFakeTelegram();
});
after(() => telegram.close());

beforeEach(async () => {
  telegram.calls.length = 0;
  telegram.respond = () => ({ status: 200, json: { ok: true, result: { message_id: 42 } } });
  app = await startApp();
});
afterEach(() => app.close());

describe("caller authentication", () => {
  it("rejects a request without a signature", async () => {
    const res = await call(validBody(), { sign: false });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, "unauthorized");
    assert.equal(telegram.calls.length, 0);
  });

  it("rejects a wrong secret", async () => {
    const res = await call(validBody(), { secret: "x".repeat(40) });
    assert.equal(res.status, 401);
  });

  it("rejects an unknown client id", async () => {
    const res = await call(validBody(), { clientId: "browser" });
    assert.equal(res.status, 401);
  });

  it("rejects a stale timestamp", async () => {
    const res = await call(validBody(), { timestamp: Math.floor(Date.now() / 1000) - 120 });
    assert.equal(res.status, 401);
  });

  it("rejects a body changed after signing", async () => {
    const body = validBody();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signRequest({ secret: SECRET, method: "POST", path: OTP_PATH, timestamp, body: JSON.stringify(body) });
    const res = await call({ ...body, telegramUserId: "999" }, { sign: false, timestamp, headers: { "x-signature": signature } });
    assert.equal(res.status, 401);
    assert.equal(telegram.calls.length, 0);
  });

  it("accepts the previous secret during rotation", async () => {
    const res = await call(validBody(), { secret: PREVIOUS_SECRET });
    assert.equal(res.status, 200);
  });
});

describe("request validation", () => {
  it("rejects malformed JSON", async () => {
    const res = await call("{not json");
    assert.equal(res.status, 400);
  });

  it("rejects unknown fields, missing fields and a bad code without echoing values", async () => {
    const { telegramUserId, ...rest } = validBody();
    const res = await call({ ...rest, code: "12ab", chatId: "555" });
    assert.equal(res.status, 400);
    assert.deepEqual(
      res.json.error.details.map((d) => d.field).sort(),
      ["chatId", "code", "telegramUserId"]
    );
    assert.ok(!JSON.stringify(res.json).includes("12ab"));
  });

  it("rejects a numeric telegramUserId", async () => {
    const res = await call(validBody({ telegramUserId: 123456789 }));
    assert.equal(res.status, 400);
  });

  it("rejects an expired challenge", async () => {
    const res = await call(validBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, "challenge_expired");
    assert.equal(telegram.calls.length, 0);
  });

  it("rejects an expiry too far ahead", async () => {
    const res = await call(validBody({ expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() }));
    assert.equal(res.status, 400);
  });

  it("rejects a non-JSON content type", async () => {
    const res = await call(validBody(), { headers: { "content-type": "text/plain" } });
    assert.equal(res.status, 415);
  });

  it("rejects an oversized body", async () => {
    const res = await call(validBody({ userId: "u".repeat(5000) }));
    assert.equal(res.status, 413);
  });

  it("rejects other methods and paths", async () => {
    assert.equal((await call("", { method: "GET" })).status, 405);
    assert.equal((await call(validBody(), { path: "/internal/v1/telegram/message" })).status, 404);
  });
});

describe("OTP delivery", () => {
  it("sends the code to the signed recipient and never stores or logs it", async () => {
    const body = validBody();
    const res = await call(body, { headers: { "x-request-id": "req-123" } });

    assert.equal(res.status, 200);
    assert.equal(res.json.status, "sent");
    assert.equal(res.json.attempts, 1);
    assert.equal(res.json.duplicate, false);
    assert.equal(res.json.requestId, "req-123");
    assert.equal(res.headers.get("x-request-id"), "req-123");

    assert.equal(telegram.calls.length, 1);
    assert.equal(telegram.calls[0].path, `/bot${TOKEN}/sendMessage`);
    assert.equal(telegram.calls[0].body.chat_id, body.telegramUserId);
    assert.equal(telegram.calls[0].body.protect_content, true);
    assert.match(telegram.calls[0].body.text, new RegExp(body.code));

    const stored = app.store.deliveries.get(body.challengeId);
    assert.equal(stored.status, "sent");
    assert.equal(stored.telegramMessageId, 42);
    for (const text of [JSON.stringify(res.json), JSON.stringify([...app.store.deliveries.values()]), JSON.stringify(app.store.attempts), JSON.stringify(app.logs)]) {
      assert.ok(!text.includes(body.code), "code leaked");
      assert.ok(!text.includes(TOKEN), "token leaked");
    }
  });

  it("does not send twice for a repeated challenge", async () => {
    const body = validBody();
    await call(body);
    const res = await call(body);
    assert.equal(res.status, 200);
    assert.equal(res.json.duplicate, true);
    assert.equal(telegram.calls.length, 1);
  });

  it("handles concurrent duplicates with a single send", async () => {
    const body = validBody();
    const results = await Promise.all([call(body), call(body), call(body)]);
    assert.equal(telegram.calls.length, 1);
    assert.ok(results.every((r) => [200, 202].includes(r.status)));
  });

  it("rejects a reused challengeId with different details", async () => {
    const body = validBody();
    await call(body);
    const res = await call({ ...body, userId: "someone-else" });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "challenge_conflict");
    assert.equal(telegram.calls.length, 1);
  });

  it("reports a blocked recipient without retrying", async () => {
    telegram.respond = () => ({
      status: 403,
      json: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
    });
    const res = await call(validBody());
    assert.equal(res.status, 422);
    assert.equal(res.json.status, "failed");
    assert.equal(res.json.error.code, "recipient_unavailable");
    assert.equal(telegram.calls.length, 1);
  });

  it("reports chat not found as recipient unavailable", async () => {
    telegram.respond = () => ({ status: 400, json: { ok: false, error_code: 400, description: "Bad Request: chat not found" } });
    const res = await call(validBody());
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, "recipient_unavailable");
  });

  it("retries a transient Telegram error and then succeeds", async () => {
    telegram.respond = (_call, n) =>
      n === 1
        ? { status: 502, json: { ok: false, error_code: 502, description: "Bad Gateway" } }
        : { status: 200, json: { ok: true, result: { message_id: 7 } } };
    const res = await call(validBody());
    assert.equal(res.status, 200);
    assert.equal(res.json.attempts, 2);
    assert.deepEqual(app.store.attempts.map((a) => a.outcome), ["transient_error", "sent"]);
  });

  it("stops after the maximum number of attempts", async () => {
    telegram.respond = () => ({ status: 500, json: { ok: false, error_code: 500, description: "Internal" } });
    const res = await call(validBody());
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, "telegram_unavailable");
    assert.equal(telegram.calls.length, 3);
  });

  it("treats a slow Telegram API as a timeout", async () => {
    telegram.respond = () => ({ status: 200, delayMs: 1000, json: { ok: true, result: { message_id: 1 } } });
    await app.close();
    app = await startApp({ maxAttempts: 2 });
    const body = validBody();
    const res = await call(body);
    assert.equal(res.status, 503);
    assert.equal(app.store.deliveries.get(body.challengeId).lastErrorCode, "timeout");
    assert.equal(telegram.calls.length, 2);
  });

  it("does not wait out a long Telegram retry_after", async () => {
    telegram.respond = () => ({
      status: 429,
      json: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 30 } },
    });
    const res = await call(validBody());
    assert.equal(res.status, 503);
    assert.equal(telegram.calls.length, 1);
  });

  it("flags an invalid bot token for operators", async () => {
    telegram.respond = () => ({ status: 401, json: { ok: false, error_code: 401, description: "Unauthorized" } });
    const res = await call(validBody());
    assert.equal(res.status, 502);
    assert.equal(res.json.error.code, "delivery_failed");
    assert.ok(app.logs.some((l) => l.event === "telegram_bot_unauthorized"));
  });
});

describe("rate limiting", () => {
  it("limits requests per client", async () => {
    await app.close();
    app = await startApp({ clientRateLimit: 2 });
    await call(validBody());
    await call(validBody());
    const res = await call(validBody());
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) > 0);
  });

  it("limits new codes per recipient but still answers duplicates", async () => {
    await app.close();
    app = await startApp({ recipientRateLimit: 1 });
    const first = validBody();
    await call(first);
    assert.equal((await call(validBody())).status, 429);
    assert.equal((await call(first)).status, 200);
    assert.equal(telegram.calls.length, 1);
  });
});
