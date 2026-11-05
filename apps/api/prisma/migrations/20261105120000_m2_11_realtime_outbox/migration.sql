-- Additive M2.11 foundation; existing events remain eligible. No financial data changes.
ALTER TABLE "outbox_event"
  ADD COLUMN "claim_token" UUID,
  ADD COLUMN "lease_until" TIMESTAMPTZ(3),
  ADD COLUMN "failed_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_error" VARCHAR(64),
  ADD CONSTRAINT "outbox_claim_pair_check" CHECK ((claim_token IS NULL) = (lease_until IS NULL));
CREATE INDEX "outbox_pending_delivery_idx" ON "outbox_event" (next_attempt_at, occurred_at, id)
  WHERE published_at IS NULL AND failed_at IS NULL;

CREATE TABLE "realtime_ticket" (
  id UUID PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('STAFF', 'GUEST')),
  actor_session_id UUID NOT NULL,
  restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  location_id UUID NOT NULL,
  audience VARCHAR(16) NOT NULL CHECK (audience IN ('kitchen', 'activation', 'sessions', 'bill')),
  resource_id UUID,
  origin VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  consumed_at TIMESTAMPTZ(3),
  CONSTRAINT realtime_ticket_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT realtime_ticket_guest_scope_check CHECK (actor_type <> 'GUEST' OR resource_id IS NOT NULL),
  CONSTRAINT realtime_ticket_audience_scope_check CHECK (
    (actor_type = 'STAFF' AND ((audience = 'bill' AND resource_id IS NOT NULL) OR (audience <> 'bill' AND resource_id IS NULL)))
    OR (actor_type = 'GUEST' AND audience IN ('activation', 'bill') AND resource_id IS NOT NULL)
  ),
  CONSTRAINT realtime_ticket_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT realtime_ticket_location_fkey FOREIGN KEY (location_id, restaurant_id)
    REFERENCES location(id, restaurant_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX realtime_ticket_actor_idx ON realtime_ticket(actor_type, actor_session_id);
CREATE INDEX realtime_ticket_expiry_idx ON realtime_ticket(expires_at);
