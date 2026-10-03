CREATE TABLE "cable_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "cable_types_code_unique" UNIQUE("code"),
	CONSTRAINT "cable_types_labels_valid" CHECK (length(trim("cable_types"."code")) > 0 AND length(trim("cable_types"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "network_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"version" text NOT NULL,
	"source_system" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "network_datasets_id_owner_unique" UNIQUE("id","owner_entity_id"),
	CONSTRAINT "network_datasets_owner_version_unique" UNIQUE("owner_entity_id","version"),
	CONSTRAINT "network_datasets_status_valid" CHECK ("network_datasets"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
	CONSTRAINT "network_datasets_publication_valid" CHECK (("network_datasets"."status" = 'DRAFT' AND "network_datasets"."published_at" IS NULL) OR ("network_datasets"."status" IN ('PUBLISHED', 'ARCHIVED') AND "network_datasets"."published_at" IS NOT NULL)),
	CONSTRAINT "network_datasets_labels_valid" CHECK (length(trim("network_datasets"."version")) > 0 AND length(trim("network_datasets"."source_system")) > 0 AND length(trim("network_datasets"."created_by")) > 0)
);
--> statement-breakpoint
CREATE TABLE "network_nodes" (
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
	CONSTRAINT "network_nodes_id_scope_unique" UNIQUE("id","owner_entity_id","dataset_id"),
	CONSTRAINT "network_nodes_owner_code_unique" UNIQUE("owner_entity_id","code"),
	CONSTRAINT "network_nodes_source_identity_unique" UNIQUE("owner_entity_id","source_system","external_id"),
	CONSTRAINT "network_nodes_labels_valid" CHECK (length(trim("network_nodes"."code")) > 0 AND length(trim("network_nodes"."source_system")) > 0 AND length(trim("network_nodes"."created_by")) > 0),
	CONSTRAINT "network_nodes_geometry_valid" CHECK (NOT ST_IsEmpty("network_nodes"."geometry") AND ST_IsValid("network_nodes"."geometry") AND ST_NDims("network_nodes"."geometry") = 2),
	CONSTRAINT "network_nodes_geometry_bounds" CHECK (ST_XMin(Box3D("network_nodes"."geometry")) >= -180 AND ST_XMax(Box3D("network_nodes"."geometry")) <= 180 AND ST_YMin(Box3D("network_nodes"."geometry")) >= -90 AND ST_YMax(Box3D("network_nodes"."geometry")) <= 90)
);
--> statement-breakpoint
CREATE TABLE "network_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"segment_code" text NOT NULL,
	"cable_name" text NOT NULL,
	"cable_type_id" uuid,
	"installed_core_count" integer,
	"capacity_validated" boolean DEFAULT false NOT NULL,
	"installation_method" text,
	"road_side" text,
	"start_node_id" uuid,
	"end_node_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"geometry" geometry(Geometry,4326) NOT NULL,
	"source_system" text NOT NULL,
	"source_file" text,
	"external_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_segments_id_scope_unique" UNIQUE("id","owner_entity_id","dataset_id"),
	CONSTRAINT "network_segments_owner_code_unique" UNIQUE("owner_entity_id","segment_code"),
	CONSTRAINT "network_segments_source_identity_unique" UNIQUE("owner_entity_id","source_system","external_id"),
	CONSTRAINT "network_segments_labels_valid" CHECK (length(trim("network_segments"."segment_code")) > 0 AND length(trim("network_segments"."cable_name")) > 0 AND length(trim("network_segments"."source_system")) > 0 AND length(trim("network_segments"."created_by")) > 0),
	CONSTRAINT "network_segments_core_positive" CHECK ("network_segments"."installed_core_count" IS NULL OR "network_segments"."installed_core_count" > 0),
	CONSTRAINT "network_segments_capacity_valid" CHECK (NOT "network_segments"."capacity_validated" OR "network_segments"."installed_core_count" IS NOT NULL),
	CONSTRAINT "network_segments_installation_valid" CHECK ("network_segments"."installation_method" IS NULL OR "network_segments"."installation_method" IN ('BURIAL', 'AERIAL')),
	CONSTRAINT "network_segments_road_side_valid" CHECK ("network_segments"."road_side" IS NULL OR ("network_segments"."road_side" IN ('LEFT', 'RIGHT') AND "network_segments"."start_node_id" IS NOT NULL AND "network_segments"."end_node_id" IS NOT NULL)),
	CONSTRAINT "network_segments_nodes_paired" CHECK (("network_segments"."start_node_id" IS NULL) = ("network_segments"."end_node_id" IS NULL)),
	CONSTRAINT "network_segments_status_valid" CHECK ("network_segments"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "network_segments_version_positive" CHECK ("network_segments"."version" > 0),
	CONSTRAINT "network_segments_geometry_line" CHECK (ST_GeometryType("network_segments"."geometry") IN ('ST_LineString', 'ST_MultiLineString') AND ST_Length("network_segments"."geometry") > 0),
	CONSTRAINT "network_segments_geometry_valid" CHECK (NOT ST_IsEmpty("network_segments"."geometry") AND ST_IsValid("network_segments"."geometry") AND ST_NDims("network_segments"."geometry") = 2),
	CONSTRAINT "network_segments_geometry_bounds" CHECK (ST_XMin(Box3D("network_segments"."geometry")) >= -180 AND ST_XMax(Box3D("network_segments"."geometry")) <= 180 AND ST_YMin(Box3D("network_segments"."geometry")) >= -90 AND ST_YMax(Box3D("network_segments"."geometry")) <= 90)
);
--> statement-breakpoint
CREATE TABLE "odcs" (
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
	CONSTRAINT "odcs_id_scope_unique" UNIQUE("id","owner_entity_id","dataset_id"),
	CONSTRAINT "odcs_owner_code_unique" UNIQUE("owner_entity_id","code"),
	CONSTRAINT "odcs_source_identity_unique" UNIQUE("owner_entity_id","source_system","external_id"),
	CONSTRAINT "odcs_labels_valid" CHECK (length(trim("odcs"."code")) > 0 AND length(trim("odcs"."source_system")) > 0 AND length(trim("odcs"."created_by")) > 0),
	CONSTRAINT "odcs_geometry_valid" CHECK (NOT ST_IsEmpty("odcs"."geometry") AND ST_IsValid("odcs"."geometry") AND ST_NDims("odcs"."geometry") = 2),
	CONSTRAINT "odcs_geometry_bounds" CHECK (ST_XMin(Box3D("odcs"."geometry")) >= -180 AND ST_XMax(Box3D("odcs"."geometry")) <= 180 AND ST_YMin(Box3D("odcs"."geometry")) >= -90 AND ST_YMax(Box3D("odcs"."geometry")) <= 90)
);
--> statement-breakpoint
CREATE TABLE "odps" (
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
	CONSTRAINT "odps_id_scope_unique" UNIQUE("id","owner_entity_id","dataset_id"),
	CONSTRAINT "odps_owner_code_unique" UNIQUE("owner_entity_id","code"),
	CONSTRAINT "odps_source_identity_unique" UNIQUE("owner_entity_id","source_system","external_id"),
	CONSTRAINT "odps_labels_valid" CHECK (length(trim("odps"."code")) > 0 AND length(trim("odps"."source_system")) > 0 AND length(trim("odps"."created_by")) > 0),
	CONSTRAINT "odps_geometry_valid" CHECK (NOT ST_IsEmpty("odps"."geometry") AND ST_IsValid("odps"."geometry") AND ST_NDims("odps"."geometry") = 2),
	CONSTRAINT "odps_geometry_bounds" CHECK (ST_XMin(Box3D("odps"."geometry")) >= -180 AND ST_XMax(Box3D("odps"."geometry")) <= 180 AND ST_YMin(Box3D("odps"."geometry")) >= -90 AND ST_YMax(Box3D("odps"."geometry")) <= 90)
);
--> statement-breakpoint
CREATE TABLE "poles" (
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
	"height_m" integer NOT NULL,
	CONSTRAINT "poles_id_scope_unique" UNIQUE("id","owner_entity_id","dataset_id"),
	CONSTRAINT "poles_owner_code_unique" UNIQUE("owner_entity_id","code"),
	CONSTRAINT "poles_source_identity_unique" UNIQUE("owner_entity_id","source_system","external_id"),
	CONSTRAINT "poles_labels_valid" CHECK (length(trim("poles"."code")) > 0 AND length(trim("poles"."source_system")) > 0 AND length(trim("poles"."created_by")) > 0),
	CONSTRAINT "poles_geometry_valid" CHECK (NOT ST_IsEmpty("poles"."geometry") AND ST_IsValid("poles"."geometry") AND ST_NDims("poles"."geometry") = 2),
	CONSTRAINT "poles_geometry_bounds" CHECK (ST_XMin(Box3D("poles"."geometry")) >= -180 AND ST_XMax(Box3D("poles"."geometry")) <= 180 AND ST_YMin(Box3D("poles"."geometry")) >= -90 AND ST_YMax(Box3D("poles"."geometry")) <= 90),
	CONSTRAINT "poles_height_valid" CHECK ("poles"."height_m" IN (7, 9))
);
--> statement-breakpoint
CREATE TABLE "segment_odcs" (
	"segment_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	CONSTRAINT "segment_odcs_segment_id_asset_id_pk" PRIMARY KEY("segment_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "segment_odps" (
	"segment_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	CONSTRAINT "segment_odps_segment_id_asset_id_pk" PRIMARY KEY("segment_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "segment_poles" (
	"segment_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	CONSTRAINT "segment_poles_segment_id_asset_id_pk" PRIMARY KEY("segment_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "network_datasets" ADD CONSTRAINT "network_datasets_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_nodes" ADD CONSTRAINT "network_nodes_dataset_id_owner_entity_id_network_datasets_id_owner_entity_id_fk" FOREIGN KEY ("dataset_id","owner_entity_id") REFERENCES "public"."network_datasets"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_segments" ADD CONSTRAINT "network_segments_cable_type_id_cable_types_id_fk" FOREIGN KEY ("cable_type_id") REFERENCES "public"."cable_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_segments" ADD CONSTRAINT "network_segments_dataset_id_owner_entity_id_network_datasets_id_owner_entity_id_fk" FOREIGN KEY ("dataset_id","owner_entity_id") REFERENCES "public"."network_datasets"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_segments" ADD CONSTRAINT "network_segments_start_node_id_owner_entity_id_dataset_id_network_nodes_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("start_node_id","owner_entity_id","dataset_id") REFERENCES "public"."network_nodes"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_segments" ADD CONSTRAINT "network_segments_end_node_id_owner_entity_id_dataset_id_network_nodes_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("end_node_id","owner_entity_id","dataset_id") REFERENCES "public"."network_nodes"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odcs" ADD CONSTRAINT "odcs_dataset_id_owner_entity_id_network_datasets_id_owner_entity_id_fk" FOREIGN KEY ("dataset_id","owner_entity_id") REFERENCES "public"."network_datasets"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odps" ADD CONSTRAINT "odps_dataset_id_owner_entity_id_network_datasets_id_owner_entity_id_fk" FOREIGN KEY ("dataset_id","owner_entity_id") REFERENCES "public"."network_datasets"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poles" ADD CONSTRAINT "poles_dataset_id_owner_entity_id_network_datasets_id_owner_entity_id_fk" FOREIGN KEY ("dataset_id","owner_entity_id") REFERENCES "public"."network_datasets"("id","owner_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_odcs" ADD CONSTRAINT "segment_odcs_segment_id_owner_entity_id_dataset_id_network_segments_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("segment_id","owner_entity_id","dataset_id") REFERENCES "public"."network_segments"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_odcs" ADD CONSTRAINT "segment_odcs_asset_id_owner_entity_id_dataset_id_odcs_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("asset_id","owner_entity_id","dataset_id") REFERENCES "public"."odcs"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_odps" ADD CONSTRAINT "segment_odps_segment_id_owner_entity_id_dataset_id_network_segments_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("segment_id","owner_entity_id","dataset_id") REFERENCES "public"."network_segments"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_odps" ADD CONSTRAINT "segment_odps_asset_id_owner_entity_id_dataset_id_odps_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("asset_id","owner_entity_id","dataset_id") REFERENCES "public"."odps"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_poles" ADD CONSTRAINT "segment_poles_segment_id_owner_entity_id_dataset_id_network_segments_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("segment_id","owner_entity_id","dataset_id") REFERENCES "public"."network_segments"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_poles" ADD CONSTRAINT "segment_poles_asset_id_owner_entity_id_dataset_id_poles_id_owner_entity_id_dataset_id_fk" FOREIGN KEY ("asset_id","owner_entity_id","dataset_id") REFERENCES "public"."poles"("id","owner_entity_id","dataset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "network_datasets_owner_status_idx" ON "network_datasets" USING btree ("owner_entity_id","status");--> statement-breakpoint
CREATE INDEX "network_nodes_geometry_gist" ON "network_nodes" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "network_nodes_owner_dataset_idx" ON "network_nodes" USING btree ("owner_entity_id","dataset_id");--> statement-breakpoint
CREATE INDEX "network_segments_geometry_gist" ON "network_segments" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "network_segments_owner_dataset_idx" ON "network_segments" USING btree ("owner_entity_id","dataset_id");--> statement-breakpoint
CREATE INDEX "odcs_geometry_gist" ON "odcs" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "odcs_owner_dataset_idx" ON "odcs" USING btree ("owner_entity_id","dataset_id");--> statement-breakpoint
CREATE INDEX "odps_geometry_gist" ON "odps" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "odps_owner_dataset_idx" ON "odps" USING btree ("owner_entity_id","dataset_id");--> statement-breakpoint
CREATE INDEX "poles_geometry_gist" ON "poles" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "poles_owner_dataset_idx" ON "poles" USING btree ("owner_entity_id","dataset_id");--> statement-breakpoint
CREATE INDEX "segment_odcs_asset_id_index" ON "segment_odcs" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "segment_odps_asset_id_index" ON "segment_odps" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "segment_poles_asset_id_index" ON "segment_poles" USING btree ("asset_id");