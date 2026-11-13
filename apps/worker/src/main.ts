import { config } from 'dotenv';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import nodemailer from 'nodemailer';
import postgres from 'postgres';
import * as schema from '@sbc/database/schema';
import { bookingReminderDeliveries, bookings, locations, outboxMessages, platformSettings, tenantNotifications, tenantPolicies, tenantTelegramIntegrations } from '@sbc/database/schema';

config({ path: resolve(__dirname, '../../../.env') });

const EVENT_TYPE = 'guest_access.delivery.requested';
const APPROVAL_EVENT_TYPE = 'tenant_application.approved_email.requested';
const OWNER_INVITATION_EVENT_TYPE = 'tenant_owner_invitation.requested';
const TELEGRAM_EVENT_TYPE = 'tenant.telegram.notification.requested';
const HANDLED_EVENT_TYPES = [EVENT_TYPE, APPROVAL_EVENT_TYPE, OWNER_INVITATION_EVENT_TYPE, TELEGRAM_EVENT_TYPE];
const MAX_ATTEMPTS = readInteger('WORKER_MAX_ATTEMPTS', 8, 1, 20);
const POLL_MS = readInteger('WORKER_POLL_MS', 2_000, 250, 60_000);
const REMINDER_POLL_MS = readInteger('WORKER_REMINDER_POLL_MS', 10_000, 1_000, 60_000);
const LEASE_MS = readInteger('WORKER_LEASE_MS', 90_000, 15_000, 600_000);
const MESSAGE_TIMEOUT_MS = 30_000;
const workerId = randomUUID();

type DeliverySettings = {
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    password?: string;
    fromEmail: string;
    fromName?: string;
  };
  publicAppUrl?: string;
  guestTokenKeys: Record<string, string>;
  activeGuestTokenKeyId?: string;
};

type DeliveryEnvelope = {
  bookingId: string;
  encryption: 'aes-256-gcm-v1';
  keyId?: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

type DeliveryBody = { recipient: string; relativeUrl: string };
type ApprovalEmailBody = { recipient: string; recipientName: string; tenantName: string; tenantSlug: string };
type OwnerInvitationEnvelope = { encryption: 'aes-256-gcm-v1'; iv: string; tag: string; ciphertext: string };
type OwnerInvitationBody = { recipient: string; recipientName: string; tenantName: string; tenantSlug: string; token: string };
type TelegramNotificationPayload = { notificationId: string; telegramDetails?: unknown };
type TelegramBotSecret = { botToken: string };

const TELEGRAM_NOTICE_KIND: Record<string, { icon: string; heading: string; action: string }> = {
  booking_confirmation_reminder: { icon: '⚠️', heading: 'CẦN XÁC NHẬN LỊCH HẸN', action: 'Mở lịch hẹn' },
  booking_reminder: { icon: '⏰', heading: 'LỊCH HẸN SẮP ĐẾN', action: 'Mở lịch hẹn' },
  booking_created: { icon: '📅', heading: 'LỊCH HẸN MỚI', action: 'Mở lịch hẹn' },
  booking_cancelled: { icon: '↩️', heading: 'LỊCH HẸN ĐÃ HỦY', action: 'Xem lịch hẹn' },
  booking_rescheduled: { icon: '🕒', heading: 'LỊCH HẸN ĐỔI THỜI GIAN', action: 'Xem lịch hẹn' },
  booking_expired: { icon: '⌛', heading: 'LỊCH CHỜ DUYỆT ĐÃ HẾT HẠN', action: 'Mở lịch hẹn' },
  payment_review: { icon: '💳', heading: 'THANH TOÁN CẦN ĐỐI SOÁT', action: 'Mở quản lý thanh toán' },
  payment_paid: { icon: '✅', heading: 'THANH TOÁN THÀNH CÔNG', action: 'Mở quản lý thanh toán' },
  payment_failed: { icon: '⚠️', heading: 'THANH TOÁN CHƯA THÀNH CÔNG', action: 'Mở quản lý thanh toán' },
};

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
if (!databaseUrl) throw new Error('DATABASE_URL is required by the worker');
const masterKeyHex = process.env.APP_CONFIG_MASTER_KEY?.trim() ?? '';
if (!/^[0-9a-f]{64}$/i.test(masterKeyHex)) throw new Error('APP_CONFIG_MASTER_KEY must be a 32-byte hex key');

const client = postgres(databaseUrl, { max: 2, idle_timeout: 20, connect_timeout: 10 });
const db = drizzle({ client, schema });
const counters = { claimed: 0, sent: 0, retried: 0, deferred: 0, deadLettered: 0 };

function readInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function decryptJson<T>(ciphertext: string, iv: string, authTag: string, key: Buffer): T {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
}

async function deliverySettings(): Promise<DeliverySettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  if (!row) throw new Error('DELIVERY_CONFIGURATION_MISSING');
  let settings: DeliverySettings;
  try {
    settings = decryptJson<DeliverySettings>(
      row.ciphertext,
      row.iv,
      row.authTag,
      Buffer.from(masterKeyHex, 'hex'),
    );
  } catch {
    throw new Error('DELIVERY_CONFIGURATION_MISSING');
  }
  return settings;
}

