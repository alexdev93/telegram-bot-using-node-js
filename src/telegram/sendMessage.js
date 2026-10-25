const TELEGRAM_API_ROOT = "https://api.telegram.org";

const transient = (errorCode, extra) => ({ ok: false, permanent: false, errorCode, ...extra });
const permanent = (errorCode, extra) => ({ ok: false, permanent: true, errorCode, ...extra });

// Maps a Bot API response to a delivery result.
// Descriptions are matched only to tell "chat not found" from other 400s
function classify(httpStatus, data) {
  if (data?.ok === true && data.result) return { ok: true, messageId: data.result.message_id };

  const telegramErrorCode = Number.isInteger(data?.error_code) ? data.error_code : httpStatus;
  const extra = { telegramErrorCode };
  const description = typeof data?.description === "string" ? data.description : "";

  if (telegramErrorCode === 429) {
    return transient("rate_limited", { ...extra, retryAfterSeconds: data?.parameters?.retry_after });
  }
  if (telegramErrorCode >= 500) return transient("telegram_unavailable", extra);
  // Blocked by the user, user deactivated, or the user never started the bot
  if (telegramErrorCode === 403) return permanent("recipient_blocked", extra);
  if (telegramErrorCode === 400 && /chat not found|user not found/i.test(description)) {
    return permanent("recipient_not_found", extra);
  }
  if (telegramErrorCode === 401 || telegramErrorCode === 404) return permanent("bot_unauthorized", extra);
  return permanent("telegram_rejected", extra);
}

// Calls sendMessage over HTTPS directly rather than through Telegraf, whose debug
// output prints request payloads (and so the OTP) when DEBUG=telegraf:* is set.
// Never throws: network failures and timeouts come back as transient results
function createSendMessage({ token, timeoutMs, apiRoot = TELEGRAM_API_ROOT }) {
  const url = `${apiRoot}/bot${token}/sendMessage`;

  return async function sendMessage(payload) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json().catch((err) => {
        if (err.name === "TimeoutError" || err.name === "AbortError") throw err;
        return undefined;
      });
      return classify(res.status, data);
    } catch (err) {
      // Error objects may carry the request URL, which contains the token, so only the name is used
      const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
      return transient(timedOut ? "timeout" : "network");
    }
  };
}

module.exports = { createSendMessage, classify };
