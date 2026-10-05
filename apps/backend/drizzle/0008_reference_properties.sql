ALTER TABLE "reference_areas" ADD COLUMN "properties" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_features" ADD COLUMN "properties" jsonb DEFAULT '{}'::jsonb NOT NULL;
