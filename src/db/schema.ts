import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Pathways data model (v0) — see /docs/scope-v1.md and ProjectOS software/pathways.
 *
 * This run (DEV-148/DEV-149) populates: programs (CSC), actions (CSC checklist),
 * municipalities + certifications + completions (participating-communities portal).
 * CEC ingestion and the crosswalk are separate pending tasks; their tables exist
 * here so later tasks can ingest without schema churn.
 */

/** Data programs (CSC = NYSDEC Climate Smart Communities, CEC = NYSERDA Clean Energy Communities). */
export const programs = pgTable("programs", {
  slug: text("slug").primaryKey(), // 'csc' | 'cec'
  name: text("name").notNull(),
  agency: text("agency"),
  status: text("status").notNull().default("active"), // 'active' | 'closed'
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Municipalities (CSC applicants: cities, towns, villages, counties). */
export const municipalities = pgTable("municipalities", {
  portalUid: integer("portal_uid").primaryKey(), // CSC portal applicant uid
  name: text("name").notNull(),
  areaType: text("area_type"), // 'city' | 'town' | 'village' | 'county'
  county: text("county"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  // Current CSC certification level: 0 = registered only, 2 = bronze, 4 = silver, 6 = gold.
  certificationLevel: integer("certification_level"),
  certificationLevelName: text("certification_level_name"),
  certUid: integer("cert_uid"), // latest certification uid, null when only registered
  hasGoldStar: boolean("has_gold_star").notNull().default(false),
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Certification actions library (from the official CSC Certification Action
 * Checklist XLSX). One row per action; variable point tiers keep min/max plus
 * the raw display string.
 */
export const actions = pgTable(
  "actions",
  {
    id: serial("id").primaryKey(),
    programSlug: text("program_slug")
      .notNull()
      .references(() => programs.slug),
    externalId: text("external_id").notNull(), // stable slug of the action name
    name: text("name").notNull(),
    pledgeElement: text("pledge_element").notNull(), // 'PE1'..'PE10' | 'Innovation' | 'Performance'
    legacyActionNo: text("legacy_action_no"),
    legacyActionName: text("legacy_action_name"),
    pointsMin: integer("points_min"),
    pointsMax: integer("points_max"),
    pointsDisplay: text("points_display"), // raw checklist value, e.g. "12 - 16"
    variablePoints: boolean("variable_points").notNull().default(false),
    mandatory: boolean("mandatory").notNull().default(false),
    priority: boolean("priority").notNull().default(false),
    fundingEligible: boolean("funding_eligible").notNull().default(false), // "CSC Grants" tag
    cecRelated: boolean("cec_related").notNull().default(false), // "CEC" tag
    statusTags: jsonb("status_tags").$type<string[]>().notNull().default([]),
    sourceUrl: text("source_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("actions_program_external_id_key").on(t.programSlug, t.externalId),
  ],
);

/** A community's certification record (points approved, level, report link). */
export const certifications = pgTable("certifications", {
  certUid: integer("cert_uid").primaryKey(), // CSC portal certification uid
  municipalityUid: integer("municipality_uid")
    .notNull()
    .references(() => municipalities.portalUid),
  name: text("name").notNull(), // e.g. "Plattsburgh - Oct 2023 Certification"
  level: integer("level").notNull(),
  levelName: text("level_name").notNull(),
  pointsApproved: integer("points_approved"),
  certifiedOn: date("certified_on"), // parsed from "October 02, 2023"
  reportUrl: text("report_url"),
  applicantUrl: text("applicant_url"), // municipality-detail page
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Completed actions per community, parsed from certification report pages.
 * actionExternalId is null when the report's action name doesn't match the
 * current checklist (renamed/retired actions) — rawActionName preserves the
 * original so future crosswalk/mapping passes can repair it.
 */
export const completions = pgTable(
  "completions",
  {
    id: serial("id").primaryKey(),
    certificationUid: integer("certification_uid")
      .notNull()
      .references(() => certifications.certUid),
    municipalityUid: integer("municipality_uid")
      .notNull()
      .references(() => municipalities.portalUid),
    actionExternalId: text("action_external_id"),
    rawActionName: text("raw_action_name").notNull(),
    pointsAwarded: integer("points_awarded"),
    summary: text("summary"),
    sourceUrl: text("source_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("completions_cert_raw_action_key").on(t.certificationUid, t.rawActionName),
  ],
);

/** CEC ↔ CSC action equivalence (CEC ingestion task pending). */
export const crosswalk = pgTable("crosswalk", {
  id: serial("id").primaryKey(),
  cscActionExternalId: text("csc_action_external_id"),
  cecHiaId: text("cec_hia_id"),
  cecHiaName: text("cec_hia_name"),
  note: text("note"),
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CEC designation + Advanced (v3.0) star status per municipality, from the
 * NYSERDA CEC map/scorecard underlying tables (vCEC_PROJECTS +
 * vCEC_PROJECT_POINT_TOTALS). The CEC program is closed (NYSERDA) — this data
 * is historical/frozen. One row per CEC-tracked municipality (942 as of the
 * 2026-09-21 snapshot: 605 designated + 337 not designated).
 */
export const cecDesignations = pgTable("cec_designations", {
  municipalityUid: integer("municipality_uid")
    .primaryKey()
    .references(() => municipalities.portalUid),
  cecCommunityId: text("cec_community_id"), // NYSERDA CEC id, e.g. "CEC300436"
  status: text("status").notNull(), // 'Designated CEC' | 'Not Designated'
  designationStatus: text("designation_status"), // 'Designated CEC' | 'Advanced (v3.0) Communities'
  advancedDesignation: text("advanced_designation"), // '1-Star'..'5-Star' | null
  starRating: text("star_rating"), // display form, e.g. "(★★)"
  communitySize: text("community_size"), // 'Small community' | 'Medium community' | 'Large community'
  region: text("region"), // REDC region, e.g. 'Mid-Hudson'
  geoId: text("geo_id"), // census GeoID from the CEC map points layer
  population: integer("population"),
  hiasApproved: integer("hias_approved"), // 'Advanced (v3.0) HIAs Approved' count
  pointsAchievedNew: integer("points_achieved_new"),
  pointsAchievedOld: integer("points_achieved_old"),
  pointsAchievedTotal: integer("points_achieved_total"),
  currentStarStatus: text("current_star_status"),
  lastThreshold: integer("last_threshold"),
  nextThreshold: integer("next_threshold"),
  tillNextStar: integer("till_next_star"),
  latestActionApprovedOn: date("latest_action_approved_on"),
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Completed CEC High-Impact Actions per community, action-grain (from the
 * NYSERDA CEC scorecard underlying vCEC_PROJECTS table, one row per completed
 * action; program closed — frozen). rawActionName is kept verbatim; the
 * (municipality, raw name, completed_on) triple is the idempotency key.
 * completedOn falls back to the approval date, then a 1900-01-01 sentinel when
 * the source publishes neither (flagged as a WARN by the ingest script).
 */
export const cecCompletions = pgTable(
  "cec_completions",
  {
    id: serial("id").primaryKey(),
    municipalityUid: integer("municipality_uid")
      .notNull()
      .references(() => municipalities.portalUid),
    actionExternalId: text("action_external_id"), // slug into actions (program cec); null when unmatched
    rawActionName: text("raw_action_name").notNull(),
    parentCategory: text("parent_category").notNull(),
    pointsApproved: integer("points_approved"),
    pointsCurrentlyValued: integer("points_currently_valued"),
    pointsAchieved: integer("points_achieved"),
    pointsEligible: integer("points_eligible"),
    actionStage: text("action_stage"), // e.g. 'NYSERDA Approved'
    actionStatus: text("action_status"), // e.g. 'Approval'
    completedOn: date("completed_on").notNull(),
    approvedOn: date("approved_on"),
    sourceUrl: text("source_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("cec_completions_municipality_action_date_key").on(
      t.municipalityUid,
      t.rawActionName,
      t.completedOn,
    ),
  ],
);

/** Certification level thresholds (Bronze/Silver/Gold). Point thresholds to be
 * verified from CSC docs in a later task; the uid→level mapping is from the
 * portal's rankToLevel config (2=bronze, 4=silver). */
export const certificationLevels = pgTable("certification_levels", {
  level: integer("level").primaryKey(), // portal rank value: 2, 4, 6
  levelName: text("level_name").notNull(),
  pointsRequired: integer("points_required"),
  notes: text("notes"),
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});