function validateSmtp(settings: DeliverySettings) {
  if (!settings.smtp?.host || !settings.smtp.fromEmail) throw new Error('DELIVERY_CONFIGURATION_MISSING');
  return settings.smtp;
}

function decodeEnvelope(value: unknown): DeliveryEnvelope {
  if (!value || typeof value !== 'object') throw new Error('DELIVERY_PAYLOAD_INVALID');
  const envelope = value as Partial<DeliveryEnvelope>;
  if (envelope.encryption !== 'aes-256-gcm-v1' || !envelope.bookingId || (envelope.keyId !== undefined && typeof envelope.keyId !== 'string') || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  return envelope as DeliveryEnvelope;
}

function decodeDelivery(envelope: DeliveryEnvelope, settings: DeliverySettings): DeliveryBody {
  if (!settings.guestTokenKeys || !settings.publicAppUrl) throw new Error('DELIVERY_CONFIGURATION_MISSING');
  const guestTokenKeys = settings.guestTokenKeys;
  let keyId = envelope.keyId;
  if (!keyId) {
    const legacyKeyId = process.env.GUEST_TOKEN_ENCRYPTION_KEY_ID?.trim() || 'v1';
    keyId = guestTokenKeys[legacyKeyId] ? legacyKeyId : settings.activeGuestTokenKeyId;
  }
  const keyHex = keyId ? guestTokenKeys[keyId] : undefined;
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('DELIVERY_KEY_UNAVAILABLE');
  let body: DeliveryBody;
  try {
    body = decryptJson<DeliveryBody>(
      envelope.ciphertext,
      envelope.iv,
      envelope.tag,
      Buffer.from(keyHex, 'hex'),
    );
  } catch {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  if (!body || typeof body.recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recipient)) {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  if (typeof body.relativeUrl !== 'string' || !body.relativeUrl.startsWith('/public/')) {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  const base = new URL(settings.publicAppUrl!);
  const link = new URL(body.relativeUrl, base);
  if (link.origin !== base.origin || !link.hash.startsWith('#token=')) throw new Error('DELIVERY_PAYLOAD_INVALID');
  return { recipient: body.recipient, relativeUrl: link.toString() };
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

async function sendDelivery(body: DeliveryBody, settings: DeliverySettings, messageId: string): Promise<void> {
  const smtp = validateSmtp(settings);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? '' } : undefined,
    connectionTimeout: MESSAGE_TIMEOUT_MS,
    greetingTimeout: MESSAGE_TIMEOUT_MS,
    socketTimeout: MESSAGE_TIMEOUT_MS,
    tls: { minVersion: 'TLSv1.2' },
  });
  try {
    const safeLink = htmlEscape(body.relativeUrl);
    await transport.sendMail({
      messageId: `<${messageId}@service-business-cloud>`,
      from: { address: smtp.fromEmail, ...(smtp.fromName ? { name: smtp.fromName } : {}) },
      to: body.recipient,
      subject: 'Manage your booking',
      text: `Use this secure link to manage your booking: ${body.relativeUrl}\nThis link expires soon and can only be used once.`,
      html: `<p>Use this secure link to manage your booking:</p><p><a href="${safeLink}">Manage booking</a></p><p>This link expires soon and can only be used once.</p>`,
    });
  } finally {
    transport.close();
  }
}

function decodeApprovalEmail(value: unknown): ApprovalEmailBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DELIVERY_PAYLOAD_INVALID');
  const body = value as Partial<ApprovalEmailBody>;
  if (typeof body.recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recipient)
    || typeof body.recipientName !== 'string' || typeof body.tenantName !== 'string'
    || typeof body.tenantSlug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.tenantSlug)) {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  return body as ApprovalEmailBody;
}

