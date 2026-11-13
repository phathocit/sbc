import { pgTable, uuid, timestamp, primaryKey, foreignKey, index } from "drizzle-orm/pg-core";
import { platformAdmins } from "./platform-settings.js";
import { outboxMessages } from "./outbox-messages.js";

export const platformNotificationReads = pgTable("platform_notification_reads", {
  userId: uuid("user_id").notNull(),
  notificationId: uuid("notification_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: "platform_notification_reads_pk", columns: [table.userId, table.notificationId] }),
  foreignKey({ name: "platform_notification_reads_admin_fk", columns: [table.userId], foreignColumns: [platformAdmins.userId] }).onDelete("cascade"),
  foreignKey({ name: "platform_notification_reads_notification_fk", columns: [table.notificationId], foreignColumns: [outboxMessages.id] }).onDelete("cascade"),
  index("platform_notification_reads_notification_idx").on(table.notificationId),
]);

export type PlatformNotificationRead = typeof platformNotificationReads.$inferSelect;
