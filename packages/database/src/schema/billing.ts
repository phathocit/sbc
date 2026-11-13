import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  text,
  jsonb,
  foreignKey,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants.js";
import { platformAdmins } from "./platform-settings.js";

/**
 * Versioned commercial catalog. Published versions should be treated as
 * immutable once referenced by a subscription or order.
 */
export const planCatalog = pgTable("plan_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 24 }).notNull(),
  version: integer("version").notNull(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  priceVnd: integer("price_vnd").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("VND"),
  activeStaffLimit: integer("active_staff_limit").notNull(),
  monthlyBookingLimit: integer("monthly_booking_limit"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  features: jsonb("features").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("plan_catalog_code_version_uidx").on(table.code, table.version),
  uniqueIndex("plan_catalog_one_active_version_uidx").on(table.code).where(sql`${table.isActive} = true`),
  index("plan_catalog_active_idx").on(table.isActive, table.code),
  check("plan_catalog_code_valid", sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{0,23}$'`),
  check("plan_catalog_version_positive", sql`${table.version} > 0`),
  check("plan_catalog_price_nonnegative", sql`${table.priceVnd} >= 0`),
  check("plan_catalog_staff_limit_positive", sql`${table.activeStaffLimit} > 0`),
  check("plan_catalog_booking_limit_nonnegative", sql`${table.monthlyBookingLimit} IS NULL OR ${table.monthlyBookingLimit} >= 0`),
  check("plan_catalog_currency_vnd", sql`${table.currency} = 'VND'`),
  check("plan_catalog_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  check("plan_catalog_features_array", sql`jsonb_typeof(${table.features}) = 'array'`),
]);

/** One current subscription row per tenant; historical purchases stay in orders. */
export const tenantSubscriptions = pgTable("tenant_subscriptions", {
  tenantId: uuid("tenant_id").primaryKey(),
  planId: uuid("plan_id").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "tenant_subscriptions_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("cascade"),
  foreignKey({ name: "tenant_subscriptions_plan_fk", columns: [table.planId], foreignColumns: [planCatalog.id] }).onDelete("restrict"),
  index("tenant_subscriptions_plan_status_idx").on(table.planId, table.status),
  index("tenant_subscriptions_period_end_idx").on(table.status, table.currentPeriodEnd),
  check("tenant_subscriptions_status_valid", sql`${table.status} IN ('active', 'past_due', 'expired')`),
  check("tenant_subscriptions_period_valid", sql`${table.currentPeriodStart} < ${table.currentPeriodEnd}`),
]);

export const billingOrders = pgTable("billing_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  targetPlanId: uuid("target_plan_id").notNull(),
  provider: varchar("provider", { length: 16 }).notNull(),
  orderReference: varchar("order_reference", { length: 100 }).notNull(),
  amountVnd: integer("amount_vnd").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("VND"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "billing_orders_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
  foreignKey({ name: "billing_orders_plan_fk", columns: [table.targetPlanId], foreignColumns: [planCatalog.id] }).onDelete("restrict"),
  uniqueIndex("billing_orders_order_reference_uidx").on(table.orderReference),
  uniqueIndex("billing_orders_tenant_id_id_uidx").on(table.tenantId, table.id),
  index("billing_orders_tenant_created_idx").on(table.tenantId, table.createdAt),
  index("billing_orders_expiry_idx").on(table.status, table.expiresAt),
  check("billing_orders_provider_valid", sql`${table.provider} IN ('vnpay', 'momo')`),
  check("billing_orders_status_valid", sql`${table.status} IN ('pending', 'paid', 'paid_review', 'failed', 'expired', 'cancelled', 'refunded')`),
  check("billing_orders_amount_positive", sql`${table.amountVnd} > 0`),
  check("billing_orders_currency_vnd", sql`${table.currency} = 'VND'`),
  check("billing_orders_paid_state_valid", sql`(${table.status} IN ('paid', 'paid_review', 'refunded') AND ${table.paidAt} IS NOT NULL) OR (${table.status} NOT IN ('paid', 'paid_review', 'refunded') AND ${table.paidAt} IS NULL)`),
]);

export const paymentAttempts = pgTable("payment_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  provider: varchar("provider", { length: 16 }).notNull(),
  providerRequestId: varchar("provider_request_id", { length: 128 }).notNull(),
  providerOrderReference: varchar("provider_order_reference", { length: 128 }).notNull(),
  providerTransactionId: varchar("provider_transaction_id", { length: 128 }),
  providerPaidAt: timestamp("provider_paid_at", { withTimezone: true }),
  checkoutUrl: text("checkout_url"),
  status: varchar("status", { length: 24 }).notNull().default("initializing"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "payment_attempts_order_fk", columns: [table.orderId], foreignColumns: [billingOrders.id] }).onDelete("restrict"),
  uniqueIndex("payment_attempts_provider_request_uidx").on(table.provider, table.providerRequestId),
  uniqueIndex("payment_attempts_provider_order_uidx").on(table.provider, table.providerOrderReference),
  uniqueIndex("payment_attempts_provider_transaction_uidx").on(table.provider, table.providerTransactionId).where(sql`${table.providerTransactionId} IS NOT NULL`),
  index("payment_attempts_order_created_idx").on(table.orderId, table.createdAt),
  check("payment_attempts_provider_valid", sql`${table.provider} IN ('vnpay', 'momo')`),
  check("payment_attempts_status_valid", sql`${table.status} IN ('initializing', 'pending', 'succeeded', 'failed', 'expired', 'cancelled')`),
  check("payment_attempts_completion_state_valid", sql`(${table.status} IN ('succeeded', 'failed', 'expired', 'cancelled') AND ${table.completedAt} IS NOT NULL) OR (${table.status} IN ('initializing', 'pending') AND ${table.completedAt} IS NULL)`),
]);

/** Only signature-verified provider events are inserted into this inbox. */
export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 16 }).notNull(),
  eventKey: varchar("event_key", { length: 255 }).notNull(),
  orderId: uuid("order_id").notNull(),
  paymentAttemptId: uuid("payment_attempt_id").notNull(),
  signatureVerified: boolean("signature_verified").notNull(),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("received"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "payment_webhook_events_order_fk", columns: [table.orderId], foreignColumns: [billingOrders.id] }).onDelete("restrict"),
  foreignKey({ name: "payment_webhook_events_attempt_fk", columns: [table.paymentAttemptId], foreignColumns: [paymentAttempts.id] }).onDelete("restrict"),
  uniqueIndex("payment_webhook_events_provider_event_uidx").on(table.provider, table.eventKey),
  index("payment_webhook_events_processing_idx").on(table.status, table.receivedAt),
  check("payment_webhook_events_provider_valid", sql`${table.provider} IN ('vnpay', 'momo')`),
  check("payment_webhook_events_status_valid", sql`${table.status} IN ('received', 'processed', 'failed')`),
  check("payment_webhook_events_verified_only", sql`${table.signatureVerified} = true`),
  check("payment_webhook_events_processing_state_valid", sql`(${table.status} = 'processed' AND ${table.processedAt} IS NOT NULL) OR (${table.status} <> 'processed' AND ${table.processedAt} IS NULL)`),
]);

