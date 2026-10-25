const { signRequest } = require("../internal/auth");
const defaultLog = require("../log");

const BOT_ACCESS_PATH = "/api/internal/v1/telegram/bot-access";
const MIN_SECRET_LENGTH = 32;
const MAX_RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 2xx is done; 429, 5xx, timeouts and network errors are worth another attempt; other 4xx are not
async function post(url, headers, body, timeoutMs) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => undefined);
    const retryAfter = Number(res.headers.get("retry-after"));
    return {
      ok: res.ok,
      httpStatus: res.status,
      retryable: res.status === 429 || res.status >= 500,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      duplicate: data?.duplicate,
      applied: data?.applied,
    };
  } catch (err) {
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    return { ok: false, retryable: true, error: timedOut ? "timeout" : "network" };
  }
}

// Reports bot-access events to the auth service with the same v1 signature the auth service
// uses towards us. Never throws, so a slow or failing auth service can't break update handling
function createBotAccessReporter({
  authServiceUrl,
  clientId,
  secret,
  timeoutMs = 5000,
  maxAttempts = 3,
  retryBaseDelayMs = 250,
  log = defaultLog,
  now = Date.now,
}) {
  const problems = [];
  if (!authServiceUrl) problems.push("AUTH_SERVICE_URL is not set (or not https)");
  if (!secret) problems.push("BOT_EVENTS_SECRET is not set");
  else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`BOT_EVENTS_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (problems.length) {
    console.warn(`Bot-access events disabled: ${problems.join("; ")}`);
    return {
      enabled: false,
      async report(event) {
        log.warn("bot_access_event_skipped", { eventId: event.eventId, reason: "not_configured" });
        return { ok: false, skipped: true };
      },
    };
  }

  const url = authServiceUrl + BOT_ACCESS_PATH;

  return {
    enabled: true,
    // `event` holds a Telegram user id, which is personal data: it is sent, never logged
    async report(event) {
      const body = JSON.stringify(event);
      const fields = { eventId: event.eventId, status: event.status, source: event.source };
      for (let attempt = 1; ; attempt++) {
        const timestamp = Math.floor(now() / 1000);
        const headers = {
          "Content-Type": "application/json",
          "X-Client-Id": clientId,
          "X-Timestamp": String(timestamp),
          "X-Signature": signRequest({ secret, method: "POST", path: BOT_ACCESS_PATH, timestamp, body }),
          "X-Request-Id": event.eventId,
        };
        const result = await post(url, headers, body, timeoutMs);
        const outcome = { ...fields, attempts: attempt, httpStatus: result.httpStatus, error: result.error };

        if (result.ok) {
          log.info("bot_access_event_reported", { ...outcome, duplicate: result.duplicate, applied: result.applied });
          return result;
        }
        const delayMs = result.retryAfterSeconds
          ? result.retryAfterSeconds * 1000
          : retryBaseDelayMs * 2 ** (attempt - 1);
        if (!result.retryable || attempt >= maxAttempts || delayMs > MAX_RETRY_DELAY_MS) {
          log.error("bot_access_event_failed", outcome);
          return result;
        }
        await sleep(delayMs);
      }
    },
  };
}

module.exports = { BOT_ACCESS_PATH, createBotAccessReporter };
