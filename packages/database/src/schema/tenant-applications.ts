import { pgTable, uuid, varchar, timestamp, text, foreignKey, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";
import { tenants } from "./tenants.js";
import { platformAdmins } from "./platform-settings.js";

export const tenantApplications = pgTable("tenant_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicantUserId: uuid("applicant_user_id"),
  applicantName: varchar("applicant_name", { length: 255 }).notNull(),
  applicantEmail: varchar("applicant_email", { length: 255 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 32 }).notNull(),
  serviceType: varchar("service_type", { length: 120 }).notNull(),
  requestedPlan: varchar("requested_plan", { length: 24 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 63 }).notNull(),
  timezone: varchar("timezone", { length: 100 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  tenantId: uuid("tenant_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "tenant_applications_applicant_fk", columns: [table.applicantUserId], foreignColumns: [users.id] }).onDelete("restrict"),
  foreignKey({ name: "tenant_applications_reviewer_fk", columns: [table.reviewedBy], foreignColumns: [platformAdmins.userId] }).onDelete("restrict"),
  foreignKey({ name: "tenant_applications_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
  check("tenant_applications_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  check("tenant_applications_requested_plan_valid", sql`${table.requestedPlan} ~ '^[a-z0-9][a-z0-9_-]{0,23}$'`),
  check("tenant_applications_review_state_valid", sql`(${table.status} = 'pending' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.tenantId} IS NULL) OR (${table.status} = 'approved' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.tenantId} IS NOT NULL) OR (${table.status} = 'rejected' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.tenantId} IS NULL)`),
  index("tenant_applications_status_created_idx").on(table.status, table.createdAt),
  uniqueIndex("tenant_applications_pending_applicant_uidx").on(table.applicantUserId).where(sql`${table.status} = 'pending'`),
  uniqueIndex("tenant_applications_pending_email_uidx").on(table.applicantEmail).where(sql`${table.status} = 'pending'`),
  uniqueIndex("tenant_applications_pending_slug_uidx").on(table.slug).where(sql`${table.status} = 'pending'`),
]);

export const tenantOwnerInvitations = pgTable("tenant_owner_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "tenant_owner_invitations_application_fk", columns: [table.applicationId], foreignColumns: [tenantApplications.id] }).onDelete("cascade"),
  foreignKey({ name: "tenant_owner_invitations_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("cascade"),
  uniqueIndex("tenant_owner_invitations_application_uidx").on(table.applicationId),
  uniqueIndex("tenant_owner_invitations_token_hash_uidx").on(table.tokenHash),
  index("tenant_owner_invitations_tenant_idx").on(table.tenantId),
]);

export type TenantApplication = typeof tenantApplications.$inferSelect;
export type NewTenantApplication = typeof tenantApplications.$inferInsert;
