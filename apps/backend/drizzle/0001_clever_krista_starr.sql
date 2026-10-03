CREATE TABLE "access_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"subject_user_id" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_code_unique" UNIQUE("code"),
	CONSTRAINT "entities_code_format" CHECK ("entities"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
	CONSTRAINT "entities_name_not_blank" CHECK (length(trim("entities"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "membership_roles_membership_id_role_id_pk" PRIMARY KEY("membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_entity_unique" UNIQUE("user_id","entity_id"),
	CONSTRAINT "memberships_id_entity_unique" UNIQUE("id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	CONSTRAINT "permissions_code_format" CHECK ("permissions"."code" ~ '^[a-z][a-z0-9_-]*[.][a-z][a-z0-9_-]*$')
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "roles_entity_code_unique" UNIQUE("entity_id","code"),
	CONSTRAINT "roles_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "roles_code_format" CHECK ("roles"."code" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "access_audit" ADD CONSTRAINT "access_audit_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_entity_id_memberships_id_entity_id_fk" FOREIGN KEY ("membership_id","entity_id") REFERENCES "public"."memberships"("id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_entity_id_roles_id_entity_id_fk" FOREIGN KEY ("role_id","entity_id") REFERENCES "public"."roles"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_audit_entity_created_idx" ON "access_audit" USING btree ("entity_id","created_at");
