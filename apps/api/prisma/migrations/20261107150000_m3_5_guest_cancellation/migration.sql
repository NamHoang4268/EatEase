CREATE TYPE "cancellation_request_status" AS ENUM (
  'PENDING_WAITER',
  'PENDING_KITCHEN',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN'
);

CREATE TYPE "cancellation_request_source" AS ENUM ('GUEST_REQUEST', 'STAFF_REJECTION');
CREATE TYPE "bill_adjustment_kind" AS ENUM ('FULL_CANCELLATION_WAIVER');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "bill" WHERE "adjustment_amount" <> 0) THEN
    RAISE EXCEPTION 'M3.5 requires existing bills to have zero adjustment_amount before immutable adjustment records are introduced';
  END IF;
END $$;

CREATE TABLE "cancellation_request" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "table_session_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "source" "cancellation_request_source" NOT NULL,
  "status" "cancellation_request_status" NOT NULL,
  "requester_guest_session_id" UUID,
  "requested_by_membership_id" UUID,
  "request_reason" VARCHAR(500) NOT NULL,
  "decided_by_membership_id" UUID,
  "decided_at" TIMESTAMPTZ(3),
  "decision_reason" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cancellation_request_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cancellation_request_version_check" CHECK ("version" >= 0),
  CONSTRAINT "cancellation_request_reason_check" CHECK (length(btrim("request_reason")) BETWEEN 1 AND 500),
  CONSTRAINT "cancellation_request_source_actor_check" CHECK (
    ("source" = 'GUEST_REQUEST' AND "requester_guest_session_id" IS NOT NULL AND "requested_by_membership_id" IS NULL)
    OR ("source" = 'STAFF_REJECTION' AND "requester_guest_session_id" IS NULL AND "requested_by_membership_id" IS NOT NULL)
  ),
  CONSTRAINT "cancellation_request_decision_check" CHECK (
    ("status" IN ('PENDING_WAITER', 'PENDING_KITCHEN') AND "decided_by_membership_id" IS NULL AND "decided_at" IS NULL AND "decision_reason" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "decided_by_membership_id" IS NOT NULL AND "decided_at" IS NOT NULL AND length(btrim("decision_reason")) BETWEEN 1 AND 500)
    OR ("status" = 'WITHDRAWN' AND "decided_at" IS NOT NULL AND length(btrim("decision_reason")) BETWEEN 1 AND 500)
  ),
  CONSTRAINT "cancellation_request_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cancellation_request_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cancellation_request_session_scope_fkey" FOREIGN KEY ("table_session_id", "restaurant_id", "location_id") REFERENCES "table_session"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cancellation_request_bill_scope_fkey" FOREIGN KEY ("bill_id", "restaurant_id", "location_id") REFERENCES "bill"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cancellation_request_item_scope_fkey" FOREIGN KEY ("order_item_id", "bill_id", "restaurant_id", "location_id") REFERENCES "order_item"("id", "bill_id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cancellation_request_guest_scope_fkey" FOREIGN KEY ("requester_guest_session_id", "restaurant_id", "location_id", "table_session_id") REFERENCES "guest_session"("id", "restaurant_id", "location_id", "table_session_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cancellation_request_requester_staff_scope_fkey" FOREIGN KEY ("requested_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cancellation_request_decider_scope_fkey" FOREIGN KEY ("decided_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "cancellation_request_id_bill_scope_key"
  ON "cancellation_request"("id", "bill_id", "restaurant_id", "location_id");
CREATE UNIQUE INDEX "cancellation_request_one_pending_item_key"
  ON "cancellation_request"("order_item_id")
  WHERE "status" IN ('PENDING_WAITER', 'PENDING_KITCHEN');
CREATE INDEX "cancellation_request_item_status_created_idx"
  ON "cancellation_request"("order_item_id", "status", "created_at");
CREATE INDEX "cancellation_request_location_status_created_idx"
  ON "cancellation_request"("location_id", "status", "created_at");
CREATE INDEX "cancellation_request_guest_created_idx"
  ON "cancellation_request"("requester_guest_session_id", "created_at");

CREATE TABLE "bill_adjustment" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "cancellation_request_id" UUID NOT NULL,
  "kind" "bill_adjustment_kind" NOT NULL,
  "amount" BIGINT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bill_adjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bill_adjustment_amount_check" CHECK ("amount" <= 0),
  CONSTRAINT "bill_adjustment_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "bill_adjustment_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bill_adjustment_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bill_adjustment_bill_scope_fkey" FOREIGN KEY ("bill_id", "restaurant_id", "location_id") REFERENCES "bill"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "bill_adjustment_item_scope_fkey" FOREIGN KEY ("order_item_id", "bill_id", "restaurant_id", "location_id") REFERENCES "order_item"("id", "bill_id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "bill_adjustment_cancellation_scope_fkey" FOREIGN KEY ("cancellation_request_id", "bill_id", "restaurant_id", "location_id") REFERENCES "cancellation_request"("id", "bill_id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "bill_adjustment_creator_scope_fkey" FOREIGN KEY ("created_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "bill_adjustment_cancellation_request_key"
  ON "bill_adjustment"("cancellation_request_id");
CREATE UNIQUE INDEX "bill_adjustment_cancellation_scope_key"
  ON "bill_adjustment"("cancellation_request_id", "bill_id", "restaurant_id", "location_id");
CREATE UNIQUE INDEX "bill_adjustment_full_waiver_item_key"
  ON "bill_adjustment"("order_item_id")
  WHERE "kind" = 'FULL_CANCELLATION_WAIVER';
CREATE INDEX "bill_adjustment_bill_created_idx" ON "bill_adjustment"("bill_id", "created_at");
CREATE INDEX "bill_adjustment_item_created_idx" ON "bill_adjustment"("order_item_id", "created_at");

CREATE FUNCTION "m35_cancellation_transition_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."restaurant_id", NEW."location_id", NEW."table_session_id", NEW."bill_id", NEW."order_item_id",
         NEW."source", NEW."requester_guest_session_id", NEW."requested_by_membership_id", NEW."request_reason", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."restaurant_id", OLD."location_id", OLD."table_session_id", OLD."bill_id", OLD."order_item_id",
         OLD."source", OLD."requester_guest_session_id", OLD."requested_by_membership_id", OLD."request_reason", OLD."created_at") THEN
    RAISE EXCEPTION 'Cancellation request origin is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('APPROVED', 'REJECTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Cancellation request is terminal' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD."status" = 'PENDING_WAITER' AND NEW."status" IN ('PENDING_KITCHEN', 'APPROVED', 'REJECTED', 'WITHDRAWN'))
    OR (OLD."status" = 'PENDING_KITCHEN' AND NEW."status" IN ('APPROVED', 'REJECTED', 'WITHDRAWN'))
  ) OR NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Invalid cancellation request transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "cancellation_request_transition_guard"
  BEFORE UPDATE ON "cancellation_request"
  FOR EACH ROW EXECUTE FUNCTION "m35_cancellation_transition_guard"();

CREATE FUNCTION "m35_adjustment_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bill adjustment is immutable' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "bill_adjustment_immutable"
  BEFORE UPDATE OR DELETE ON "bill_adjustment"
  FOR EACH ROW EXECUTE FUNCTION "m35_adjustment_immutable"();

CREATE FUNCTION "m35_full_waiver_matches_line"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bill_line" bl
    JOIN "order_item" oi ON oi."id" = bl."order_item_id"
    JOIN "cancellation_request" cr ON cr."id" = NEW."cancellation_request_id"
    WHERE bl."order_item_id" = NEW."order_item_id" AND bl."bill_id" = NEW."bill_id"
      AND bl."line_amount" = -NEW."amount" AND oi."status" = 'CANCELLED'
      AND cr."status" = 'APPROVED' AND cr."order_item_id" = NEW."order_item_id"
  ) THEN
    RAISE EXCEPTION 'Full cancellation waiver must match a cancelled item BillLine' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "bill_adjustment_full_waiver_guard"
  BEFORE INSERT ON "bill_adjustment"
  FOR EACH ROW EXECUTE FUNCTION "m35_full_waiver_matches_line"();

CREATE FUNCTION "m35_bill_adjustments_match"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'bill' THEN
    target_id := NEW."id";
  ELSE
    target_id := COALESCE(NEW."bill_id", OLD."bill_id");
  END IF;
  IF EXISTS (
    SELECT 1 FROM "bill" b WHERE b."id" = target_id
      AND b."adjustment_amount" <> COALESCE((SELECT sum(ba."amount") FROM "bill_adjustment" ba WHERE ba."bill_id" = b."id"), 0)
  ) THEN
    RAISE EXCEPTION 'Bill adjustment total must equal immutable adjustments' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "bill_adjustments_match_bill"
  AFTER INSERT ON "bill_adjustment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "m35_bill_adjustments_match"();
CREATE CONSTRAINT TRIGGER "bill_adjustment_total_matches_records"
  AFTER UPDATE OF "adjustment_amount" ON "bill"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "m35_bill_adjustments_match"();
