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
}, (table) => [index("ro_verification_status_idx").on(table.status, table.diagnosedAt)]);
