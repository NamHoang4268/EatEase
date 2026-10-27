-- CreateEnum
CREATE TYPE "guest_access_level" AS ENUM ('BROWSE_ONLY', 'ORDER_ENABLED');

-- CreateTable
CREATE TABLE "guest_session" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "table_session_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "access_level" "guest_access_level" NOT NULL DEFAULT 'BROWSE_ONLY',
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guest_session_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraints
ALTER TABLE "guest_session"
    ADD CONSTRAINT "guest_session_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "guest_session_csrf_hash_format_check" CHECK ("csrf_token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "guest_session_idle_after_creation_check" CHECK ("idle_expires_at" > "created_at"),
    ADD CONSTRAINT "guest_session_absolute_gte_idle_check" CHECK ("absolute_expires_at" >= "idle_expires_at"),
    ADD CONSTRAINT "guest_session_revocation_after_creation_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at"),
    ADD CONSTRAINT "guest_session_version_nonnegative_check" CHECK ("version" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "guest_session_token_hash_key" ON "guest_session"("token_hash");
CREATE INDEX "guest_session_table_access_level_idx" ON "guest_session"("table_id", "access_level");
CREATE INDEX "guest_session_table_idle_expiry_idx" ON "guest_session"("table_id", "idle_expires_at");

-- AddForeignKey
ALTER TABLE "guest_session" ADD CONSTRAINT "guest_session_table_id_restaurant_id_location_id_fkey" FOREIGN KEY ("table_id", "restaurant_id", "location_id") REFERENCES "restaurant_table"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

