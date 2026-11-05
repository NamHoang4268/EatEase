-- Additive: existing operational records retain NULL (no fabricated historical timestamp).
ALTER TABLE "order_item" ADD COLUMN "preparing_at" TIMESTAMPTZ(3);
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_preparing_metadata_check"
  CHECK ("preparing_at" IS NULL OR ("status" <> 'NEW' AND "version" > 0));

-- Preserve the first preparation timestamp through future operational transitions.
CREATE FUNCTION "m31_preserve_preparing_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."preparing_at" IS NOT NULL AND NEW."preparing_at" IS DISTINCT FROM OLD."preparing_at" THEN
    RAISE EXCEPTION 'Preparation timestamp is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "order_item_preparing_at_immutable" BEFORE UPDATE ON "order_item"
  FOR EACH ROW EXECUTE FUNCTION "m31_preserve_preparing_at"();