/** Audit trail for authenticated platform-admin provider status queries. */
export const paymentReconciliations = pgTable("payment_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  initiatedBy: uuid("initiated_by").notNull(),
  requestId: varchar("request_id", { length: 32 }).notNull().unique(),
  outcome: varchar("outcome", { length: 16 }).notNull().default("started"),
  responseCode: varchar("response_code", { length: 32 }),
  transactionStatus: varchar("transaction_status", { length: 32 }),
  transactionNo: varchar("transaction_no", { length: 128 }),
  message: varchar("message", { length: 255 }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "payment_reconciliations_order_fk", columns: [table.orderId], foreignColumns: [billingOrders.id] }).onDelete("restrict"),
  foreignKey({ name: "payment_reconciliations_admin_fk", columns: [table.initiatedBy], foreignColumns: [platformAdmins.userId] }).onDelete("restrict"),
  index("payment_reconciliations_order_requested_idx").on(table.orderId, table.requestedAt),
  check("payment_reconciliations_outcome_valid", sql`${table.outcome} IN ('started', 'paid', 'paid_review', 'not_paid', 'error')`),
  check("payment_reconciliations_completion_state_valid", sql`(${table.outcome} = 'started' AND ${table.completedAt} IS NULL) OR (${table.outcome} <> 'started' AND ${table.completedAt} IS NOT NULL)`),
]);

