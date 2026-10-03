CREATE TABLE "policy_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"base_version" integer NOT NULL,
	"proposed_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"submission_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" text,
	"decision_reason" text,
	"approved_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "policy_change_submission_unique" UNIQUE("entity_id","requested_by","submission_key"),
	CONSTRAINT "policy_change_key_valid" CHECK ("policy_change_requests"."key" IN ('booking-policy','naming-policy','analysis-policy')),
	CONSTRAINT "policy_change_base_version_valid" CHECK ("policy_change_requests"."base_version" >= 0),
	CONSTRAINT "policy_change_status_valid" CHECK ("policy_change_requests"."status" IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
	CONSTRAINT "policy_change_reason_not_blank" CHECK (length(trim("policy_change_requests"."reason")) > 0),
	CONSTRAINT "policy_change_decision_valid" CHECK (
    ("policy_change_requests"."status" = 'PENDING' AND "policy_change_requests"."decided_by" IS NULL AND "policy_change_requests"."decided_at" IS NULL AND "policy_change_requests"."decision_reason" IS NULL AND "policy_change_requests"."approved_version" IS NULL)
    OR ("policy_change_requests"."status" IN ('APPROVED','REJECTED','CANCELLED') AND "policy_change_requests"."decided_by" IS NOT NULL AND "policy_change_requests"."decided_at" IS NOT NULL
      AND "policy_change_requests"."decision_reason" IS NOT NULL AND length(trim("policy_change_requests"."decision_reason")) > 0
      AND (("policy_change_requests"."status" = 'APPROVED' AND "policy_change_requests"."approved_version" IS NOT NULL AND "policy_change_requests"."approved_version" = "policy_change_requests"."base_version" + 1)
        OR ("policy_change_requests"."status" <> 'APPROVED' AND "policy_change_requests"."approved_version" IS NULL)))),
	CONSTRAINT "policy_change_separation_of_duties" CHECK (
    "policy_change_requests"."status" = 'PENDING' OR ("policy_change_requests"."status" = 'CANCELLED' AND "policy_change_requests"."decided_by" = "policy_change_requests"."requested_by")
    OR ("policy_change_requests"."status" IN ('APPROVED','REJECTED') AND "policy_change_requests"."decided_by" <> "policy_change_requests"."requested_by"))
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "change_request_id" uuid;--> statement-breakpoint
ALTER TABLE "policy_change_requests" ADD CONSTRAINT "policy_change_requests_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_change_entity_status_time_idx" ON "policy_change_requests" USING btree ("entity_id","status","created_at");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_change_request_id_policy_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."policy_change_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_change_request_id_unique" UNIQUE("change_request_id");
--> statement-breakpoint
-- Existing settings remain readable and unchanged. New writes require a finalized
-- independent approval even if an older API binary is still running.
CREATE FUNCTION enforce_approved_policy_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Policy versions are immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.entity_id::text || ':' || NEW.key, 0));
  IF NEW.change_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM policy_change_requests r WHERE r.id = NEW.change_request_id
      AND r.status = 'APPROVED' AND r.entity_id = NEW.entity_id AND r.key = NEW.key
      AND r.approved_version = NEW.version AND r.proposed_value = NEW.value
      AND r.decided_by = NEW.updated_by AND r.decided_by <> r.requested_by
  ) THEN
    RAISE EXCEPTION 'Independent policy approval is required' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> COALESCE((SELECT max(version) FROM settings WHERE entity_id = NEW.entity_id AND key = NEW.key), 0) + 1 THEN
    RAISE EXCEPTION 'Policy version changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settings_approval_write_guard BEFORE INSERT OR UPDATE OR DELETE ON settings
FOR EACH ROW EXECUTE FUNCTION enforce_approved_policy_write();
--> statement-breakpoint
CREATE FUNCTION preserve_policy_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Policy approval history is immutable' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id, NEW.entity_id, NEW.key, NEW.base_version, NEW.proposed_value, NEW.reason, NEW.requested_by, NEW.submission_key, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.entity_id, OLD.key, OLD.base_version, OLD.proposed_value, OLD.reason, OLD.requested_by, OLD.submission_key, OLD.created_at) THEN
    RAISE EXCEPTION 'Submitted policy proposal is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_request_history_guard BEFORE UPDATE OR DELETE ON policy_change_requests
FOR EACH ROW EXECUTE FUNCTION preserve_policy_request();
