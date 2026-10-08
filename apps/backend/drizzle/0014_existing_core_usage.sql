-- Existing physical usage is a direct allocation, not a fabricated booking.
-- Existing booking allocations and all usage readers remain compatible.
ALTER TABLE "core_allocations" ALTER COLUMN "source_booking_id" DROP NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_active_existing_segment_unique"
  ON "core_allocations" ("segment_id")
  WHERE "source_booking_id" IS NULL AND "deallocated_at" IS NULL;
