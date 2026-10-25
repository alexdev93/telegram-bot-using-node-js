# Telegram OTP delivery API — contract v1

| | |
|---|---|
| Status | **Proposed.** Built and tested in the bot service against a stub caller. Not yet implemented or approved by the auth service. |
| Version | v1 (path prefix `/internal/v1`, signature scheme `v1`) |
| Provider | Bot service (this repository) |
| Consumer | Auth service (`next-foundation`) |
| Last updated | 2026-10-25 |

Breaking changes get a new version (`/internal/v2`, signature `v2`). Both repositories should keep a copy of this file at the same version.

## 1. Who owns what

| Concern | Owner |
|---|---|
| Telegram login (OIDC), sessions, users | Auth service |
| Link between `userId` and a verified Telegram user ID | Auth service |
| Whether the user has allowed the bot to message them | Auth service |
| OTP generation, challenge lifecycle, verification, attempt limits | Auth service |
| Sending the message through the Bot API, retries, delivery records | Bot service |

The bot service never decides whether a code is correct, never stores codes, and never takes a recipient from a browser. It trusts the recipient in a request **only because the request is signed by the auth service**. The auth service is responsible for sending only a `telegramUserId` it has verified for that `userId`.

## 2. Endpoint

```
POST /internal/v1/telegram/otp
Content-Type: application/json
```

Production traffic must use HTTPS. The signature protects integrity and authenticity, but the body contains the code, so TLS is what keeps it confidential. Callers must not disable certificate verification.

### Headers

| Header | Required | Value |
|---|---|---|
| `X-Client-Id` | yes | Client id issued to the auth service (`BOT_SERVICE_CLIENT_ID`) |
| `X-Timestamp` | yes | Unix time in **seconds**. Must be within ±60 s of the bot service clock |
| `X-Signature` | yes | `v1=` + lowercase hex HMAC-SHA256, see below |
| `X-Request-Id` | no | Correlation id, `[A-Za-z0-9._-]{1,64}`. Echoed back; generated if absent |

### Signature

```
canonical = "v1" + "\n" + METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(RAW_BODY_BYTES))
signature = "v1=" + hex(hmac_sha256(secret, canonical))
```

- `METHOD` is upper case (`POST`). `PATH` is exactly `/internal/v1/telegram/otp` with no query string.
- Sign the exact bytes you send. Don't re-serialize the JSON after signing.

Reference implementation for the auth service (Node, server-only code):

```ts
import { createHash, createHmac } from "node:crypto"

export function signOtpRequest(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const path = "/internal/v1/telegram/otp"
  const bodyHash = createHash("sha256").update(body).digest("hex")
  const canonical = ["v1", "POST", path, String(timestamp), bodyHash].join("\n")
  return {
    "X-Timestamp": String(timestamp),
    "X-Signature": `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`,
  }
}
```

Secrets are at least 32 characters, live only in server-side environment variables on both sides, and must never use a `NEXT_PUBLIC_` prefix. To rotate: set the new secret as `BOT_SERVICE_CLIENT_SECRET` and the old one as `BOT_SERVICE_CLIENT_SECRET_PREVIOUS` on the bot service, switch the auth service to the new secret, then remove the previous one.

### Request body

Max 4096 bytes. Unknown fields are rejected.

```json
{
  "challengeId": "ch_6f1d2a9c8b7e4f30a1b2c3d4",
  "userId": "user-1",
  "telegramUserId": "123456789",
  "code": "482913",
  "expiresAt": "2026-10-25T12:05:00Z",
  "purpose": "login"
}
```

| Field | Rules |
|---|---|
| `challengeId` | `[A-Za-z0-9_-]{16,128}`. Opaque and unguessable. **This is the idempotency key** |
| `userId` | `[A-Za-z0-9_.:@-]{1,128}`. Auth service's internal user id (recorded for troubleshooting) |
| `telegramUserId` | Decimal **string**, a positive safe integer. The verified Telegram user id. For a private chat this is also the chat id |
| `code` | 4–8 ASCII digits |
| `expiresAt` | ISO-8601 with a timezone (`Z` or `±hh:mm`). Must be in the future and at most `OTP_MAX_TTL_SECONDS` (default 900) ahead |
| `purpose` | `"login"` (the only purpose in v1) |

### Message sent

`sendMessage` with `parse_mode: "HTML"` and `protect_content: true`:

> Your login code: `482913`
>
> It expires in 5 min. Never share this code with anyone.

## 3. Responses

Every response includes `requestId` and the `X-Request-Id` header. Responses never contain the code.

**`status: "sent"` means the Telegram Bot API accepted the message.** It does not prove that the message reached the user's device or that they read it.

