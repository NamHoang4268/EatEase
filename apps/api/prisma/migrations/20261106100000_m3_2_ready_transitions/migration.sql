-- Additive, with no fabricated historical readiness timestamps.
ALTER TABLE "order_item" ADD COLUMN "ready_at" TIMESTAMPTZ(3);
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_ready_metadata_check"
  CHECK ("ready_at" IS NULL OR (
    "status" IN ('READY', 'SERVED') AND "version" > 0
    AND ("preparing_at" IS NULL OR "ready_at" >= "preparing_at")
  ));

CREATE FUNCTION "m32_preserve_ready_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."ready_at" IS NOT NULL AND NEW."ready_at" IS DISTINCT FROM OLD."ready_at" THEN
    RAISE EXCEPTION 'Ready timestamp is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "order_item_ready_at_immutable" BEFORE UPDATE ON "order_item"
  FOR EACH ROW EXECUTE FUNCTION "m32_preserve_ready_at"();
