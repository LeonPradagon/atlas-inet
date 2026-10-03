CREATE TABLE "core_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"source_booking_id" uuid NOT NULL,
	"core_count" integer NOT NULL,
	"operational_reference" text NOT NULL,
	"activated_by" text NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deallocated_at" timestamp with time zone,
	"deallocated_by" text,
	"deallocation_reason" text,
	CONSTRAINT "core_allocations_source_booking_id_unique" UNIQUE("source_booking_id"),
	CONSTRAINT "allocations_core_positive" CHECK ("core_allocations"."core_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "analysis_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"rows" jsonb NOT NULL,
	"source_name" text NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_reference" text,
	"customer_pic_name" text NOT NULL,
	"customer_pic_contact" text NOT NULL,
	"presales_user_id" text NOT NULL,
	"core_count" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'BOOKED' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"policy_version" integer NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	CONSTRAINT "bookings_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "bookings_core_positive" CHECK ("bookings"."core_count" > 0),
	CONSTRAINT "bookings_status_valid" CHECK ("bookings"."status" IN ('BOOKED','USED','RELEASED','EXPIRED')),
	CONSTRAINT "bookings_expiry_valid" CHECK ("bookings"."expires_at" > "bookings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "cable_name_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"old_name" text NOT NULL,
	"new_name" text NOT NULL,
	"policy_version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_scope_unique" UNIQUE("user_id","action","key")
);
--> statement-breakpoint
CREATE TABLE "import_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"source_name" text NOT NULL,
	"source_system" text NOT NULL,
	"rows" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"status" text DEFAULT 'PREVIEW' NOT NULL,
	"dataset_id" uuid,
	"base_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"reference_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	CONSTRAINT "job_row_unique" UNIQUE("job_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"total" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"error" text,
	"cancel_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status_valid" CHECK ("jobs"."status" IN ('QUEUED','RUNNING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED')),
	CONSTRAINT "jobs_progress_valid" CHECK ("jobs"."total" >= 0 AND "jobs"."completed" >= 0 AND "jobs"."completed" <= "jobs"."total" AND "jobs"."succeeded" >= 0 AND "jobs"."failed" >= 0 AND "jobs"."completed" = "jobs"."succeeded" + "jobs"."failed")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"recipient_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_event_recipient_unique" UNIQUE("event_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_entity_key_version" UNIQUE("entity_id","key","version"),
	CONSTRAINT "settings_version_positive" CHECK ("settings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "waiting_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_reference" text,
	"customer_pic_name" text NOT NULL,
	"customer_pic_contact" text NOT NULL,
	"presales_user_id" text NOT NULL,
	"core_count" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"booking_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	CONSTRAINT "waiting_list_entries_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "waiting_core_positive" CHECK ("waiting_list_entries"."core_count" > 0),
	CONSTRAINT "waiting_status_valid" CHECK ("waiting_list_entries"."status" IN ('WAITING','ALLOCATED','CANCELLED')),
	CONSTRAINT "waiting_booking_valid" CHECK (("waiting_list_entries"."status" = 'ALLOCATED') = ("waiting_list_entries"."booking_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "network_segments" ADD CONSTRAINT "network_segments_id_owner_unique" UNIQUE("id","owner_entity_id");--> statement-breakpoint
ALTER TABLE "core_allocations" ADD CONSTRAINT "core_allocations_segment_id_entity_id_network_segments_id_owner_entity_id_fk" FOREIGN KEY ("segment_id","entity_id") REFERENCES "public"."network_segments"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_allocations" ADD CONSTRAINT "core_allocations_source_booking_id_entity_id_bookings_id_entity_id_fk" FOREIGN KEY ("source_booking_id","entity_id") REFERENCES "public"."bookings"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_uploads" ADD CONSTRAINT "analysis_uploads_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_uploads" ADD CONSTRAINT "analysis_uploads_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_segment_id_entity_id_network_segments_id_owner_entity_id_fk" FOREIGN KEY ("segment_id","entity_id") REFERENCES "public"."network_segments"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_name_history" ADD CONSTRAINT "cable_name_history_segment_id_network_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."network_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_rows" ADD CONSTRAINT "job_rows_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_list_entries" ADD CONSTRAINT "waiting_list_entries_segment_id_entity_id_network_segments_id_owner_entity_id_fk" FOREIGN KEY ("segment_id","entity_id") REFERENCES "public"."network_segments"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_list_entries" ADD CONSTRAINT "waiting_list_entries_booking_id_entity_id_bookings_id_entity_id_fk" FOREIGN KEY ("booking_id","entity_id") REFERENCES "public"."bookings"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_segment_active_idx" ON "core_allocations" USING btree ("segment_id","deallocated_at");--> statement-breakpoint
CREATE INDEX "analysis_owner_time_idx" ON "analysis_results" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "analysis_upload_owner_idx" ON "analysis_uploads" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_time_idx" ON "audit_logs" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_segment_status_expiry_idx" ON "bookings" USING btree ("segment_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "import_owner_time_idx" ON "import_previews" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "jobs_owner_idx" ON "jobs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_recipient_time_idx" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("delivered_at","created_at");--> statement-breakpoint
CREATE INDEX "waiting_segment_order_idx" ON "waiting_list_entries" USING btree ("segment_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "network_segments_geography_gist" ON "network_segments" USING gist (("geometry"::geography));