/** Full-refund requests are durable before the provider call; ambiguous results must be queried, never resent with a new ID. */
export const paymentRefundRequests = pgTable("payment_refund_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  provider: varchar("provider", { length: 16 }).notNull(),
  providerRequestId: varchar("provider_request_id", { length: 128 }).notNull(),
  providerRefundOrderId: varchar("provider_refund_order_id", { length: 128 }).notNull(),
  amountVnd: integer("amount_vnd").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  initiatedBy: uuid("initiated_by").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("started"),
  responseCode: varchar("response_code", { length: 32 }),
  transactionStatus: varchar("transaction_status", { length: 32 }),
  providerTransactionId: varchar("provider_transaction_id", { length: 128 }),
  message: varchar("message", { length: 255 }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "payment_refund_requests_order_fk", columns: [table.orderId], foreignColumns: [billingOrders.id] }).onDelete("restrict"),
  foreignKey({ name: "payment_refund_requests_admin_fk", columns: [table.initiatedBy], foreignColumns: [platformAdmins.userId] }).onDelete("restrict"),
  uniqueIndex("payment_refund_requests_provider_request_uidx").on(table.provider, table.providerRequestId),
  uniqueIndex("payment_refund_requests_provider_order_uidx").on(table.provider, table.providerRefundOrderId),
  uniqueIndex("payment_refund_requests_one_success_uidx").on(table.orderId).where(sql`${table.status} = 'succeeded'`),
  uniqueIndex("payment_refund_requests_one_open_uidx").on(table.orderId).where(sql`${table.status} IN ('started', 'pending', 'unknown')`),
  index("payment_refund_requests_order_requested_idx").on(table.orderId, table.requestedAt),
  check("payment_refund_requests_provider_valid", sql`${table.provider} IN ('vnpay', 'momo')`),
  check("payment_refund_requests_amount_positive", sql`${table.amountVnd} > 0`),
  check("payment_refund_requests_reason_nonempty", sql`length(trim(${table.reason})) BETWEEN 3 AND 500`),
  check("payment_refund_requests_status_valid", sql`${table.status} IN ('started', 'pending', 'succeeded', 'failed', 'unknown')`),
  check("payment_refund_requests_completion_state_valid", sql`(${table.status} IN ('succeeded', 'failed') AND ${table.completedAt} IS NOT NULL) OR (${table.status} IN ('started', 'pending', 'unknown') AND ${table.completedAt} IS NULL)`),
]);

/** Atomic period counter; incremented in the same transaction as booking creation. */
export const tenantBookingUsage = pgTable("tenant_booking_usage", {
  tenantId: uuid("tenant_id").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  bookingCount: integer("booking_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "tenant_booking_usage_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("cascade"),
  uniqueIndex("tenant_booking_usage_tenant_period_uidx").on(table.tenantId, table.periodStart),
  index("tenant_booking_usage_period_end_idx").on(table.periodEnd),
  check("tenant_booking_usage_period_valid", sql`${table.periodStart} < ${table.periodEnd}`),
  check("tenant_booking_usage_count_nonnegative", sql`${table.bookingCount} >= 0`),
]);

export const tenantPlanChanges = pgTable("tenant_plan_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  fromPlanId: uuid("from_plan_id"),
  toPlanId: uuid("to_plan_id").notNull(),
  note: varchar("note", { length: 1000 }).notNull(),
  changeType: varchar("change_type", { length: 32 }).notNull().default("support_grant"),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "tenant_plan_changes_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("cascade"),
  foreignKey({ name: "tenant_plan_changes_actor_fk", columns: [table.actorUserId], foreignColumns: [platformAdmins.userId] }).onDelete("restrict"),
  foreignKey({ name: "tenant_plan_changes_from_plan_fk", columns: [table.fromPlanId], foreignColumns: [planCatalog.id] }).onDelete("restrict"),
  foreignKey({ name: "tenant_plan_changes_to_plan_fk", columns: [table.toPlanId], foreignColumns: [planCatalog.id] }).onDelete("restrict"),
  index("tenant_plan_changes_tenant_changed_idx").on(table.tenantId, table.changedAt),
  check("tenant_plan_changes_note_nonempty", sql`length(trim(${table.note})) BETWEEN 3 AND 1000`),
  check("tenant_plan_changes_type_valid", sql`${table.changeType} IN ('support_grant', 'paid_review_applied', 'refund_reversal')`),
]);

export type PlanCatalogEntry = typeof planCatalog.$inferSelect;
export type NewPlanCatalogEntry = typeof planCatalog.$inferInsert;
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
export type BillingOrder = typeof billingOrders.$inferSelect;
export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;
export type PaymentRefundRequest = typeof paymentRefundRequests.$inferSelect;
export type TenantBookingUsage = typeof tenantBookingUsage.$inferSelect;
export type TenantPlanChange = typeof tenantPlanChanges.$inferSelect;
