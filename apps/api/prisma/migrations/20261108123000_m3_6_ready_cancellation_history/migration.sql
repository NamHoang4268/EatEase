BEGIN;

ALTER TABLE "order_item"
  DROP CONSTRAINT "order_item_ready_metadata_check",
  ADD CONSTRAINT "order_item_ready_metadata_check" CHECK (
    "ready_at" IS NULL OR (
      "status" IN ('READY', 'SERVED', 'CANCELLED') AND "version" > 0
      AND ("preparing_at" IS NULL OR "ready_at" >= "preparing_at")
    )
  );

COMMIT;