async function sendApprovalEmail(body: ApprovalEmailBody, settings: DeliverySettings, messageId: string): Promise<void> {
  const smtp = validateSmtp(settings);
  if (!settings.publicAppUrl) throw new Error('DELIVERY_CONFIGURATION_MISSING');
  const loginUrl = new URL('/login', settings.publicAppUrl).toString();
  const safeName = htmlEscape(body.recipientName);
  const safeTenant = htmlEscape(body.tenantName);
  const safeSlug = htmlEscape(body.tenantSlug);
  const safeUrl = htmlEscape(loginUrl);
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? '' } : undefined,
    connectionTimeout: MESSAGE_TIMEOUT_MS, greetingTimeout: MESSAGE_TIMEOUT_MS,
    socketTimeout: MESSAGE_TIMEOUT_MS, tls: { minVersion: 'TLSv1.2' },
  });
  try {
    await transport.sendMail({
      messageId: `<${messageId}@service-business-cloud>`,
      from: { address: smtp.fromEmail, ...(smtp.fromName ? { name: smtp.fromName } : {}) },
      to: body.recipient,
      subject: 'ZenBook đã duyệt hồ sơ đăng ký tenant',
      text: `Xin chào ${body.recipientName}, hồ sơ ${body.tenantName} (/${body.tenantSlug}) đã được duyệt. Bạn có thể đăng nhập để mở workspace: ${loginUrl}`,
      html: `<p>Xin chào ${safeName},</p><p>Hồ sơ <strong>${safeTenant}</strong> (/${safeSlug}) đã được duyệt.</p><p><a href="${safeUrl}">Đăng nhập để mở workspace</a></p>`,
    });
  } finally { transport.close(); }
}

function decodeOwnerInvitation(value: unknown): OwnerInvitationBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DELIVERY_PAYLOAD_INVALID');
  const envelope = value as Partial<OwnerInvitationEnvelope>;
  if (envelope.encryption !== 'aes-256-gcm-v1' || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  let body: OwnerInvitationBody;
  try {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(masterKeyHex, 'hex'), Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    body = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8')) as OwnerInvitationBody;
  } catch {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  if (!body || typeof body.recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recipient)
    || typeof body.recipientName !== 'string' || typeof body.tenantName !== 'string'
    || typeof body.tenantSlug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.tenantSlug)
    || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
    throw new Error('DELIVERY_PAYLOAD_INVALID');
  }
  return body;
}

async function sendOwnerInvitation(body: OwnerInvitationBody, settings: DeliverySettings, messageId: string): Promise<void> {
  const smtp = validateSmtp(settings);
  if (!settings.publicAppUrl) throw new Error('DELIVERY_CONFIGURATION_MISSING');
  const url = new URL('/accept-invitation', settings.publicAppUrl);
  url.hash = `token=${body.token}`;
  const safeName = htmlEscape(body.recipientName);
  const safeTenant = htmlEscape(body.tenantName);
  const safeUrl = htmlEscape(url.toString());
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? '' } : undefined,
    connectionTimeout: MESSAGE_TIMEOUT_MS, greetingTimeout: MESSAGE_TIMEOUT_MS,
    socketTimeout: MESSAGE_TIMEOUT_MS, tls: { minVersion: 'TLSv1.2' },
  });
  try {
    await transport.sendMail({
      messageId: `<${messageId}@service-business-cloud>`,
      from: { address: smtp.fromEmail, ...(smtp.fromName ? { name: smtp.fromName } : {}) },
      to: body.recipient,
      subject: 'ZenBook đã duyệt hồ sơ đăng ký tiệm',
      text: `Xin chào ${body.recipientName}, hồ sơ ${body.tenantName} đã được duyệt. Mở liên kết có thời hạn để tự đặt mật khẩu: ${url.toString()} . Liên kết chỉ dùng một lần và hết hạn sau 48 giờ.`,
      html: `<p>Xin chào ${safeName},</p><p>Hồ sơ <strong>${safeTenant}</strong> đã được duyệt.</p><p><a href="${safeUrl}">Tạo mật khẩu và mở workspace</a></p><p>Liên kết chỉ dùng một lần và hết hạn sau 48 giờ.</p>`,
    });
  } finally { transport.close(); }
}

function decodeTelegramPayload(value: unknown): TelegramNotificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TELEGRAM_PAYLOAD_INVALID');
  const payload = value as Partial<TelegramNotificationPayload>;
  if (typeof payload.notificationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.notificationId)) throw new Error('TELEGRAM_PAYLOAD_INVALID');
  return payload as TelegramNotificationPayload;
}

function safeTelegramLine(value: unknown, limit = 180): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function formatTelegramDate(value: unknown, timezone: unknown, clockOnly = false): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const timeZone = typeof timezone === 'string' ? timezone : 'Asia/Ho_Chi_Minh';
  try {
    return new Intl.DateTimeFormat('vi-VN', clockOnly
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }
      : { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
  }
}

