-- CreateEnum
CREATE TYPE "staff_user_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "staff_membership_status" AS ENUM ('ACTIVE', 'INACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "staff_user" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "staff_user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_membership" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" "staff_membership_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(96) NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_role" (
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,

    CONSTRAINT "membership_role_pkey" PRIMARY KEY ("membership_id", "role_id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id", "permission_id")
);

-- CreateTable
CREATE TABLE "staff_session" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraints
ALTER TABLE "staff_user"
    ADD CONSTRAINT "staff_user_email_normalized_check" CHECK ("email" = lower(btrim("email")) AND "email" <> '');

ALTER TABLE "staff_session"
    ADD CONSTRAINT "staff_session_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "staff_session_csrf_hash_format_check" CHECK ("csrf_token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "staff_session_expiry_after_creation_check" CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "staff_session_revocation_after_creation_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_email_key" ON "staff_user"("email");
CREATE UNIQUE INDEX "staff_membership_user_location_key" ON "staff_membership"("staff_user_id", "location_id");
CREATE UNIQUE INDEX "staff_membership_id_user_key" ON "staff_membership"("id", "staff_user_id");
CREATE UNIQUE INDEX "staff_membership_id_restaurant_key" ON "staff_membership"("id", "restaurant_id");
CREATE INDEX "staff_membership_location_status_idx" ON "staff_membership"("location_id", "status");
CREATE UNIQUE INDEX "role_restaurant_code_key" ON "role"("restaurant_id", "code");
CREATE UNIQUE INDEX "role_id_restaurant_key" ON "role"("id", "restaurant_id");
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");
CREATE INDEX "membership_role_role_id_idx" ON "membership_role"("role_id");
CREATE INDEX "role_permission_permission_id_idx" ON "role_permission"("permission_id");
CREATE UNIQUE INDEX "staff_session_token_hash_key" ON "staff_session"("token_hash");
CREATE INDEX "staff_session_membership_expiry_idx" ON "staff_session"("membership_id", "expires_at");

-- AddForeignKey
ALTER TABLE "staff_membership" ADD CONSTRAINT "staff_membership_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_membership" ADD CONSTRAINT "staff_membership_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_membership" ADD CONSTRAINT "staff_membership_location_id_restaurant_id_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role" ADD CONSTRAINT "role_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_membership_id_restaurant_id_fkey" FOREIGN KEY ("membership_id", "restaurant_id") REFERENCES "staff_membership"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_role_id_restaurant_id_fkey" FOREIGN KEY ("role_id", "restaurant_id") REFERENCES "role"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_membership_id_staff_user_id_fkey" FOREIGN KEY ("membership_id", "staff_user_id") REFERENCES "staff_membership"("id", "staff_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
