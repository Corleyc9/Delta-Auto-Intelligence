import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const roDiagnosisWatch = sqliteTable("ro_diagnosis_watch", {
  roNumber: text("ro_number").primaryKey(),
  needsDiagPresent: integer("needs_diag_present").notNull().default(0),
  lastLabel: text("last_label").notNull().default(""),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const roVerificationCycles = sqliteTable("ro_verification_cycles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roNumber: text("ro_number").notNull(),
  customer: text("customer").notNull(),
  vehicle: text("vehicle").notNull(),
  serviceWriter: text("service_writer").notNull(),
  detailUrl: text("detail_url").notNull().default(""),
  amount: real("amount").notNull().default(0),
  section: text("section").notNull(),
  diagnosedAt: text("diagnosed_at").notNull(),
  verifyLabelSeenAt: text("verify_label_seen_at"),
  status: text("status").notNull().default("pending"),
  verifiedAt: text("verified_at"),
  verifiedBy: text("verified_by"),
  verificationNote: text("verification_note").notNull().default(""),
  lastSeenAt: text("last_seen_at").notNull(),
  tekmetricLabelStatus: text("tekmetric_label_status").notNull().default(""),
  tekmetricLabelTarget: text("tekmetric_label_target").notNull().default(""),
  tekmetricLabelError: text("tekmetric_label_error").notNull().default(""),
  tekmetricLabelUpdatedAt: text("tekmetric_label_updated_at"),
  tekmetricLabelJobId: integer("tekmetric_label_job_id"),
}, (table) => [index("ro_verification_status_idx").on(table.status, table.diagnosedAt)]);

export const tekmetricLabelJobs = sqliteTable("tekmetric_label_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roNumber: text("ro_number").notNull(),
  verificationId: integer("verification_id"),
  targetLabel: text("target_label").notNull(),
  currentLabel: text("current_label").notNull().default(""),
  detailUrl: text("detail_url").notNull().default(""),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  claimedAt: text("claimed_at"),
  completedAt: text("completed_at"),
  lastError: text("last_error").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("tekmetric_label_jobs_status_idx").on(table.status, table.createdAt),
  index("tekmetric_label_jobs_ro_idx").on(table.roNumber, table.createdAt),
]);
