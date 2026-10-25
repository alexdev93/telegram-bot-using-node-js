const crypto = require("crypto");
const { HttpError } = require("./http");

const MAX_CLOCK_SKEW_MS = 60_000;

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// HMAC-SHA256 over method, path, timestamp and body hash.
// The auth service must build exactly the same string, see the contract doc
function signRequest({ secret, method, path, timestamp, body }) {
  const canonical = ["v1", method.toUpperCase(), path, String(timestamp), sha256Hex(body)].join("\n");
  return `v1=${crypto.createHmac("sha256", secret).update(canonical).digest("hex")}`;
}

function unauthorized(reason) {
  return new HttpError(401, "unauthorized", "Missing or invalid request signature", { reason });
}

// Returns the authenticated client id or throws a 401.
// `clients` maps client id -> list of accepted secrets
function verifyRequest({ clients, headers, method, path, body, nowMs }) {
  const clientId = headers["x-client-id"];
  const timestamp = headers["x-timestamp"];
  const signature = headers["x-signature"];

  const secrets = typeof clientId === "string" ? clients.get(clientId) : undefined;
  if (!secrets) throw unauthorized("unknown_client");
  if (typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp)) throw unauthorized("bad_timestamp");
  if (Math.abs(nowMs - Number(timestamp) * 1000) > MAX_CLOCK_SKEW_MS) throw unauthorized("stale_timestamp");
  if (typeof signature !== "string") throw unauthorized("missing_signature");

  const given = Buffer.from(signature);
  const valid = secrets.some((secret) => {
    const expected = Buffer.from(signRequest({ secret, method, path, timestamp, body }));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  });
  if (!valid) throw unauthorized("bad_signature");

  return clientId;
}

module.exports = { MAX_CLOCK_SKEW_MS, signRequest, verifyRequest };
