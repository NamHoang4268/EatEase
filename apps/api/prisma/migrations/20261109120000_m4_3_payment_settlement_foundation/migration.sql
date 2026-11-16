CREATE TYPE "payment_method" AS ENUM ('CASH');
CREATE TYPE "payment_status" AS ENUM ('SUCCEEDED');

CREATE TABLE "payment" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "method" "payment_method" NOT NULL DEFAULT 'CASH',
  "status" "payment_status" NOT NULL DEFAULT 'SUCCEEDED',
  "amount" BIGINT NOT NULL,
  "recorded_by_membership_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_amount_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "payment_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_bill_scope_fkey" FOREIGN KEY ("bill_id", "restaurant_id", "location_id") REFERENCES "bill"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "payment_recorder_scope_fkey" FOREIGN KEY ("recorded_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "settlement" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "settled_amount" BIGINT NOT NULL,
  "settled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_membership_id" UUID NOT NULL,
  CONSTRAINT "settlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_amount_nonnegative_check" CHECK ("settled_amount" >= 0),
  CONSTRAINT "settlement_restaurant_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_location_scope_fkey" FOREIGN KEY ("location_id", "restaurant_id") REFERENCES "location"("id", "restaurant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_bill_scope_fkey" FOREIGN KEY ("bill_id", "restaurant_id", "location_id") REFERENCES "bill"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "settlement_creator_scope_fkey" FOREIGN KEY ("created_by_membership_id", "restaurant_id", "location_id") REFERENCES "staff_membership"("id", "restaurant_id", "location_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "payment_bill_recorded_idx" ON "payment"("bill_id", "recorded_at");
CREATE UNIQUE INDEX "settlement_bill_id_key" ON "settlement"("bill_id");
CREATE UNIQUE INDEX "settlement_bill_scope_key" ON "settlement"("bill_id", "restaurant_id", "location_id");

CREATE FUNCTION "m43_financial_record_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment and Settlement records are immutable' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "payment_immutable"
  BEFORE UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION "m43_financial_record_immutable"();

CREATE TRIGGER "settlement_immutable"
  BEFORE UPDATE OR DELETE ON "settlement"
  FOR EACH ROW EXECUTE FUNCTION "m43_financial_record_immutable"();
