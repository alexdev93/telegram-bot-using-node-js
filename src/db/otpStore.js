// Bot-owned delivery records. OTP codes are never written here
const COLUMNS = `id, challenge_id, client_id, user_id, purpose, request_fingerprint,
  status, attempts, last_error_code, expires_at, created_at, sent_at`;

function createPool(connectionString) {
  // Loaded lazily so the bot and the tests run without the pg package installed
  const { Pool } = require("pg");
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5000,
  });
}

function toDelivery(row) {
  if (!row) return null;
  return {
    id: row.id,
    challengeId: row.challenge_id,
    clientId: row.client_id,
    userId: row.user_id,
    purpose: row.purpose,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

function createOtpStore(pool) {
  return {
    async findByChallengeId(challengeId) {
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM otp_deliveries WHERE challenge_id = $1`,
        [challengeId]
      );
      return toDelivery(rows[0]);
    },

    // Returns null when the challenge already exists (the unique constraint decides races)
    async insertPending({ challengeId, clientId, userId, telegramUserId, purpose, requestFingerprint, expiresAt }) {
      const { rows } = await pool.query(
        `INSERT INTO otp_deliveries
           (challenge_id, client_id, user_id, telegram_user_id, purpose, request_fingerprint, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (challenge_id) DO NOTHING
         RETURNING ${COLUMNS}`,
        [challengeId, clientId, userId, telegramUserId, purpose, requestFingerprint, expiresAt]
      );
      return toDelivery(rows[0]);
    },

    async recordAttempt(deliveryId, { attemptNumber, outcome, errorCode, telegramErrorCode, durationMs }) {
      await pool.query(
        `INSERT INTO otp_delivery_attempts
           (delivery_id, attempt_number, outcome, error_code, telegram_error_code, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [deliveryId, attemptNumber, outcome, errorCode, telegramErrorCode, durationMs]
      );
    },

    async finish(deliveryId, { status, attempts, lastErrorCode = null, telegramMessageId = null, sentAt = null }) {
      const { rows } = await pool.query(
        `UPDATE otp_deliveries
         SET status = $2, attempts = $3, last_error_code = $4, telegram_message_id = $5,
             sent_at = $6, updated_at = now()
         WHERE id = $1
         RETURNING ${COLUMNS}`,
        [deliveryId, status, attempts, lastErrorCode, telegramMessageId, sentAt]
      );
      return toDelivery(rows[0]);
    },
  };
}

module.exports = { createPool, createOtpStore };
