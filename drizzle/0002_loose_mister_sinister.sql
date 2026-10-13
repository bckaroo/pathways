ALTER TABLE "actions" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "tier" integer;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "tree_why" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "prereq_external_ids" jsonb;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "lookback" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "cobenefits" jsonb;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "jurisdiction" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "point_ceiling" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "levels" jsonb;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "required_actions" jsonb;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "categories" jsonb;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "category_names" jsonb;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "tiers" jsonb;