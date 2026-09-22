CREATE TABLE "cec_completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"municipality_uid" integer NOT NULL,
	"action_external_id" text,
	"raw_action_name" text NOT NULL,
	"parent_category" text NOT NULL,
	"points_approved" integer,
	"points_currently_valued" integer,
	"points_achieved" integer,
	"points_eligible" integer,
	"action_stage" text,
	"action_status" text,
	"completed_on" date NOT NULL,
	"approved_on" date,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cec_completions_municipality_action_date_key" UNIQUE("municipality_uid","raw_action_name","completed_on")
);
--> statement-breakpoint
CREATE TABLE "cec_designations" (
	"municipality_uid" integer PRIMARY KEY NOT NULL,
	"cec_community_id" text,
	"status" text NOT NULL,
	"designation_status" text,
	"advanced_designation" text,
	"star_rating" text,
	"community_size" text,
	"region" text,
	"geo_id" text,
	"population" integer,
	"hias_approved" integer,
	"points_achieved_new" integer,
	"points_achieved_old" integer,
	"points_achieved_total" integer,
	"current_star_status" text,
	"last_threshold" integer,
	"next_threshold" integer,
	"till_next_star" integer,
	"latest_action_approved_on" date,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cec_completions" ADD CONSTRAINT "cec_completions_municipality_uid_municipalities_portal_uid_fk" FOREIGN KEY ("municipality_uid") REFERENCES "public"."municipalities"("portal_uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cec_designations" ADD CONSTRAINT "cec_designations_municipality_uid_municipalities_portal_uid_fk" FOREIGN KEY ("municipality_uid") REFERENCES "public"."municipalities"("portal_uid") ON DELETE no action ON UPDATE no action;