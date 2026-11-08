BEGIN;

ALTER TYPE "cancellation_request_source" ADD VALUE 'MANAGER_CORRECTION';
ALTER TYPE "bill_adjustment_kind" ADD VALUE 'FULL_MANAGER_WAIVER';

COMMIT;

BEGIN;

ALTER TABLE "cancellation_request"
  DROP CONSTRAINT "cancellation_request_source_actor_check",
  ADD CONSTRAINT "cancellation_request_source_actor_check" CHECK (
    ("source" = 'GUEST_REQUEST' AND "requester_guest_session_id" IS NOT NULL AND "requested_by_membership_id" IS NULL)
    OR ("source" IN ('STAFF_REJECTION', 'MANAGER_CORRECTION') AND "requester_guest_session_id" IS NULL AND "requested_by_membership_id" IS NOT NULL)
  );

DROP INDEX "bill_adjustment_full_waiver_item_key";
CREATE UNIQUE INDEX "bill_adjustment_full_waiver_item_key"
  ON "bill_adjustment"("order_item_id")
  WHERE "kind" IN ('FULL_CANCELLATION_WAIVER', 'FULL_MANAGER_WAIVER');

CREATE OR REPLACE FUNCTION "m35_full_waiver_matches_line"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bill_line" bl
    JOIN "order_item" oi ON oi."id" = bl."order_item_id"
    JOIN "cancellation_request" cr ON cr."id" = NEW."cancellation_request_id"
    WHERE bl."order_item_id" = NEW."order_item_id" AND bl."bill_id" = NEW."bill_id"
      AND bl."line_amount" = -NEW."amount"
      AND cr."status" = 'APPROVED' AND cr."order_item_id" = NEW."order_item_id"
      AND (
        (NEW."kind" = 'FULL_CANCELLATION_WAIVER' AND oi."status" = 'CANCELLED'
          AND cr."source" IN ('GUEST_REQUEST', 'STAFF_REJECTION'))
        OR (NEW."kind" = 'FULL_MANAGER_WAIVER' AND oi."status" IN ('CANCELLED', 'SERVED')
          AND cr."source" = 'MANAGER_CORRECTION')
      )
  ) THEN
    RAISE EXCEPTION 'Full waiver must match its approved item correction and immutable BillLine' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
