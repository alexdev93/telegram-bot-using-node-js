const crypto = require("crypto");
const { HttpError } = require("../internal/http");

const MAX_RETRY_DELAY_MS = 5000;
const PURPOSE_LABELS = { login: "login" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Identifies "the same request" for idempotency. The code is deliberately left out
// so nothing derived from it is stored
function fingerprint({ clientId, userId, telegramUserId, purpose, expiresAt }) {
  return crypto
    .createHash("sha256")
    .update([clientId, userId, telegramUserId, purpose, expiresAt.toISOString()].join("\n"))
    .digest("hex");
}

function buildMessage({ telegramUserId, code, purpose, expiresAt }, nowMs) {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - nowMs) / 60_000));
  return {
    chat_id: telegramUserId,
    text:
      `Your ${PURPOSE_LABELS[purpose]} code: <code>${code}</code>\n\n` +
      `It expires in ${minutes} min. Never share this code with anyone.`,
    parse_mode: "HTML",
    protect_content: true,
  };
}

function asDuplicate(existing, requestFingerprint) {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new HttpError(409, "challenge_conflict", "This challengeId was already used for a different request");
  }
  return { delivery: existing, duplicate: true };
}

// Sends the code at most once per challengeId. Repeated requests get the stored outcome
async function deliverOtp(request, deps) {
  const { clientId, store, sendMessage, recipientLimiter, maxAttempts, retryBaseDelayMs, now, log } = deps;
  const requestFingerprint = fingerprint({ clientId, ...request });

  const existing = await store.findByChallengeId(request.challengeId);
  if (existing) return asDuplicate(existing, requestFingerprint);

  const limit = recipientLimiter.take(request.telegramUserId);
  if (!limit.allowed) {
    throw new HttpError(429, "rate_limited", "Too many codes requested for this recipient", {
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
      reason: "recipient_limit",
    });
  }

  const { challengeId, userId, telegramUserId, purpose, expiresAt } = request;
  const delivery = await store.insertPending({
    challengeId,
    clientId,
    userId,
    telegramUserId,
    purpose,
    requestFingerprint,
    expiresAt,
  });
  // Another request for the same challenge got in first
  if (!delivery) return asDuplicate(await store.findByChallengeId(request.challengeId), requestFingerprint);

  const payload = buildMessage(request, now());
  let attempts = 0;
  let result;

  while (true) {
    if (now() >= request.expiresAt.getTime()) {
      result = { ok: false, errorCode: "challenge_expired" };
      break;
    }

    attempts++;
    const startedAt = now();
    result = await sendMessage(payload);
    await store.recordAttempt(delivery.id, {
      attemptNumber: attempts,
      outcome: result.ok ? "sent" : result.permanent ? "permanent_error" : "transient_error",
      errorCode: result.errorCode ?? null,
      telegramErrorCode: result.telegramErrorCode ?? null,
      durationMs: now() - startedAt,
    });

    if (result.ok || result.permanent || attempts >= maxAttempts) break;

    const delayMs = result.retryAfterSeconds
      ? result.retryAfterSeconds * 1000
      : retryBaseDelayMs * 2 ** (attempts - 1);
    if (delayMs > MAX_RETRY_DELAY_MS || now() + delayMs >= request.expiresAt.getTime()) break;
    await sleep(delayMs);
  }

  if (result.errorCode === "bot_unauthorized") {
    log.error("telegram_bot_unauthorized", { challengeId: request.challengeId });
  }

  const finished = await store.finish(
    delivery.id,
    result.ok
      ? { status: "sent", attempts, telegramMessageId: result.messageId, sentAt: new Date(now()) }
      : { status: "failed", attempts, lastErrorCode: result.errorCode }
  );
  return { delivery: finished, duplicate: false };
}

module.exports = { deliverOtp, fingerprint, buildMessage };
