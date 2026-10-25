-- Bot-owned tables for OTP delivery idempotency and troubleshooting.
-- No OTP code (plain, hashed or encrypted) is stored.

CREATE TABLE otp_deliveries (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id        text        NOT NULL UNIQUE,
  client_id           text        NOT NULL,
  user_id             text        NOT NULL,
  telegram_user_id    bigint      NOT NULL,
  purpose             text        NOT NULL,
  -- sha256 of client, user, recipient, purpose and expiry; used to spot a reused challengeId
  request_fingerprint text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed')),
  attempts            integer     NOT NULL DEFAULT 0,
  last_error_code     text,
  telegram_message_id bigint,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

CREATE INDEX otp_deliveries_created_at_idx ON otp_deliveries (created_at);

CREATE TABLE otp_delivery_attempts (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id         bigint      NOT NULL REFERENCES otp_deliveries (id) ON DELETE CASCADE,
  attempt_number      integer     NOT NULL,
  outcome             text        NOT NULL
                        CHECK (outcome IN ('sent', 'transient_error', 'permanent_error')),
  error_code          text,
  telegram_error_code integer,
  duration_ms         integer     NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, attempt_number)
);
