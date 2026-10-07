CREATE TABLE "pops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"code" text NOT NULL,
	"geometry" geometry(Point,4326) NOT NULL,
	"source_system" text NOT NULL,
	"source_file" text,
	"external_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pops_id_scope_unique" UNIQUE("id","owner_entity_id","dataset_id"),
	CONSTRAINT "pops_owner_code_unique" UNIQUE("owner_entity_id","code"),
	CONSTRAINT "pops_source_identity_unique" UNIQUE("owner_entity_id","source_system","external_id"),
	CONSTRAINT "pops_labels_valid" CHECK (length(trim("pops"."code")) > 0 AND length(trim("pops"."source_system")) > 0 AND length(trim("pops"."created_by")) > 0),
	CONSTRAINT "pops_geometry_valid" CHECK (NOT ST_IsEmpty("pops"."geometry") AND ST_IsValid("pops"."geometry") AND ST_NDims("pops"."geometry") = 2),
	CONSTRAINT "pops_geometry_bounds" CHECK (ST_XMin(Box3D("pops"."geometry")) >= -180 AND ST_XMax(Box3D("pops"."geometry")) <= 180 AND ST_YMin(Box3D("pops"."geometry")) >= -90 AND ST_YMax(Box3D("pops"."geometry")) <= 90)
);
--> statement-breakpoint
ALTER TABLE "pops" ADD CONSTRAINT "pops_dataset_id_owner_entity_id_network_datasets_id_owner_entity_id_fk" FOREIGN KEY ("dataset_id","owner_entity_id") REFERENCES "public"."network_datasets"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pops_geometry_gist" ON "pops" USING gist ("geometry");
--> statement-breakpoint
CREATE INDEX "pops_owner_dataset_idx" ON "pops" USING btree ("owner_entity_id","dataset_id");