| HTTP | Body `status` / `error.code` | Meaning | What the caller should do |
|---|---|---|---|
| 200 | `sent` | Telegram accepted the message | Show "code sent" |
| 202 | `pending` | Another request for this challenge is still in progress, or a previous attempt was interrupted | Treat as unknown. Offer the user a resend, which means a new challenge |
| 400 | `invalid_request` | Malformed body. `error.details` lists `{field, issue}` without values | Fix the caller |
| 401 | `unauthorized` | Bad or missing signature, unknown client, or clock skew | Check secret and clock |
| 404 / 405 / 413 / 415 | `not_found` / `method_not_allowed` / `payload_too_large` / `unsupported_media_type` | — | Fix the caller |
| 409 | `challenge_conflict` | `challengeId` already used with a different user, recipient, purpose or expiry | Use a fresh challengeId |
| 422 | `challenge_expired` | `expiresAt` already passed, or passed during retries | Create a new challenge |
| 422 | `recipient_unavailable` | Bot blocked, user never started the bot, or chat not found. Not retried | Tell the user to open the bot and press Start, or offer another method |
| 429 | `rate_limited` | Per-client (default 60/min) or per-recipient (default 5 per 10 min) limit. Has `Retry-After` | Back off |
| 502 | `delivery_failed` | Telegram rejected the message for another reason (including a bad bot token) | Alert. Don't retry automatically |
| 503 | `telegram_unavailable` | Telegram kept failing (timeout, network, 5xx, 429) until attempts ran out | New challenge, retry later |
| 503 | `not_configured` | Bot service is missing configuration | Alert the bot service owner |
| 500 | `internal_error` | Unexpected error (for example the database) | Retry with the **same** body once |

Example (200):

```json
{ "requestId": "req-123", "challengeId": "ch_…", "status": "sent", "attempts": 1, "duplicate": false, "sentAt": "2026-10-25T12:00:01.204Z" }
```

Example (422):

```json
{ "requestId": "…", "challengeId": "ch_…", "status": "failed", "attempts": 1, "duplicate": false,
  "error": { "code": "recipient_unavailable", "message": "The bot cannot message this recipient" } }
```

## 4. Idempotency and resends

- One `challengeId` produces **at most one delivery run**. Repeating the same request returns the stored outcome with `duplicate: true` and sends nothing.
- A repeated `challengeId` with a different `userId`, `telegramUserId`, `purpose` or `expiresAt` returns 409. A repeat that differs only in `code` is **not** detected (the bot service keeps nothing derived from the code). It returns the stored outcome and sends nothing.
- **"Resend code" = new challenge** (new `challengeId`, and normally a new code) on the auth side.
- The auth service can safely retry the exact same request after a network error or a 500.

## 5. Timeouts and retries

- Each Telegram call: `TELEGRAM_API_TIMEOUT_MS` (default 5 s). Up to `NOTIFICATION_MAX_ATTEMPTS` (default 3) attempts, for transient errors only. Backoff starts at 250 ms and doubles each attempt. Telegram's `retry_after` is honoured only if it is ≤ 5 s and ends before `expiresAt`.
- Worst case is about 16 s, so the **caller timeout should be about 20 s**.
- A timed-out Telegram call may still have been delivered. A retry can then produce a second copy of the same message with the same code. That is accepted for OTPs.

## 6. Data and database boundaries

The bot service owns two tables in its own database or schema (`migrations/001_create_otp_deliveries.sql`):

- `otp_deliveries`: challenge id, client id, user id, Telegram user id, purpose, request fingerprint (a sha256 that does not include the code), status, attempt count, last error code, Telegram message id, timestamps.
- `otp_delivery_attempts`: per-attempt outcome, error codes and duration.

No code, hashed code or token is stored. The bot service has no access to auth-service tables, and the auth service needs no access to these.

Suggested roles:

```sql
-- owner, used only by `npm run migrate`
CREATE ROLE bot_service_owner LOGIN PASSWORD '…';
-- runtime
CREATE ROLE bot_service LOGIN PASSWORD '…';
GRANT SELECT, INSERT, UPDATE ON otp_deliveries, otp_delivery_attempts TO bot_service;
```

Suggested retention: delete rows older than 30 days (`DELETE FROM otp_deliveries WHERE created_at < now() - interval '30 days'`; attempts cascade). This is not automated yet.

## 7. Changes requested from the auth service (needs owner approval)

State on 2026-10-25: no committed branch has any of this. Uncommitted work in progress in `next-foundation` adds Telegram OIDC login, Neon PostgreSQL with Drizzle, and a `telegram_identities` table with `telegram_user_id` (text, unique) and `bot_access_granted`. That covers items 1 and 2 in shape. Items 3–5 are not started.

1. **Telegram login and identity link** *(in progress)*. Store a verified Telegram user id per user, taken from the verified login response and never from client input. Send it as `telegramUserId`.
2. **Bot-messaging eligibility** *(in progress: `bot_access_granted`)*. Set it only from what the Telegram login flow actually returns (to be confirmed against the official docs). Only call this API when it is true. On `recipient_unavailable`, prompt the user to start the bot.
3. **OTP challenges.** Generate the code with a CSPRNG and an opaque `challengeId`. Store only a hash of the code. Enforce expiry and verification-attempt limits.
4. **Server-only client.** Call this endpoint from server code (`server/integrations/…`) with the signing helper above. Read `BOT_SERVICE_URL`, `BOT_SERVICE_CLIENT_ID` and `BOT_SERVICE_CLIENT_SECRET` through `src/server/config/env.ts`. Use a ~20 s timeout and HTTPS only.
5. **Error handling** as in section 3. Never forward Telegram details to the browser.

## 8. Open questions

- Exact fields and scopes of the Telegram login response that prove bot write access.
- Whether the bot service runs on Deno Deploy long term (affects PostgreSQL connectivity and whether in-memory rate limits are per isolate).
- Rate limits are per instance. With several instances, effective limits multiply. A shared limiter would need Postgres or Redis.
