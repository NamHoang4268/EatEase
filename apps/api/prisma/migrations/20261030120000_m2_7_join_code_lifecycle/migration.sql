CREATE TYPE "join_rate_limit_dimension" AS ENUM ('GUEST_TABLE', 'IP_TABLE', 'TABLE_SESSION');

CREATE TABLE "session_join_code" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_guest_session_id" UUID,
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_join_code_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "session_join_code_exactly_one_creator_check" CHECK (
        ("created_by_guest_session_id" IS NOT NULL)::integer
        + ("created_by_membership_id" IS NOT NULL)::integer = 1
    ),
    CONSTRAINT "session_join_code_hash_format_check" CHECK (
        "code_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "session_join_code_expiry_timeline_check" CHECK (
        "expires_at" > "created_at"
    ),
    CONSTRAINT "session_join_code_revocation_timeline_check" CHECK (
        "revoked_at" IS NULL OR "revoked_at" >= "created_at"
    )
);

CREATE TABLE "join_attempt_rate_limit" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "dimension" "join_rate_limit_dimension" NOT NULL,
    "subject_hash" CHAR(64) NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "join_attempt_rate_limit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "join_rate_limit_subject_hash_format_check" CHECK (
        "subject_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "join_rate_limit_failed_attempts_nonnegative_check" CHECK (
        "failed_attempts" >= 0
    ),
    CONSTRAINT "join_rate_limit_block_timeline_check" CHECK (
        "blocked_until" IS NULL OR "blocked_until" > "window_started_at"
    )
);

CREATE UNIQUE INDEX "session_join_code_one_current_per_session_idx"
ON "session_join_code"("table_session_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "session_join_code_session_expiry_idx"
ON "session_join_code"("table_session_id", "expires_at");
CREATE INDEX "session_join_code_table_expiry_idx"
ON "session_join_code"("table_id", "expires_at");

CREATE UNIQUE INDEX "join_rate_limit_session_dimension_subject_key"
ON "join_attempt_rate_limit"("table_session_id", "dimension", "subject_hash");
CREATE INDEX "join_rate_limit_session_blocked_idx"
ON "join_attempt_rate_limit"("table_session_id", "blocked_until");

ALTER TABLE "session_join_code" ADD CONSTRAINT "session_join_code_restaurant_fkey"
FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_join_code" ADD CONSTRAINT "session_join_code_location_scope_fkey"
FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_join_code" ADD CONSTRAINT "session_join_code_table_scope_fkey"
FOREIGN KEY ("table_id", "restaurant_id", "location_id") REFERENCES "restaurant_table"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_join_code" ADD CONSTRAINT "session_join_code_session_scope_fkey"
FOREIGN KEY ("table_session_id", "restaurant_id", "location_id", "table_id") REFERENCES "table_session"("id", "restaurant_id", "location_id", "table_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_join_code" ADD CONSTRAINT "session_join_code_guest_creator_scope_fkey"
FOREIGN KEY ("created_by_guest_session_id", "restaurant_id", "location_id", "table_id") REFERENCES "guest_session"("id", "restaurant_id", "location_id", "table_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_join_code" ADD CONSTRAINT "session_join_code_staff_creator_scope_fkey"
FOREIGN KEY ("created_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "join_attempt_rate_limit" ADD CONSTRAINT "join_rate_limit_session_scope_fkey"
FOREIGN KEY ("table_session_id", "restaurant_id", "location_id", "table_id") REFERENCES "table_session"("id", "restaurant_id", "location_id", "table_id") ON DELETE RESTRICT ON UPDATE CASCADE;
