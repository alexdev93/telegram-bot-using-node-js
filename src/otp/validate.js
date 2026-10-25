const { HttpError } = require("../internal/http");
const { MAX_CLOCK_SKEW_MS } = require("../internal/auth");

const PURPOSES = ["login"];
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const FIELDS = {
  challengeId: (v) => typeof v === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(v),
  userId: (v) => typeof v === "string" && /^[A-Za-z0-9_.:@-]{1,128}$/.test(v),
  // A string, because JSON numbers lose precision past 2^53
  telegramUserId: (v) =>
    typeof v === "string" && /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v)),
  code: (v) => typeof v === "string" && /^\d{4,8}$/.test(v),
  expiresAt: (v) => typeof v === "string" && ISO_8601.test(v) && !Number.isNaN(Date.parse(v)),
  purpose: (v) => PURPOSES.includes(v),
};

// Error details name the field only, never echo the submitted value
function invalid(details) {
  return new HttpError(400, "invalid_request", "Request body failed validation", { details });
}

function validateOtpRequest(input, { nowMs, maxTtlSeconds }) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalid([{ field: "(body)", issue: "must be a JSON object" }]);
  }

  const details = [];
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(FIELDS, key)) details.push({ field: key.slice(0, 64), issue: "unknown field" });
  }
  for (const [field, isValid] of Object.entries(FIELDS)) {
    if (input[field] === undefined) details.push({ field, issue: "required" });
    else if (!isValid(input[field])) details.push({ field, issue: "invalid" });
  }
  if (details.length) throw invalid(details);

  const expiresAt = new Date(input.expiresAt);
  if (expiresAt.getTime() <= nowMs) {
    throw new HttpError(422, "challenge_expired", "The challenge has already expired");
  }
  if (expiresAt.getTime() > nowMs + maxTtlSeconds * 1000 + MAX_CLOCK_SKEW_MS) {
    throw invalid([{ field: "expiresAt", issue: `must be at most ${maxTtlSeconds} seconds ahead` }]);
  }

  return { ...input, expiresAt };
}

module.exports = { PURPOSES, validateOtpRequest };
