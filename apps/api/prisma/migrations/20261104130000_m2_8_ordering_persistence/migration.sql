-- Additive, forward-only. Existing activation-created Bills must still be empty.
-- Do not backfill financial history or rewrite previously applied migrations.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "bill" WHERE "subtotal_amount" <> 0) THEN
    RAISE EXCEPTION 'M2.8 requires review of pre-existing nonzero Bill subtotals';
  END IF;
END $$;

CREATE TYPE "order_status" AS ENUM ('SUBMITTED');
CREATE TYPE "order_source" AS ENUM ('QR_GUEST', 'STAFF_WAITER');
CREATE TYPE "order_item_status" AS ENUM ('NEW', 'PREPARING', 'READY', 'SERVED', 'REJECTED', 'CANCELLED');

CREATE UNIQUE INDEX "guest_session_id_order_scope_key" ON "guest_session"("id", "restaurant_id", "location_id", "table_session_id");
CREATE UNIQUE INDEX "bill_id_scope_key" ON "bill"("id", "restaurant_id", "location_id");
CREATE UNIQUE INDEX "bill_id_session_scope_key" ON "bill"("id", "table_session_id", "restaurant_id", "location_id");

CREATE TABLE "order" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "table_session_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "order_number" VARCHAR(64) NOT NULL,
  "item_count" INTEGER NOT NULL,
  "source" "order_source" NOT NULL,
  "created_by_guest_session_id" UUID,
  "created_by_membership_id" UUID,
  "status" "order_status" NOT NULL DEFAULT 'SUBMITTED',
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_source_actor_check" CHECK (
    ("source" = 'QR_GUEST' AND "created_by_guest_session_id" IS NOT NULL AND "created_by_membership_id" IS NULL)
    OR ("source" = 'STAFF_WAITER' AND "created_by_membership_id" IS NOT NULL AND "created_by_guest_session_id" IS NULL)
  ),
  CONSTRAINT "order_version_check" CHECK ("version" = 0),
  CONSTRAINT "order_number_check" CHECK (length(btrim("order_number")) > 0),
  CONSTRAINT "order_item_count_check" CHECK ("item_count" > 0),
  CONSTRAINT "order_session_scope_fkey" FOREIGN KEY ("table_session_id", "restaurant_id", "location_id") REFERENCES "table_session"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "order_bill_session_scope_fkey" FOREIGN KEY ("bill_id", "table_session_id", "restaurant_id", "location_id") REFERENCES "bill"("id", "table_session_id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "order_guest_session_scope_fkey" FOREIGN KEY ("created_by_guest_session_id", "restaurant_id", "location_id", "table_session_id") REFERENCES "guest_session"("id", "restaurant_id", "location_id", "table_session_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "order_staff_scope_fkey" FOREIGN KEY ("created_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "order_location_number_key" ON "order"("location_id", "order_number");
CREATE UNIQUE INDEX "order_id_bill_scope_key" ON "order"("id", "bill_id", "restaurant_id", "location_id");
CREATE INDEX "order_session_submitted_idx" ON "order"("table_session_id", "submitted_at");

CREATE TABLE "order_item" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "menu_item_id" UUID NOT NULL,
  "name_snapshot" VARCHAR(160) NOT NULL,
  "unit_price_amount" BIGINT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "modifiers_snapshot" JSONB NOT NULL DEFAULT '[]',
  "note" TEXT,
  "station_snapshot" "fulfillment_station" NOT NULL,
  "status" "order_item_status" NOT NULL DEFAULT 'NEW',
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "order_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_item_amount_check" CHECK ("quantity" > 0 AND "unit_price_amount" >= 0),
  CONSTRAINT "order_item_version_check" CHECK ("version" >= 0),
  CONSTRAINT "order_item_snapshot_check" CHECK (length(btrim("name_snapshot")) > 0 AND jsonb_typeof("modifiers_snapshot") = 'array'),
  CONSTRAINT "order_item_order_bill_scope_fkey" FOREIGN KEY ("order_id", "bill_id", "restaurant_id", "location_id") REFERENCES "order"("id", "bill_id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "order_item_menu_scope_fkey" FOREIGN KEY ("menu_item_id", "restaurant_id", "location_id") REFERENCES "menu_item"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "order_item_id_bill_scope_key" ON "order_item"("id", "bill_id", "restaurant_id", "location_id");
CREATE INDEX "order_item_order_idx" ON "order_item"("order_id");
CREATE INDEX "order_item_menu_idx" ON "order_item"("menu_item_id");
CREATE INDEX "order_item_location_queue_idx" ON "order_item"("location_id", "status", "station_snapshot");

CREATE TABLE "bill_line" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "description_snapshot" VARCHAR(160) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_amount" BIGINT NOT NULL,
  "line_amount" BIGINT NOT NULL,
  CONSTRAINT "bill_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bill_line_amount_check" CHECK (
    "quantity" > 0 AND "unit_amount" >= 0 AND "line_amount" >= 0
    AND "line_amount"::numeric = "quantity"::numeric * "unit_amount"::numeric
  ),
  CONSTRAINT "bill_line_bill_scope_fkey" FOREIGN KEY ("bill_id", "restaurant_id", "location_id") REFERENCES "bill"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "bill_line_item_bill_scope_fkey" FOREIGN KEY ("order_item_id", "bill_id", "restaurant_id", "location_id") REFERENCES "order_item"("id", "bill_id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "bill_line_order_item_key" ON "bill_line"("order_item_id");
CREATE UNIQUE INDEX "bill_line_item_bill_scope_key" ON "bill_line"("order_item_id", "bill_id", "restaurant_id", "location_id");
CREATE INDEX "bill_line_bill_idx" ON "bill_line"("bill_id");

-- Submission history is append-only; operational OrderItem state remains updateable.
CREATE FUNCTION "m28_immutable_submission"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submitted financial history is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "order_immutable" BEFORE UPDATE OR DELETE ON "order"
  FOR EACH ROW EXECUTE FUNCTION "m28_immutable_submission"();
CREATE TRIGGER "bill_line_immutable" BEFORE UPDATE OR DELETE ON "bill_line"
  FOR EACH ROW EXECUTE FUNCTION "m28_immutable_submission"();

CREATE FUNCTION "m28_item_snapshot_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Submitted OrderItem cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."id", NEW."restaurant_id", NEW."location_id", NEW."order_id", NEW."bill_id", NEW."menu_item_id",
         NEW."name_snapshot", NEW."unit_price_amount", NEW."quantity", NEW."modifiers_snapshot", NEW."note", NEW."station_snapshot")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."restaurant_id", OLD."location_id", OLD."order_id", OLD."bill_id", OLD."menu_item_id",
         OLD."name_snapshot", OLD."unit_price_amount", OLD."quantity", OLD."modifiers_snapshot", OLD."note", OLD."station_snapshot") THEN
    RAISE EXCEPTION 'Submitted OrderItem snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "order_item_snapshot_immutable" BEFORE UPDATE OR DELETE ON "order_item"
  FOR EACH ROW EXECUTE FUNCTION "m28_item_snapshot_immutable"();

-- Deferred checks allow an atomic Order -> Items -> Lines -> Bill update transaction.
CREATE FUNCTION "m28_order_has_items"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'order' THEN target_id := NEW."id";
  ELSE target_id := NEW."order_id";
  END IF;
  IF EXISTS (
    SELECT 1 FROM "order" o WHERE o."id" = target_id
      AND o."item_count" <> (SELECT count(*) FROM "order_item" oi WHERE oi."order_id" = o."id")
  ) THEN
    RAISE EXCEPTION 'Submitted Order item count is immutable and must match its items' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "order_has_items" AFTER INSERT ON "order"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "m28_order_has_items"();
CREATE CONSTRAINT TRIGGER "order_item_count_matches" AFTER INSERT ON "order_item"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "m28_order_has_items"();

CREATE FUNCTION "m28_item_has_matching_line"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bill_line" bl WHERE bl."order_item_id" = NEW."id"
      AND bl."bill_id" = NEW."bill_id" AND bl."quantity" = NEW."quantity"
      AND bl."unit_amount" = NEW."unit_price_amount" AND bl."description_snapshot" = NEW."name_snapshot"
  ) THEN
    RAISE EXCEPTION 'OrderItem requires one matching BillLine' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "order_item_has_matching_line" AFTER INSERT ON "order_item"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "m28_item_has_matching_line"();

CREATE FUNCTION "m28_bill_subtotal_matches_lines"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'bill' THEN target_id := NEW."id";
  ELSE target_id := NEW."bill_id";
  END IF;
  IF EXISTS (
    SELECT 1 FROM "bill" b WHERE b."id" = target_id
      AND b."subtotal_amount"::numeric <> COALESCE((SELECT sum(bl."line_amount") FROM "bill_line" bl WHERE bl."bill_id" = b."id"), 0)
  ) THEN
    RAISE EXCEPTION 'Bill subtotal must equal immutable BillLines' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "bill_subtotal_matches_lines" AFTER INSERT OR UPDATE ON "bill"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "m28_bill_subtotal_matches_lines"();
CREATE CONSTRAINT TRIGGER "bill_line_subtotal_matches" AFTER INSERT ON "bill_line"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "m28_bill_subtotal_matches_lines"();
COMMIT;
