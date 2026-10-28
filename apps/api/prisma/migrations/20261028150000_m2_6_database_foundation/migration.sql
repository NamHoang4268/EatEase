-- Fail before changing the schema if legacy data violates the M2.4/M2.5 baseline.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "guest_session"
        WHERE "table_session_id" IS NOT NULL OR "access_level" = 'ORDER_ENABLED'
    ) THEN
        RAISE EXCEPTION 'M2.6 requires existing guest sessions to be browse-only and unlinked';
    END IF;
END
$$;

CREATE TYPE "table_session_status" AS ENUM ('ACTIVE', 'CHECKOUT_LOCKED', 'CLOSED', 'CANCELLED');
CREATE TYPE "bill_status" AS ENUM ('OPEN', 'PAYMENT_PENDING', 'SETTLED', 'VOID');
CREATE TYPE "audit_actor_type" AS ENUM ('STAFF_MEMBERSHIP', 'GUEST_SESSION');

CREATE UNIQUE INDEX "activation_request_id_scope_key"
ON "activation_request"("id", "restaurant_id", "location_id", "table_id");

ALTER TABLE "guest_session"
    ADD COLUMN "previous_token_hash" CHAR(64),
    ADD COLUMN "previous_csrf_token_hash" CHAR(64),
    ADD COLUMN "previous_token_valid_until" TIMESTAMPTZ(3);