function formatTelegramPeriodEnd(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

function formatTelegramNotice(notification: { type: string; title: string; description: string }, payload: TelegramNotificationPayload, actionUrl: string): string {
  const kind = TELEGRAM_NOTICE_KIND[notification.type] ?? { icon: '🔔', heading: 'THÔNG BÁO MỚI', action: 'Mở workspace' };
  const details = payload.telegramDetails && typeof payload.telegramDetails === 'object' && !Array.isArray(payload.telegramDetails)
    ? payload.telegramDetails as Record<string, unknown> : {};
  const lines = [`${kind.icon} ${kind.heading}`, safeTelegramLine(notification.title, 120)];
  const startsAt = formatTelegramDate(details.startsAt, details.timezone);
  const previousStartsAt = formatTelegramDate(details.previousStartsAt, details.timezone);
  if (notification.type.startsWith('booking_')) {
    if (notification.type === 'booking_created') lines.push(`Trạng thái: ${details.status === 'PENDING' ? 'Chờ tiệm xác nhận' : 'Đã xác nhận'}`);
    if (notification.type === 'booking_confirmation_reminder') {
      lines.push(`Thời gian: ${startsAt || 'Sắp đến giờ hẹn'}`);
      if (typeof details.reminderMinutes === 'number') lines.push(`Nhắc trước: ${details.reminderMinutes} phút`);
      lines.push('Cần làm: Mở lịch và xác nhận hoặc liên hệ khách ngay.');
    } else if (notification.type === 'booking_reminder') {
      lines.push(`Thời gian: ${startsAt || 'Sắp đến giờ hẹn'}`);
      if (typeof details.reminderMinutes === 'number') lines.push(`Nhắc trước: ${details.reminderMinutes} phút`);
      lines.push('Cần làm: Chuẩn bị đón khách hoặc liên hệ khách trước giờ hẹn.');
    }
    if (notification.type === 'booking_rescheduled' && previousStartsAt) lines.push(`Thời gian cũ: ${previousStartsAt}`);
    if (startsAt) lines.push(`Thời gian${notification.type === 'booking_rescheduled' ? ' mới' : ''}: ${startsAt}`);
    const services = Array.isArray(details.services) ? details.services.slice(0, 3) : [];
    const serviceLabels = services.map((item) => {
      if (!item || typeof item !== 'object') return '';
      const service = item as Record<string, unknown>;
      const name = safeTelegramLine(service.name, 70);
      const time = formatTelegramDate(service.startsAt, details.timezone, true);
      return name ? `• ${name}${time ? ` · ${time}` : ''}` : '';
    }).filter(Boolean);
    if (serviceLabels.length) lines.push('Dịch vụ:', ...serviceLabels);
    if (notification.type === 'booking_cancelled') lines.push('Tình trạng: Khung giờ đã được giải phóng.');
    if (notification.type === 'booking_expired') lines.push('Tình trạng: Lịch đã hết thời gian chờ; khung giờ được mở lại.');
    if (notification.type === 'booking_rescheduled') lines.push('Tình trạng: Lịch đã được cập nhật theo thời gian mới.');
    if (notification.type === 'booking_created' && details.status === 'PENDING') lines.push('Cần làm: Mở lịch để xác nhận hoặc xử lý yêu cầu.');
  } else if (notification.type.startsWith('payment_')) {
    const planName = safeTelegramLine(details.planName, 80);
    const provider = details.provider === 'vnpay' ? 'VNPAY' : details.provider === 'momo' ? 'MoMo' : '';
    if (planName) lines.push(`Gói: ${planName}`);
    if (provider) lines.push(`Cổng thanh toán: ${provider}`);
    if (notification.type === 'payment_paid') {
      lines.push('Kết quả: Gói đã được cập nhật.');
      const periodEnd = formatTelegramPeriodEnd(details.periodEndsAt);
      if (periodEnd) lines.push(`Kỳ sử dụng đến: ${periodEnd}`);
    } else if (notification.type === 'payment_review') {
      lines.push('Kết quả: Đã ghi nhận giao dịch nhưng gói chưa được cập nhật.');
      lines.push('Cần làm: Kiểm tra mục thanh toán cần đối soát trong workspace.');
    } else {
      lines.push('Kết quả: Gói chưa được cập nhật.');
      lines.push('Cần làm: Kiểm tra đơn và tạo giao dịch mới nếu cần.');
    }
  } else {
    const description = safeTelegramLine(notification.description, 400);
    if (description) lines.push(description);
  }
  lines.push(actionUrl ? `🔗 ${kind.action}: ${actionUrl}` : `🔗 ${kind.action}: mở workspace ZenBook.`);
  return lines.join('\n');
}

async function sendTelegramNotification(tenantId: string, value: unknown): Promise<void> {
  const { notificationId } = decodeTelegramPayload(value);
  const [integration] = await db.select().from(tenantTelegramIntegrations)
    .where(eq(tenantTelegramIntegrations.tenantId, tenantId)).limit(1);
  if (!integration?.enabled || integration.status !== 'verified' || !integration.chatId) return;
  const [notification] = await db.select().from(tenantNotifications)
    .where(and(eq(tenantNotifications.tenantId, tenantId), eq(tenantNotifications.id, notificationId))).limit(1);
  if (!notification) throw new Error('TELEGRAM_NOTIFICATION_MISSING');
  let secret: TelegramBotSecret;
  try {
    secret = decryptJson<TelegramBotSecret>(integration.botTokenCiphertext, integration.botTokenIv, integration.botTokenAuthTag, Buffer.from(masterKeyHex, 'hex'));
  } catch {
    await db.update(tenantTelegramIntegrations).set({ lastDeliveryAt: new Date(), lastDeliveryStatus: 'failed', lastDeliveryErrorCode: 'TELEGRAM_SECRET_UNAVAILABLE' }).where(eq(tenantTelegramIntegrations.tenantId, tenantId));
    throw new Error('TELEGRAM_SECRET_UNAVAILABLE');
  }
  if (typeof secret.botToken !== 'string' || !/^\d{5,12}:[A-Za-z0-9_-]{20,180}$/.test(secret.botToken)) throw new Error('TELEGRAM_SECRET_UNAVAILABLE');
  const [settingsRow] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  let publicAppUrl = '';
  if (settingsRow) {
    try { publicAppUrl = decryptJson<DeliverySettings>(settingsRow.ciphertext, settingsRow.iv, settingsRow.authTag, Buffer.from(masterKeyHex, 'hex')).publicAppUrl ?? ''; }
    catch { publicAppUrl = ''; }
  }
  let actionUrl = '';
  try {
    if (publicAppUrl && notification.actionPath?.startsWith('/workspace/')) actionUrl = new URL(notification.actionPath, publicAppUrl).toString();
  } catch { actionUrl = ''; }
  const telegramPayload = decodeTelegramPayload(value);
  const text = formatTelegramNotice(notification, telegramPayload, actionUrl);
  try {
    const response = await fetch(`https://api.telegram.org/bot${secret.botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: integration.chatId, text }), signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
    });
    const result = await response.json().catch(() => undefined) as { ok?: boolean; error_code?: number } | undefined;
    if (!response.ok || !result?.ok) throw new Error(result?.error_code === 403 ? 'TELEGRAM_GROUP_UNREACHABLE' : result?.error_code === 401 ? 'TELEGRAM_TOKEN_INVALID' : 'TELEGRAM_SEND_FAILED');
    await db.update(tenantTelegramIntegrations).set({ lastDeliveryAt: new Date(), lastDeliveryStatus: 'sent', lastDeliveryErrorCode: null })
      .where(eq(tenantTelegramIntegrations.tenantId, tenantId));
  } catch (error) {
    const code = error instanceof Error && /^TELEGRAM_[A-Z_]+$/.test(error.message) ? error.message : 'TELEGRAM_SEND_FAILED';
    await db.update(tenantTelegramIntegrations).set({ lastDeliveryAt: new Date(), lastDeliveryStatus: 'failed', lastDeliveryErrorCode: code })
      .where(eq(tenantTelegramIntegrations.tenantId, tenantId));
    throw new Error(code);
  }
}

async function claimOne() {
  return db.transaction(async (tx) => {
    const [clock] = await tx.execute(sql`select now() as now`);
    const now = new Date(String(clock.now));
    const expiredLease = or(isNull(outboxMessages.leaseUntil), lte(outboxMessages.leaseUntil, now));

    // A process can crash on its final attempt. Once that lease expires, make the exhaustion visible.
    const exhausted = await tx.update(outboxMessages).set({
      deadLetteredAt: now,
      failureReason: 'RETRY_LIMIT_EXCEEDED',
      leaseOwner: null,
      leaseUntil: null,
    }).where(and(
      inArray(outboxMessages.eventType, HANDLED_EVENT_TYPES),
      isNull(outboxMessages.processedAt),
      isNull(outboxMessages.deadLetteredAt),
      lte(outboxMessages.attempts, MAX_ATTEMPTS),
      eq(outboxMessages.attempts, MAX_ATTEMPTS),
      expiredLease,
    )).returning({ id: outboxMessages.id });
    counters.deadLettered += exhausted.length;

    const [row] = await tx.select().from(outboxMessages).where(and(
      inArray(outboxMessages.eventType, HANDLED_EVENT_TYPES),
      isNull(outboxMessages.processedAt),
      isNull(outboxMessages.deadLetteredAt),
      lte(outboxMessages.nextAttemptAt, now),
      expiredLease,
      sql`${outboxMessages.attempts} < ${MAX_ATTEMPTS}`,
    )).orderBy(asc(outboxMessages.occurredAt)).for('update', { skipLocked: true }).limit(1);
    if (!row) return undefined;
    const [claimed] = await tx.update(outboxMessages).set({
      attempts: sql`${outboxMessages.attempts} + 1`,
      leaseOwner: workerId,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    }).where(eq(outboxMessages.id, row.id)).returning();
    return claimed;
  });
}

function failureCode(error: unknown): string {
  if (error instanceof Error && /^TELEGRAM_[A-Z_]+$/.test(error.message)) return error.message;
  if (error instanceof Error && ['DELIVERY_CONFIGURATION_MISSING', 'DELIVERY_KEY_UNAVAILABLE', 'DELIVERY_PAYLOAD_INVALID'].includes(error.message)) {
    return error.message;
  }
  return 'SMTP_DELIVERY_FAILED';
}

async function markFailed(messageId: string, attempts: number, error: unknown): Promise<'retry' | 'dead'> {
  const now = new Date();
  const code = failureCode(error);
  if (attempts >= MAX_ATTEMPTS) {
    await db.update(outboxMessages).set({
      failureReason: code,
      deadLetteredAt: now,
      leaseOwner: null,
      leaseUntil: null,
    }).where(and(eq(outboxMessages.id, messageId), eq(outboxMessages.leaseOwner, workerId), isNull(outboxMessages.processedAt)));
    return 'dead';
  }
  const baseMs = Math.min(30_000 * (2 ** Math.max(0, attempts - 1)), 6 * 60 * 60_000);
  const jitter = Math.floor(baseMs * (0.75 + Math.random() * 0.5));
  await db.update(outboxMessages).set({
    failureReason: code,
    nextAttemptAt: new Date(now.getTime() + jitter),
    leaseOwner: null,
    leaseUntil: null,
  }).where(and(eq(outboxMessages.id, messageId), eq(outboxMessages.leaseOwner, workerId), isNull(outboxMessages.processedAt)));
  return 'retry';
}

async function deferUntilConfigured(messageId: string, reason: string): Promise<void> {
  await db.update(outboxMessages).set({
    attempts: sql`GREATEST(${outboxMessages.attempts} - 1, 0)`,
    failureReason: reason,
    nextAttemptAt: new Date(Date.now() + 5 * 60_000),
    leaseOwner: null,
    leaseUntil: null,
  }).where(and(eq(outboxMessages.id, messageId), eq(outboxMessages.leaseOwner, workerId), isNull(outboxMessages.processedAt)));
}

async function processOne(): Promise<boolean> {
  const row = await claimOne();
  if (!row) return false;
  counters.claimed += 1;
  try {
    if (row.eventType === EVENT_TYPE) {
      const settings = await deliverySettings();
      const envelope = decodeEnvelope(row.payload);
      const body = decodeDelivery(envelope, settings);
      await sendDelivery(body, settings, row.id);
    } else if (row.eventType === APPROVAL_EVENT_TYPE) {
      const settings = await deliverySettings();
      const body = decodeApprovalEmail(row.payload);
      await sendApprovalEmail(body, settings, row.id);
    } else if (row.eventType === OWNER_INVITATION_EVENT_TYPE) {
      const settings = await deliverySettings();
      const body = decodeOwnerInvitation(row.payload);
      await sendOwnerInvitation(body, settings, row.id);
    } else if (row.eventType === TELEGRAM_EVENT_TYPE) {
      if (!row.tenantId) throw new Error('TELEGRAM_PAYLOAD_INVALID');
      await sendTelegramNotification(row.tenantId, row.payload);
    } else throw new Error('DELIVERY_PAYLOAD_INVALID');
    await db.update(outboxMessages).set({
      ...(row.eventType === OWNER_INVITATION_EVENT_TYPE ? { payload: { delivered: true } } : {}),
      processedAt: new Date(),
      failureReason: null,
      leaseOwner: null,
      leaseUntil: null,
    }).where(and(eq(outboxMessages.id, row.id), eq(outboxMessages.leaseOwner, workerId), isNull(outboxMessages.processedAt)));
    counters.sent += 1;
    console.info(JSON.stringify({ event: 'guest_delivery.sent', messageId: row.id }));
  } catch (error) {
    const reason = failureCode(error);
    if (reason === 'DELIVERY_CONFIGURATION_MISSING' || reason === 'DELIVERY_KEY_UNAVAILABLE') {
      await deferUntilConfigured(row.id, reason);
      counters.deferred += 1;
      console.warn(JSON.stringify({ event: 'guest_delivery.deferred', messageId: row.id, reason }));
      return true;
    }
    const result = await markFailed(row.id, row.attempts, error);
    counters[result === 'retry' ? 'retried' : 'deadLettered'] += 1;
    console.warn(JSON.stringify({ event: result === 'retry' ? 'guest_delivery.retry' : 'guest_delivery.dead_lettered', messageId: row.id, reason: failureCode(error), attempt: row.attempts }));
  }
  return true;
}

function datePartsInTimezone(value: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).map((part) => [part.type, part.value]));
}

async function processDueBookingReminders(): Promise<number> {
  return db.transaction(async (tx) => {
    const dueReminderType = sql<string>`case
      when ${bookings.status} = 'PENDING' then case
        when ${bookings.startsAt} <= now() + interval '5 minutes' then 'confirmation_5'
        when ${bookings.startsAt} <= now() + interval '10 minutes' then 'confirmation_10'
        else 'confirmation_20'
      end
      else 'upcoming'
    end`;
    const due = await tx.select({
      tenantId: bookings.tenantId,
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      startsAt: bookings.startsAt,
      reminderType: dueReminderType,
      timezone: locations.timezone,
      reminderMinutes: tenantPolicies.appointmentReminderMinutes,
      serviceSnapshot: bookings.serviceSnapshot,
    }).from(bookings)
      .innerJoin(tenantPolicies, eq(tenantPolicies.tenantId, bookings.tenantId))
      .innerJoin(locations, and(eq(locations.tenantId, bookings.tenantId), eq(locations.id, bookings.locationId)))
      .leftJoin(bookingReminderDeliveries, and(
        eq(bookingReminderDeliveries.tenantId, bookings.tenantId),
        eq(bookingReminderDeliveries.bookingId, bookings.id),
        eq(bookingReminderDeliveries.scheduledStartsAt, bookings.startsAt),
        eq(bookingReminderDeliveries.reminderType, dueReminderType),
      ))
      .where(and(
        or(
          eq(bookings.status, 'CONFIRMED'),
          and(eq(bookings.status, 'PENDING'), gt(bookings.pendingExpiresAt, sql`now()`)),
        ),
        isNotNull(tenantPolicies.appointmentReminderMinutes),
        gt(bookings.startsAt, sql`now()`),
        or(
          and(eq(bookings.status, 'PENDING'), lte(bookings.startsAt, sql`now() + interval '20 minutes'`)),
          and(eq(bookings.status, 'CONFIRMED'), lte(bookings.startsAt, sql`now() + (${tenantPolicies.appointmentReminderMinutes} * interval '1 minute')`)),
        ),
        isNull(bookingReminderDeliveries.bookingId),
      ))
      .orderBy(asc(bookings.startsAt))
      .limit(25)
      .for('update', { of: bookings, skipLocked: true });

    let delivered = 0;
    for (const booking of due) {
      const reminderMinutes = booking.reminderMinutes;
      if (reminderMinutes === null) continue;
      const notificationId = randomUUID();
      const confirmationPending = booking.bookingStatus === 'PENDING';
      const reminderType = booking.reminderType;
      const leadMinutes = reminderType === 'upcoming' ? reminderMinutes : Number(reminderType.slice('confirmation_'.length));
      const timezone = booking.timezone || 'Asia/Ho_Chi_Minh';
      const serviceSnapshot = booking.serviceSnapshot as { name?: unknown; services?: Array<{ name?: unknown }> };
      const services = Array.isArray(serviceSnapshot.services)
        ? serviceSnapshot.services.slice(0, 3).map((service) => typeof service.name === 'string' ? service.name : '').filter(Boolean)
        : typeof serviceSnapshot.name === 'string' ? [serviceSnapshot.name] : [];
      const serviceSummary = services.join(', ').slice(0, 145);
      const startsAtLabel = new Intl.DateTimeFormat('vi-VN', {
        timeZone: timezone, weekday: 'long', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(booking.startsAt);
      const dateParts = datePartsInTimezone(booking.startsAt, timezone);
      const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
      const actionPath = `/workspace/calendar?view=day&date=${date}&bookingId=${encodeURIComponent(booking.bookingId)}`;
      await tx.insert(tenantNotifications).values({
        id: notificationId,
        tenantId: booking.tenantId,
        type: confirmationPending ? 'booking_confirmation_reminder' : 'booking_reminder',
        title: confirmationPending ? 'Cần xác nhận lịch hẹn' : (serviceSummary ? `Sắp đến lịch: ${serviceSummary}` : 'Lịch hẹn sắp đến'),
        description: confirmationPending
          ? `Lịch ${startsAtLabel}${serviceSummary ? ` · ${serviceSummary}` : ''} vẫn đang chờ tiệm xác nhận; còn khoảng ${leadMinutes} phút. Hãy xác nhận hoặc liên hệ khách ngay.`
          : `Bắt đầu ${startsAtLabel}${serviceSummary ? ` · ${serviceSummary}` : ''}. Hãy chuẩn bị đón khách hoặc liên hệ khách.`,
        actionPath,
      });
      // The delivery marker references tenant_notifications, so insert the
      // notification first. Both records are committed atomically below.
      const [claim] = await tx.insert(bookingReminderDeliveries).values({
        tenantId: booking.tenantId,
        bookingId: booking.bookingId,
        scheduledStartsAt: booking.startsAt,
        reminderType,
        notificationId,
        leadMinutes,
      }).onConflictDoNothing().returning({ bookingId: bookingReminderDeliveries.bookingId });
      if (!claim) {
        await tx.delete(tenantNotifications).where(and(
          eq(tenantNotifications.tenantId, booking.tenantId),
          eq(tenantNotifications.id, notificationId),
        ));
        continue;
      }
      const [integration] = await tx.select({ enabled: tenantTelegramIntegrations.enabled, status: tenantTelegramIntegrations.status })
        .from(tenantTelegramIntegrations).where(eq(tenantTelegramIntegrations.tenantId, booking.tenantId)).limit(1);
      if (integration?.enabled && integration.status === 'verified') {
        await tx.insert(outboxMessages).values({
          tenantId: booking.tenantId,
          eventType: TELEGRAM_EVENT_TYPE,
          payload: {
            notificationId,
            telegramDetails: {
              kind: 'booking',
              reminderKind: reminderType,
              startsAt: booking.startsAt.toISOString(),
              timezone,
              reminderMinutes,
              services: services.map((name) => ({ name })),
            },
          },
        });
      }
      await tx.execute(sql`select pg_notify('tenant_notifications', ${booking.tenantId})`);
      delivered += 1;
    }
    return delivered;
  });
}

let stopping = false;
let activeWork: Promise<boolean> | undefined;
let lastMetricsAt = Date.now();
let lastReminderScanAt = 0;
let lastReminderScanErrorAt = 0;

function requestStop(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ event: 'worker.shutdown_requested', signal }));
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

async function run(): Promise<void> {
  await client`SELECT 1`;
  console.info(JSON.stringify({ event: 'worker.ready', workerId, pollMs: POLL_MS, leaseMs: LEASE_MS, maxAttempts: MAX_ATTEMPTS }));
  try {
    while (!stopping) {
      activeWork = processOne();
      const worked = await activeWork;
      activeWork = undefined;
      if (Date.now() - lastReminderScanAt >= REMINDER_POLL_MS) {
        lastReminderScanAt = Date.now();
        try {
          const remindersSent = await processDueBookingReminders();
          if (remindersSent > 0) console.info(JSON.stringify({ event: 'booking_reminders.created', count: remindersSent }));
        } catch (error) {
          if (Date.now() - lastReminderScanErrorAt >= 60_000) {
            lastReminderScanErrorAt = Date.now();
            console.warn(JSON.stringify({ event: 'booking_reminders.scan_failed', reason: error instanceof Error ? error.name : 'UnknownError' }));
          }
        }
      }
      if (!worked) await delay(POLL_MS);
      if (Date.now() - lastMetricsAt >= 60_000) {
        console.info(JSON.stringify({ event: 'worker.metrics', ...counters }));
        counters.claimed = 0; counters.sent = 0; counters.retried = 0; counters.deferred = 0; counters.deadLettered = 0;
        lastMetricsAt = Date.now();
      }
    }
  } finally {
    if (activeWork) await activeWork;
    console.info(JSON.stringify({ event: 'worker.stopped', ...counters }));
    await client.end({ timeout: 5 });
  }
}

void run().catch(async (error: unknown) => {
  console.error(JSON.stringify({ event: 'worker.fatal', reason: error instanceof Error ? error.name : 'UnknownError' }));
  await client.end({ timeout: 5 });
  process.exitCode = 1;
});
