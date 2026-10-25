const crypto = require("crypto");
const { HttpError, readBody, sendJson } = require("./http");
const { verifyRequest } = require("./auth");
const { createRateLimiter } = require("./rateLimit");
const { validateOtpRequest } = require("../otp/validate");
const { deliverOtp } = require("../otp/delivery");
const defaultLog = require("../log");

const OTP_PATH = "/internal/v1/telegram/otp";
const MAX_BODY_BYTES = 4096;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const UNAVAILABLE = [503, "telegram_unavailable", "Telegram did not accept the message. Create a new challenge to retry"];
const RECIPIENT = [422, "recipient_unavailable", "The bot cannot message this recipient"];
// Stored error code -> HTTP status and the public error returned to the caller
const FAILURES = {
  recipient_blocked: RECIPIENT,
  recipient_not_found: RECIPIENT,
  challenge_expired: [422, "challenge_expired", "The challenge expired before the code was sent"],
  timeout: UNAVAILABLE,
  network: UNAVAILABLE,
  rate_limited: UNAVAILABLE,
  telegram_unavailable: UNAVAILABLE,
};
const DEFAULT_FAILURE = [502, "delivery_failed", "Telegram rejected the message"];

function toResponse({ delivery, duplicate }) {
  const base = { challengeId: delivery.challengeId, status: delivery.status, attempts: delivery.attempts, duplicate };
  if (delivery.status === "sent") {
    return { httpStatus: 200, body: { ...base, sentAt: new Date(delivery.sentAt).toISOString() } };
  }
  if (delivery.status === "pending") return { httpStatus: 202, body: base };
  const [httpStatus, code, message] = FAILURES[delivery.lastErrorCode] ?? DEFAULT_FAILURE;
  return { httpStatus, body: { ...base, error: { code, message } } };
}

function parseJson(body) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_request", "Body must be valid JSON");
  }
}

function createInternalApi({
  clients,
  store,
  sendMessage,
  maxAttempts = 3,
  clientRateLimit = 60,
  recipientRateLimit = 5,
  otpMaxTtlSeconds = 900,
  retryBaseDelayMs = 250,
  log = defaultLog,
  now = Date.now,
}) {
  const clientLimiter = createRateLimiter({ limit: clientRateLimit, windowMs: 60_000, now });
  const recipientLimiter = createRateLimiter({ limit: recipientRateLimit, windowMs: 10 * 60_000, now });

  return async function handleInternal(req, res) {
    const headerId = req.headers["x-request-id"];
    const requestId = REQUEST_ID_PATTERN.test(headerId ?? "") ? headerId : crypto.randomUUID();
    const startedAt = now();
    const context = { requestId };
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");

    try {
      if (req.url !== OTP_PATH) throw new HttpError(404, "not_found", "Not found");
      if (req.method !== "POST") {
        throw new HttpError(405, "method_not_allowed", "Use POST", { headers: { Allow: "POST" } });
      }
      if (!/^application\/json(;|$)/i.test(req.headers["content-type"] ?? "")) {
        throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
      }

      const body = await readBody(req, MAX_BODY_BYTES);
      context.clientId = verifyRequest({
        clients,
        headers: req.headers,
        method: req.method,
        path: req.url,
        body,
        nowMs: now(),
      });

      const limit = clientLimiter.take(context.clientId);
      if (!limit.allowed) {
        throw new HttpError(429, "rate_limited", "Too many requests", {
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
          reason: "client_limit",
        });
      }

      const request = validateOtpRequest(parseJson(body), { nowMs: now(), maxTtlSeconds: otpMaxTtlSeconds });
      context.challengeId = request.challengeId;

      const outcome = await deliverOtp(request, {
        clientId: context.clientId,
        store,
        sendMessage,
        recipientLimiter,
        maxAttempts,
        retryBaseDelayMs,
        now,
        log,
      });
      const { httpStatus, body: responseBody } = toResponse(outcome);
      sendJson(res, httpStatus, { requestId, ...responseBody });
      log.info("otp_request_completed", {
        ...context,
        httpStatus,
        status: outcome.delivery.status,
        errorCode: outcome.delivery.lastErrorCode ?? undefined,
        attempts: outcome.delivery.attempts,
        duplicate: outcome.duplicate,
        durationMs: now() - startedAt,
      });
    } catch (caught) {
      let err = caught;
      if (err instanceof HttpError) {
        log.warn("otp_request_rejected", { ...context, httpStatus: err.status, code: err.code, reason: err.reason });
      } else {
        // Unexpected errors come from the store; none of these messages contain the code
        log.error("otp_request_failed", { ...context, error: err.name, message: err.message, pgCode: err.code });
        err = new HttpError(500, "internal_error", "Internal error");
      }
      if (res.headersSent) return res.end();
      sendJson(
        res,
        err.status,
        { requestId, error: { code: err.code, message: err.message, details: err.details } },
        err.headers
      );
    }
  };
}

// Used when the internal API is not configured, so callers get a clear answer
function notConfigured(req, res) {
  sendJson(res, 503, { error: { code: "not_configured", message: "Internal API is not configured" } });
}

module.exports = { OTP_PATH, MAX_BODY_BYTES, createInternalApi, notConfigured };
