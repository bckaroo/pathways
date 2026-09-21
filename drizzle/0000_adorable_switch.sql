CREATE TABLE "actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_slug" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"pledge_element" text NOT NULL,
	"legacy_action_no" text,
	"legacy_action_name" text,
	"points_min" integer,
	"points_max" integer,
	"points_display" text,
	"variable_points" boolean DEFAULT false NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"priority" boolean DEFAULT false NOT NULL,
	"funding_eligible" boolean DEFAULT false NOT NULL,
	"cec_related" boolean DEFAULT false NOT NULL,
	"status_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_program_external_id_key" UNIQUE("program_slug","external_id")
);
--> statement-breakpoint
CREATE TABLE "certification_levels" (
	"level" integer PRIMARY KEY NOT NULL,
	"level_name" text NOT NULL,
	"points_required" integer,
	"notes" text,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"cert_uid" integer PRIMARY KEY NOT NULL,
	"municipality_uid" integer NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"level_name" text NOT NULL,
	"points_approved" integer,
	"certified_on" date,
	"report_url" text,
	"applicant_url" text,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"certification_uid" integer NOT NULL,
	"municipality_uid" integer NOT NULL,
	"action_external_id" text,
	"raw_action_name" text NOT NULL,
	"points_awarded" integer,
	"summary" text,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completions_cert_raw_action_key" UNIQUE("certification_uid","raw_action_name")
);
--> statement-breakpoint
CREATE TABLE "crosswalk" (
	"id" serial PRIMARY KEY NOT NULL,
	"csc_action_external_id" text,
	"cec_hia_id" text,
	"cec_hia_name" text,
	"note" text,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "municipalities" (
	"portal_uid" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"area_type" text,
	"county" text,
	"latitude" real,
	"longitude" real,
	"certification_level" integer,
	"certification_level_name" text,
	"cert_uid" integer,
	"has_gold_star" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"agency" text,
	"status" text DEFAULT 'active' NOT NULL,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_program_slug_programs_slug_fk" FOREIGN KEY ("program_slug") REFERENCES "public"."programs"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_municipality_uid_municipalities_portal_uid_fk" FOREIGN KEY ("municipality_uid") REFERENCES "public"."municipalities"("portal_uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_certification_uid_certifications_cert_uid_fk" FOREIGN KEY ("certification_uid") REFERENCES "public"."certifications"("cert_uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_municipality_uid_municipalities_portal_uid_fk" FOREIGN KEY ("municipality_uid") REFERENCES "public"."municipalities"("portal_uid") ON DELETE no action ON UPDATE no action;