ALTER TABLE "import_previews" ADD COLUMN "areas" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "reference_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"geometry" geometry(Geometry,4326) NOT NULL,
	"source_system" text NOT NULL,
	"source_file" text,
	"external_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_areas_id_scope_unique" UNIQUE("id","owner_entity_id","dataset_id"),
	CONSTRAINT "reference_areas_source_identity_unique" UNIQUE("owner_entity_id","source_system","external_id"),
	CONSTRAINT "reference_areas_network_datasets_fk" FOREIGN KEY ("dataset_id","owner_entity_id") REFERENCES "network_datasets"("id","owner_entity_id"),
	CONSTRAINT "reference_areas_labels_valid" CHECK (length(trim("code")) > 0 AND length(trim("name")) > 0 AND length(trim("source_system")) > 0 AND length(trim("external_id")) > 0 AND length(trim("created_by")) > 0),
	CONSTRAINT "reference_areas_geometry_type" CHECK (ST_GeometryType("geometry") IN ('ST_Polygon', 'ST_MultiPolygon')),
	CONSTRAINT "reference_areas_geometry_valid" CHECK (NOT ST_IsEmpty("geometry") AND ST_IsValid("geometry") AND ST_NDims("geometry") = 2),
	CONSTRAINT "reference_areas_geometry_bounds" CHECK (ST_XMin(Box3D("geometry")) >= -180 AND ST_XMax(Box3D("geometry")) <= 180 AND ST_YMin(Box3D("geometry")) >= -90 AND ST_YMax(Box3D("geometry")) <= 90)
);--> statement-breakpoint
CREATE INDEX "reference_areas_geometry_gist" ON "reference_areas" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "reference_areas_owner_dataset_idx" ON "reference_areas" USING btree ("owner_entity_id","dataset_id");
