// In-memory stand-in for src/db/otpStore.js with the same interface
function createMemoryStore() {
  const deliveries = new Map();
  const attempts = [];
  let nextId = 1;

  return {
    deliveries,
    attempts,

    async findByChallengeId(challengeId) {
      const row = deliveries.get(challengeId);
      return row ? { ...row } : null;
    },

    async insertPending({ challengeId, clientId, userId, telegramUserId, purpose, requestFingerprint, expiresAt }) {
      if (deliveries.has(challengeId)) return null;
      const row = {
        id: String(nextId++),
        challengeId,
        clientId,
        userId,
        telegramUserId,
        purpose,
        requestFingerprint,
        status: "pending",
        attempts: 0,
        lastErrorCode: null,
        telegramMessageId: null,
        expiresAt,
        createdAt: new Date(),
        sentAt: null,
      };
      deliveries.set(challengeId, row);
      return { ...row };
    },

    async recordAttempt(deliveryId, attempt) {
      attempts.push({ deliveryId, ...attempt });
    },

    async finish(deliveryId, { status, attempts: count, lastErrorCode = null, telegramMessageId = null, sentAt = null }) {
      const row = [...deliveries.values()].find((d) => d.id === deliveryId);
      Object.assign(row, { status, attempts: count, lastErrorCode, telegramMessageId, sentAt });
      return { ...row };
    },
  };
}

module.exports = { createMemoryStore };