CREATE TABLE "table_session" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "activation_request_id" UUID NOT NULL,
    "status" "table_session_status" NOT NULL DEFAULT 'ACTIVE',
    "activated_by_membership_id" UUID NOT NULL,
    "activated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkout_locked_at" TIMESTAMPTZ(3),
    "closed_by_membership_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "close_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "table_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bill" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "status" "bill_status" NOT NULL DEFAULT 'OPEN',
    "subtotal_amount" BIGINT NOT NULL DEFAULT 0,
    "adjustment_amount" BIGINT NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "paid_amount" BIGINT NOT NULL DEFAULT 0,
    "balance_amount" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "bill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(96) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(96) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" UUID NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "guest_session"
    ADD CONSTRAINT "guest_session_previous_token_hash_format_check" CHECK (
        "previous_token_hash" IS NULL OR "previous_token_hash" ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT "guest_session_previous_csrf_hash_format_check" CHECK (
        "previous_csrf_token_hash" IS NULL OR "previous_csrf_token_hash" ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT "guest_session_previous_credentials_complete_check" CHECK (
        ("previous_token_hash" IS NULL AND "previous_csrf_token_hash" IS NULL AND "previous_token_valid_until" IS NULL)
        OR
        ("previous_token_hash" IS NOT NULL AND "previous_csrf_token_hash" IS NOT NULL AND "previous_token_valid_until" IS NOT NULL)
    ),
    ADD CONSTRAINT "guest_session_previous_token_rotated_check" CHECK (
        "previous_token_hash" IS NULL OR "previous_token_hash" <> "token_hash"
    ),
    ADD CONSTRAINT "guest_session_previous_csrf_rotated_check" CHECK (
        "previous_csrf_token_hash" IS NULL OR "previous_csrf_token_hash" <> "csrf_token_hash"
    ),
    ADD CONSTRAINT "guest_session_order_access_session_check" CHECK (
        "access_level" <> 'ORDER_ENABLED' OR "table_session_id" IS NOT NULL
    );

ALTER TABLE "table_session"
    ADD CONSTRAINT "table_session_version_nonnegative_check" CHECK ("version" >= 0),
    ADD CONSTRAINT "table_session_lifecycle_fields_check" CHECK (
        ("status" = 'ACTIVE' AND "checkout_locked_at" IS NULL AND "closed_by_membership_id" IS NULL AND "closed_at" IS NULL AND "close_reason" IS NULL)
        OR
        ("status" = 'CHECKOUT_LOCKED' AND "checkout_locked_at" IS NOT NULL AND "closed_by_membership_id" IS NULL AND "closed_at" IS NULL AND "close_reason" IS NULL)
        OR
        ("status" = 'CLOSED' AND "checkout_locked_at" IS NOT NULL AND "closed_by_membership_id" IS NOT NULL AND "closed_at" IS NOT NULL AND btrim("close_reason") <> '')
        OR
        ("status" = 'CANCELLED' AND "checkout_locked_at" IS NULL AND "closed_by_membership_id" IS NOT NULL AND "closed_at" IS NOT NULL AND btrim("close_reason") <> '')
    ),
    ADD CONSTRAINT "table_session_timeline_check" CHECK (
        ("checkout_locked_at" IS NULL OR "checkout_locked_at" >= "activated_at")
        AND ("closed_at" IS NULL OR "closed_at" >= "activated_at")
    );

ALTER TABLE "bill"
    ADD CONSTRAINT "bill_subtotal_nonnegative_check" CHECK ("subtotal_amount" >= 0),
    ADD CONSTRAINT "bill_total_nonnegative_check" CHECK ("total_amount" >= 0),
    ADD CONSTRAINT "bill_paid_nonnegative_check" CHECK ("paid_amount" >= 0),
    ADD CONSTRAINT "bill_balance_nonnegative_check" CHECK ("balance_amount" >= 0),
    ADD CONSTRAINT "bill_total_consistency_check" CHECK ("total_amount" = "subtotal_amount" + "adjustment_amount"),
    ADD CONSTRAINT "bill_balance_consistency_check" CHECK ("balance_amount" = "total_amount" - "paid_amount"),
    ADD CONSTRAINT "bill_settled_balance_check" CHECK ("status" <> 'SETTLED' OR "balance_amount" = 0),
    ADD CONSTRAINT "bill_version_nonnegative_check" CHECK ("version" >= 0);

ALTER TABLE "outbox_event"
    ADD CONSTRAINT "outbox_event_aggregate_type_nonempty_check" CHECK (btrim("aggregate_type") <> ''),
    ADD CONSTRAINT "outbox_event_event_type_nonempty_check" CHECK (btrim("event_type") <> ''),
    ADD CONSTRAINT "outbox_event_attempt_count_nonnegative_check" CHECK ("attempt_count" >= 0),
    ADD CONSTRAINT "outbox_event_published_timeline_check" CHECK ("published_at" IS NULL OR "published_at" >= "occurred_at"),
    ADD CONSTRAINT "outbox_event_retry_timeline_check" CHECK ("next_attempt_at" IS NULL OR "next_attempt_at" >= "occurred_at");

ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_action_nonempty_check" CHECK (btrim("action") <> ''),
    ADD CONSTRAINT "audit_log_resource_type_nonempty_check" CHECK (btrim("resource_type") <> '');

CREATE UNIQUE INDEX "guest_session_previous_token_hash_key" ON "guest_session"("previous_token_hash");
CREATE UNIQUE INDEX "table_session_activation_request_id_key" ON "table_session"("activation_request_id");
CREATE UNIQUE INDEX "table_session_id_location_scope_key" ON "table_session"("id", "restaurant_id", "location_id");
CREATE UNIQUE INDEX "table_session_id_table_scope_key" ON "table_session"("id", "restaurant_id", "location_id", "table_id");
CREATE UNIQUE INDEX "table_session_activation_scope_key" ON "table_session"("activation_request_id", "restaurant_id", "location_id", "table_id");
CREATE UNIQUE INDEX "table_session_one_active_per_table_idx" ON "table_session"("table_id") WHERE "status" IN ('ACTIVE', 'CHECKOUT_LOCKED');
CREATE INDEX "table_session_location_status_activated_idx" ON "table_session"("location_id", "status", "activated_at");
CREATE UNIQUE INDEX "bill_table_session_id_key" ON "bill"("table_session_id");
CREATE UNIQUE INDEX "bill_table_session_scope_key" ON "bill"("table_session_id", "restaurant_id", "location_id");
CREATE INDEX "bill_location_status_idx" ON "bill"("location_id", "status");
CREATE INDEX "outbox_event_aggregate_occurred_idx" ON "outbox_event"("aggregate_type", "aggregate_id", "occurred_at");
CREATE INDEX "outbox_event_unpublished_retry_idx" ON "outbox_event"("next_attempt_at", "occurred_at") WHERE "published_at" IS NULL;
CREATE INDEX "audit_log_scope_created_idx" ON "audit_log"("restaurant_id", "location_id", "created_at");
CREATE INDEX "audit_log_resource_created_idx" ON "audit_log"("resource_type", "resource_id", "created_at");
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log"("actor_type", "actor_id", "created_at");

ALTER TABLE "table_session" ADD CONSTRAINT "table_session_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_session" ADD CONSTRAINT "table_session_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_session" ADD CONSTRAINT "table_session_table_scope_fkey" FOREIGN KEY ("table_id", "restaurant_id", "location_id") REFERENCES "restaurant_table"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_session" ADD CONSTRAINT "table_session_activation_scope_fkey" FOREIGN KEY ("activation_request_id", "restaurant_id", "location_id", "table_id") REFERENCES "activation_request"("id", "restaurant_id", "location_id", "table_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_session" ADD CONSTRAINT "table_session_activator_scope_fkey" FOREIGN KEY ("activated_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_session" ADD CONSTRAINT "table_session_closer_scope_fkey" FOREIGN KEY ("closed_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guest_session" ADD CONSTRAINT "guest_session_table_session_scope_fkey" FOREIGN KEY ("table_session_id", "restaurant_id", "location_id", "table_id") REFERENCES "table_session"("id", "restaurant_id", "location_id", "table_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill" ADD CONSTRAINT "bill_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill" ADD CONSTRAINT "bill_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill" ADD CONSTRAINT "bill_table_session_scope_fkey" FOREIGN KEY ("table_session_id", "restaurant_id", "location_id") REFERENCES "table_session"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
