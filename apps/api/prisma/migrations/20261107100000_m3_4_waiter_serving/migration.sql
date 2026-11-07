-- Nullable for historical SERVED rows; do not fabricate missing lifecycle timestamps.
ALTER TABLE "order_item" ADD COLUMN "served_at" TIMESTAMPTZ(3);
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_served_metadata_check"
  CHECK ("served_at" IS NULL OR (
    "status" = 'SERVED' AND "version" > 0
    AND ("ready_at" IS NULL OR "served_at" >= "ready_at")
    AND ("preparing_at" IS NULL OR "served_at" >= "preparing_at")
  ));

CREATE FUNCTION "m34_preserve_served_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."served_at" IS NOT NULL AND NEW."served_at" IS DISTINCT FROM OLD."served_at" THEN
    RAISE EXCEPTION 'Served timestamp is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "order_item_served_at_immutable" BEFORE UPDATE ON "order_item"
  FOR EACH ROW EXECUTE FUNCTION "m34_preserve_served_at"();
