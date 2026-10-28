-- CreateEnum
CREATE TYPE "activation_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "idempotency_actor_type" AS ENUM ('GUEST_SESSION', 'STAFF_MEMBERSHIP');

-- CreateEnum
CREATE TYPE "idempotency_record_status" AS ENUM ('COMPLETED');

-- Add scoped keys needed by activation relationships
CREATE UNIQUE INDEX "staff_membership_id_scope_key"
ON "staff_membership"("id", "restaurant_id", "location_id");

CREATE UNIQUE INDEX "guest_session_id_scope_key"
ON "guest_session"("id", "restaurant_id", "location_id", "table_id");

-- CreateTable
CREATE TABLE "activation_request" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "requester_guest_session_id" UUID NOT NULL,
    "status" "activation_request_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "handled_by_membership_id" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "actor_type" "idempotency_actor_type" NOT NULL,
    "actor_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "idempotency_record_status" NOT NULL DEFAULT 'COMPLETED',
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "resource_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraints
ALTER TABLE "activation_request"
    ADD CONSTRAINT "activation_request_expiry_after_creation_check" CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "activation_request_version_nonnegative_check" CHECK ("version" >= 0),
    ADD CONSTRAINT "activation_request_handling_fields_check" CHECK (
        ("status" IN ('PENDING', 'EXPIRED', 'CANCELLED') AND "handled_by_membership_id" IS NULL AND "handled_at" IS NULL AND "rejection_reason" IS NULL)
        OR
        ("status" = 'APPROVED' AND "handled_by_membership_id" IS NOT NULL AND "handled_at" IS NOT NULL AND "rejection_reason" IS NULL)
        OR
        ("status" = 'REJECTED' AND "handled_by_membership_id" IS NOT NULL AND "handled_at" IS NOT NULL AND btrim("rejection_reason") <> '')
    );

ALTER TABLE "idempotency_record"
    ADD CONSTRAINT "idempotency_record_request_hash_format_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "idempotency_record_key_nonempty_check" CHECK (btrim("idempotency_key") <> ''),
    ADD CONSTRAINT "idempotency_record_response_status_check" CHECK ("response_status" BETWEEN 100 AND 599),
    ADD CONSTRAINT "idempotency_record_expiry_after_creation_check" CHECK ("expires_at" > "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activation_request_one_pending_per_table_idx"
ON "activation_request"("table_id")
WHERE "status" = 'PENDING';

CREATE INDEX "activation_request_location_status_created_idx"
ON "activation_request"("location_id", "status", "created_at");

CREATE INDEX "activation_request_table_expiry_idx"
ON "activation_request"("table_id", "expires_at");

CREATE INDEX "activation_request_requester_created_idx"
ON "activation_request"("requester_guest_session_id", "created_at");

CREATE UNIQUE INDEX "idempotency_record_actor_operation_key"
ON "idempotency_record"("actor_type", "actor_id", "operation", "idempotency_key");

CREATE INDEX "idempotency_record_restaurant_expiry_idx"
ON "idempotency_record"("restaurant_id", "expires_at");

-- AddForeignKey
ALTER TABLE "activation_request" ADD CONSTRAINT "activation_request_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activation_request" ADD CONSTRAINT "activation_request_location_id_restaurant_id_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activation_request" ADD CONSTRAINT "activation_request_table_id_scope_fkey" FOREIGN KEY ("table_id", "restaurant_id", "location_id") REFERENCES "restaurant_table"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activation_request" ADD CONSTRAINT "activation_request_requester_scope_fkey" FOREIGN KEY ("requester_guest_session_id", "restaurant_id", "location_id", "table_id") REFERENCES "guest_session"("id", "restaurant_id", "location_id", "table_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activation_request" ADD CONSTRAINT "activation_request_handler_scope_fkey" FOREIGN KEY ("handled_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
