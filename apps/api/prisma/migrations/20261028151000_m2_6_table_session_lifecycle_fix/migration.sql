-- CLOSED can result from either ACTIVE (Manager force-close) or CHECKOUT_LOCKED.
-- Keep the closing actor/time/reason invariant without requiring a checkout lock.
ALTER TABLE "table_session"
    DROP CONSTRAINT "table_session_lifecycle_fields_check",
    ADD CONSTRAINT "table_session_lifecycle_fields_check" CHECK (
        ("status" = 'ACTIVE' AND "checkout_locked_at" IS NULL AND "closed_by_membership_id" IS NULL AND "closed_at" IS NULL AND "close_reason" IS NULL)
        OR
        ("status" = 'CHECKOUT_LOCKED' AND "checkout_locked_at" IS NOT NULL AND "closed_by_membership_id" IS NULL AND "closed_at" IS NULL AND "close_reason" IS NULL)
        OR
        ("status" = 'CLOSED' AND "closed_by_membership_id" IS NOT NULL AND "closed_at" IS NOT NULL AND btrim("close_reason") <> '')
        OR
        ("status" = 'CANCELLED' AND "checkout_locked_at" IS NULL AND "closed_by_membership_id" IS NOT NULL AND "closed_at" IS NOT NULL AND btrim("close_reason") <> '')
    );
