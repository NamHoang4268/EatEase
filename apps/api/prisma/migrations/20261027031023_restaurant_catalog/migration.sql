-- CreateEnum
CREATE TYPE "restaurant_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "table_physical_status" AS ENUM ('AVAILABLE', 'OCCUPIED', 'CLEANING', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "menu_category_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "menu_item_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "fulfillment_station" AS ENUM ('KITCHEN', 'BAR', 'DIRECT');

-- CreateTable
CREATE TABLE "restaurant" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "restaurant_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "is_active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_table" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "physical_status" "table_physical_status" NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "restaurant_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_category" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "status" "menu_category_status" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "menu_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "price_amount" BIGINT NOT NULL,
    "fulfillment_station" "fulfillment_station" NOT NULL,
    "status" "menu_item_status" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_item_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraints
ALTER TABLE "location"
    ADD CONSTRAINT "location_currency_vnd_check" CHECK ("currency" = 'VND');

ALTER TABLE "restaurant_table"
    ADD CONSTRAINT "restaurant_table_capacity_positive_check" CHECK ("capacity" > 0),
    ADD CONSTRAINT "restaurant_table_version_nonnegative_check" CHECK ("version" >= 0);

ALTER TABLE "menu_item"
    ADD CONSTRAINT "menu_item_price_amount_nonnegative_check" CHECK ("price_amount" >= 0),
    ADD CONSTRAINT "menu_item_version_nonnegative_check" CHECK ("version" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "location_id_restaurant_id_key" ON "location"("id", "restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "location_restaurant_id_code_key" ON "location"("restaurant_id", "code");

-- MVP-only: future multi-location support requires a reviewed migration that removes or replaces this index.
CREATE UNIQUE INDEX "location_one_active_per_restaurant_idx" ON "location"("restaurant_id") WHERE "is_active" = true;

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_table_public_id_key" ON "restaurant_table"("public_id");

-- CreateIndex
CREATE INDEX "restaurant_table_location_status_idx" ON "restaurant_table"("location_id", "physical_status");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_table_id_scope_key" ON "restaurant_table"("id", "restaurant_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_table_location_id_code_key" ON "restaurant_table"("location_id", "code");

-- CreateIndex
CREATE INDEX "menu_category_location_status_order_idx" ON "menu_category"("location_id", "status", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "menu_category_id_scope_key" ON "menu_category"("id", "restaurant_id", "location_id");

-- CreateIndex
CREATE INDEX "menu_item_category_status_idx" ON "menu_item"("category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "menu_item_id_scope_key" ON "menu_item"("id", "restaurant_id", "location_id");

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_table" ADD CONSTRAINT "restaurant_table_location_id_restaurant_id_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_category" ADD CONSTRAINT "menu_category_location_id_restaurant_id_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_category_id_restaurant_id_location_id_fkey" FOREIGN KEY ("category_id", "restaurant_id", "location_id") REFERENCES "menu_category"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;
