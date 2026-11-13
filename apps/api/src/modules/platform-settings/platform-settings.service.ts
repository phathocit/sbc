import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type {
  PlatformAdminBootstrapResponse,
  PlatformAdminBootstrapStatus,
  PlatformSettingsStatus,
  PlatformSettingsTestResult,
  TestPlatformSettingsRequest,
  UpdatePlatformSettingsRequest,
} from '@sbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@sbc/database';
import { PasswordService } from '../../common/crypto/password.service';
import { platformAdmins, platformSettings } from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { decryptSystemSettings, encryptSystemSettings, systemSettingsMasterKey } from './system-settings.crypto';

type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  fromEmail: string;
  fromName?: string;
};

export type DeliverySettings = {
  smtp?: SmtpSettings;
  publicAppUrl?: string;
  guestTokenKeys: Record<string, string>;
  activeGuestTokenKeyId?: string;
  paymentProviders?: {
    vnpay?: { enabled: boolean; mode: 'sandbox' | 'production'; tmnCode?: string; hashSecret?: string };
    momo?: { enabled: boolean; mode: 'sandbox' | 'production'; partnerCode?: string; accessKey?: string; secretKey?: string };
  };
  checks?: Partial<Record<PlatformSettingsTestResult['section'], PlatformSettingsTestResult>>;
};

const emptySettings = (): DeliverySettings => ({ guestTokenKeys: {} });
const lastSmtpTestByUser = new Map<string, number>();

function isPublicIp(address: string, family: number): boolean {
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b, c] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    const first = Number.parseInt(address.split(':')[0] || '0', 16);
    return (first & 0xe000) === 0x2000 && !address.toLowerCase().startsWith('2001:db8:');
  }
  return false;
}

function testedSection(settings: DeliverySettings, section: PlatformSettingsTestResult['section']): unknown {
  if (section === 'publicUrl') return settings.publicAppUrl ?? null;
  if (section === 'smtp') return settings.smtp ?? null;
  if (section === 'guestToken') return {
    activeKeyId: settings.activeGuestTokenKeyId ?? null,
    key: settings.activeGuestTokenKeyId ? settings.guestTokenKeys[settings.activeGuestTokenKeyId] ?? null : null,
  };
  return settings.paymentProviders?.[section] ?? null;
}

async function assertSafePublicUrl(value: string): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_URL_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PUBLIC_URL_INVALID');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const loopback = hostname === 'localhost' || (literalFamily === 4 && hostname.startsWith('127.')) || hostname === '::1';
  if (loopback) {
    if (process.env.NODE_ENV === 'production') throw new Error('PUBLIC_URL_PRIVATE');
    return url;
  }
  if (hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('PUBLIC_URL_PRIVATE');
  }
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIp(entry.address, entry.family))) throw new Error('PUBLIC_URL_PRIVATE');
  if (process.env.NODE_ENV === 'production' && url.port && url.port !== '443') throw new Error('PUBLIC_URL_PRIVATE');
  return url;
}

@Injectable()
export class PlatformSettingsService {
  constructor(@Inject(PasswordService) private readonly passwords: PasswordService) {}

  private bootstrapTokenMatches(received: unknown): boolean {
    const configured = process.env.PLATFORM_BOOTSTRAP_TOKEN?.trim() ?? '';
    if (!configured || typeof received !== 'string' || received.length > 512) return false;
    const expectedHash = createHash('sha256').update(configured, 'utf8').digest();
    const receivedHash = createHash('sha256').update(received, 'utf8').digest();
    return timingSafeEqual(expectedHash, receivedHash);
  }

  private async firstAdminExists(): Promise<boolean> {
    const [row] = await db.select({ userId: platformAdmins.userId }).from(platformAdmins).limit(1);
    return Boolean(row);
  }

  async bootstrapStatus(): Promise<PlatformAdminBootstrapStatus> {
    const tokenConfigured = Boolean(process.env.PLATFORM_BOOTSTRAP_TOKEN?.trim());
    const adminInitialized = await this.firstAdminExists();
    return {
      available: tokenConfigured && !adminInitialized,
      tokenConfigured,
      adminInitialized,
    };
  }

  async bootstrapAdmin(user: User, token: unknown): Promise<PlatformAdminBootstrapResponse> {
    if (!this.bootstrapTokenMatches(token)) throw new ForbiddenException('Platform bootstrap credential is invalid');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('platform-admin-bootstrap-v1', 0))`);
      const [existing] = await tx.select({ userId: platformAdmins.userId }).from(platformAdmins).limit(1).for('update');
      if (existing) throw new ConflictException('Platform administrator is already initialized');
      await tx.insert(platformAdmins).values({ userId: user.id });
    });
    return { isPlatformAdmin: true };
  }

  private async encryptedRow() {
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
    return row;
  }

  private async loadSettings(): Promise<DeliverySettings> {
    const row = await this.encryptedRow();
    let settings = row
      ? decryptSystemSettings<DeliverySettings>({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag })
      : emptySettings();
    if (!settings || typeof settings !== 'object' || !settings.guestTokenKeys || typeof settings.guestTokenKeys !== 'object') {
      throw new ServiceUnavailableException({ errorCode: 'SYSTEM_SETTINGS_UNAVAILABLE', message: 'System settings are invalid' });
    }
    settings = { ...settings, guestTokenKeys: { ...settings.guestTokenKeys } };
    const legacyKey = process.env.GUEST_TOKEN_ENCRYPTION_KEY?.trim() ?? '';
    if (/^[0-9a-f]{64}$/i.test(legacyKey)) {
      const legacyKeyId = process.env.GUEST_TOKEN_ENCRYPTION_KEY_ID?.trim() || 'v1';
      const existing = settings.guestTokenKeys[legacyKeyId];
      if (existing && existing.toLowerCase() !== legacyKey.toLowerCase()) {
        throw new ServiceUnavailableException({ errorCode: 'GUEST_KEY_ID_CONFLICT', message: 'A configured guest key ID conflicts with the legacy environment key' });
      }
      settings.guestTokenKeys[legacyKeyId] = legacyKey;
      settings.activeGuestTokenKeyId ??= legacyKeyId;
    }
    return settings;
  }

  async getDeliverySettings(): Promise<DeliverySettings> {
    return this.loadSettings();
  }

  async testConfiguration(user: User, input: TestPlatformSettingsRequest): Promise<PlatformSettingsTestResult> {
    if (!input || !['publicUrl', 'smtp', 'guestToken', 'vnpay', 'momo'].includes(input.section)) {
      throw new BadRequestException('A valid configuration section is required');
    }
    if (typeof input.currentPassword !== 'string' || !user.passwordHash || user.accountStatus !== 'active' || !await this.passwords.verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new ForbiddenException('Current password is required to test platform settings');
    }

    const settings = await this.loadSettings();
    const snapshot = JSON.stringify(testedSection(settings, input.section));
    const checkedAt = new Date().toISOString();
    const result = (status: PlatformSettingsTestResult['status'], message: string): Promise<PlatformSettingsTestResult> =>
      this.persistTestResult(user, input.section, snapshot, { section: input.section, status, checkedAt, message });

    if (input.section === 'smtp') {
      const lastTest = lastSmtpTestByUser.get(user.id) ?? 0;
      if (Date.now() - lastTest < 30_000) throw new BadRequestException('Wait 30 seconds before sending another SMTP test email');
      lastSmtpTestByUser.set(user.id, Date.now());
      const smtp = settings.smtp;
      const recipient = typeof input.recipient === 'string' ? input.recipient.trim().toLowerCase() : '';
      if (!smtp?.host || !smtp.fromEmail) return result('failed', 'SMTP chưa được cấu hình đầy đủ.');
      if (recipient.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        throw new BadRequestException('Enter a valid email address to receive the test message');
      }
      const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? '' } : undefined,
        connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 12_000,
        tls: { minVersion: 'TLSv1.2' },
      });
      try {
        await transport.verify();
        const message = {
          messageId: `<smtp-test-${randomBytes(12).toString('hex')}@service-business-cloud>`,
          from: smtp.fromName ? { address: smtp.fromEmail, name: smtp.fromName } : smtp.fromEmail,
          to: recipient,
          subject: 'ZenBook · Kiểm tra cấu hình email',
          text: 'Email thử từ ZenBook Platform. Máy chủ SMTP đã chấp nhận yêu cầu gửi. Hãy kiểm tra cả hộp thư rác nếu chưa thấy thư.',
        };
        const sent = await new Promise<{ accepted: Array<string | { address: string }> }>((resolve, reject) => {
          transport.sendMail(message, (error, info) => {
            if (error) reject(error);
            else resolve(info as { accepted: Array<string | { address: string }> });
          });
        });
        if (!sent.accepted.some((address) => (typeof address === 'string' ? address : address.address).toLowerCase() === recipient)) {
          return result('failed', 'Máy chủ SMTP không chấp nhận địa chỉ nhận thử.');
        }
        return result('passed', 'Máy chủ SMTP đã chấp nhận email thử. Hãy kiểm tra hộp thư đến và thư rác; kết quả này chưa xác nhận email đã được phát vào hộp thư.');
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code.toUpperCase() : '';
        const message = code === 'EAUTH' ? 'SMTP từ chối xác thực. Kiểm tra tên đăng nhập và mật khẩu ứng dụng.'
          : code === 'ETIMEDOUT' || code === 'ESOCKET' ? 'Không kết nối được SMTP trong thời gian cho phép. Kiểm tra host, cổng và TLS.'
            : code === 'ECONNECTION' || code === 'EDNS' ? 'Không tìm thấy hoặc không kết nối được máy chủ SMTP. Kiểm tra host và mạng.'
              : 'SMTP chưa gửi được email thử. Kiểm tra cấu hình và trạng thái tài khoản gửi.';
        return result('failed', message);
      } finally { transport.close(); }
    }

    if (input.section === 'publicUrl') {
      if (!settings.publicAppUrl) return result('failed', 'Chưa lưu địa chỉ ứng dụng công khai.');
      try {
        const target = await assertSafePublicUrl(settings.publicAppUrl);
        const response = await fetch(target, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(7_000) });
        if (response.status === 405) {
          const fallback = await fetch(target, { method: 'GET', redirect: 'manual', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(7_000) });
          void fallback.body?.cancel();
          if (fallback.status >= 200 && fallback.status < 400) return result('passed', `Địa chỉ công khai phản hồi HTTP ${fallback.status}.`);
          return result('failed', `Địa chỉ công khai phản hồi HTTP ${fallback.status}.`);
        }
        if (response.status >= 200 && response.status < 400) return result('passed', `Địa chỉ công khai phản hồi HTTP ${response.status}.`);
        return result('failed', `Địa chỉ công khai phản hồi HTTP ${response.status}.`);
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        return result('failed', code === 'PUBLIC_URL_PRIVATE'
          ? 'Không kiểm tra URL trỏ tới mạng nội bộ trong môi trường production.'
          : 'Không truy cập được địa chỉ công khai. Kiểm tra URL, DNS và máy chủ web.');
      }
    }

    if (input.section === 'guestToken') {
      const keyId = settings.activeGuestTokenKeyId;
      const keyHex = keyId ? settings.guestTokenKeys[keyId] : undefined;
      if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) return result('failed', 'Chưa có khóa guest hợp lệ đang hoạt động.');
      const key = Buffer.from(keyHex, 'hex');
      const challenge = randomBytes(32);
      const signature = createHmac('sha256', key).update(challenge).digest();
      const verified = timingSafeEqual(signature, createHmac('sha256', key).update(challenge).digest());
      return verified ? result('passed', `Khóa guest ${keyId} ký và xác minh thử thành công.`)
        : result('failed', 'Khóa guest không vượt qua kiểm tra ký/xác minh.');
    }

    const provider = input.section === 'vnpay' ? settings.paymentProviders?.vnpay : settings.paymentProviders?.momo;
    const credentialsReady = input.section === 'vnpay'
      ? Boolean(provider && 'tmnCode' in provider && provider.tmnCode && provider.hashSecret)
      : Boolean(provider && 'partnerCode' in provider && provider.partnerCode && provider.accessKey && provider.secretKey);
    if (!credentialsReady) return result('failed', 'Chưa lưu đủ thông tin merchant cho cổng thanh toán này.');
    const apiOrigin = process.env.PAYMENTS_API_PUBLIC_URL?.trim();
    if (!apiOrigin) return result('failed', 'Thiếu PAYMENTS_API_PUBLIC_URL nên chưa kiểm tra được IPN công khai.');
    try {
      const base = new URL(apiOrigin);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return result('failed', 'PAYMENTS_API_PUBLIC_URL không hợp lệ.');
      const target = new URL(`/v1/billing/webhooks/${input.section === 'vnpay' ? 'vnpay' : 'momo'}`, base);
      const response = input.section === 'vnpay'
        ? await fetch(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(7_000) })
        : await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(7_000) });
      const reachable = input.section === 'vnpay'
        ? response.ok && (await response.json() as { RspCode?: string }).RspCode === '97'
        : response.status === 400;
      if (!reachable) return result('failed', `Không xác nhận được route IPN công khai (HTTP ${response.status}).`);
      return result('partial', `Route IPN công khai phản hồi đúng. Bài kiểm tra này chỉ xác nhận khả năng truy cập route, không xác minh giao dịch merchant. Giao dịch thành công sẽ được xác nhận riêng khi IPN hoặc đối soát được xử lý.`);
    } catch {
      return result('failed', 'Không kết nối được route IPN công khai. Kiểm tra PAYMENTS_API_PUBLIC_URL, tunnel và API.');
    }
  }

  async activeGuestTokenKey(): Promise<{ keyId: string; key: string }> {
    const settings = await this.loadSettings();
    const keyId = settings.activeGuestTokenKeyId;
    const key = keyId ? settings.guestTokenKeys[keyId] : undefined;
    if (!keyId || !key || !/^[0-9a-f]{64}$/i.test(key)) {
      throw new ServiceUnavailableException({ errorCode: 'GUEST_ACCESS_UNAVAILABLE', message: 'Guest booking is temporarily unavailable' });
    }
    return { keyId, key };
  }

  private safeStatus(settings: DeliverySettings): PlatformSettingsStatus {
    const smtp = settings.smtp;
    const encryptionReady = /^[0-9a-f]{64}$/i.test(process.env.APP_CONFIG_MASTER_KEY?.trim() ?? '');
    const activeGuestKeyId = settings.activeGuestTokenKeyId;
    const guestTokenKeys = settings.guestTokenKeys ?? {};
    const checks = settings.checks ? { ...settings.checks } : undefined;
    const oldVnpayRouteCheck = checks?.vnpay;
    if (oldVnpayRouteCheck?.status === 'partial' && /Merchant chưa được xác nhận|cần hoàn tất giao dịch sandbox/i.test(oldVnpayRouteCheck.message)) {
      checks!.vnpay = {
        ...oldVnpayRouteCheck,
        message: 'Route IPN công khai đã phản hồi. Kết quả này chỉ ghi nhận bài kiểm tra route, không đọc lịch sử giao dịch đã xử lý.',
      };
    }
    return {
      encryptionReady,
      ...(checks ? { checks } : {}),
      ...(settings.publicAppUrl ? { publicAppUrl: settings.publicAppUrl } : {}),
      smtp: {
        configured: Boolean(smtp?.host && smtp.fromEmail),
        ...(smtp ? {
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          ...(smtp.username ? { username: smtp.username } : {}),
          fromEmail: smtp.fromEmail,
          ...(smtp.fromName ? { fromName: smtp.fromName } : {}),
        } : {}),
        passwordConfigured: Boolean(smtp?.password),
      },
      guestToken: {
        configured: Boolean(activeGuestKeyId && guestTokenKeys[activeGuestKeyId]),
        ...(activeGuestKeyId ? { activeKeyId: activeGuestKeyId } : {}),
        keyIds: Object.keys(guestTokenKeys).sort(),
      },
      paymentProviders: {
        vnpay: { enabled: Boolean(settings.paymentProviders?.vnpay?.enabled), configured: Boolean(settings.paymentProviders?.vnpay?.tmnCode && settings.paymentProviders?.vnpay?.hashSecret), mode: settings.paymentProviders?.vnpay?.mode ?? 'sandbox' },
        momo: { enabled: Boolean(settings.paymentProviders?.momo?.enabled), configured: Boolean(settings.paymentProviders?.momo?.partnerCode && settings.paymentProviders?.momo?.accessKey && settings.paymentProviders?.momo?.secretKey), mode: settings.paymentProviders?.momo?.mode ?? 'sandbox' },
      },
      ...(process.env.PAYMENTS_API_PUBLIC_URL ? { paymentCallbackUrls: {
        vnpay: `${process.env.PAYMENTS_API_PUBLIC_URL}/v1/billing/webhooks/vnpay`,
        momo: `${process.env.PAYMENTS_API_PUBLIC_URL}/v1/billing/webhooks/momo`,
      } } : {}),
    };
  }

  private async persistTestResult(
    user: User | undefined,
    section: PlatformSettingsTestResult['section'],
    snapshot: string,
    test: PlatformSettingsTestResult,
  ): Promise<PlatformSettingsTestResult> {
    let changedDuringTest = false;
    let preservedCheck: PlatformSettingsTestResult | undefined;
    const masterKey = systemSettingsMasterKey();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('platform-settings-write-v1', 0))`);
      const [row] = await tx.select().from(platformSettings).where(eq(platformSettings.id, 1)).for('update').limit(1);
      const settings = row
        ? decryptSystemSettings<DeliverySettings>({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }, masterKey)
        : emptySettings();
      if (JSON.stringify(testedSection(settings, section)) !== snapshot) {
        changedDuringTest = true;
        return;
      }
      const previousCheck = settings.checks?.[section];
      if (section === 'vnpay' && previousCheck?.status === 'passed' && test.status === 'partial') {
        preservedCheck = previousCheck;
        return;
      }
      settings.checks = { ...(settings.checks ?? {}), [section]: test };
      const encrypted = encryptSystemSettings(settings, masterKey);
      if (row) {
        await tx.update(platformSettings).set({
          ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag,
        }).where(eq(platformSettings.id, 1));
      } else if (user) {
        await tx.insert(platformSettings).values({
          id: 1, ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag,
          updatedBy: user.id, updatedAt: new Date(),
        });
      } else {
        changedDuringTest = true;
      }
    });
    if (changedDuringTest) return {
      ...test, status: 'failed',
      message: 'Cấu hình đã thay đổi trong khi kiểm tra. Hãy chạy kiểm tra lại trên giá trị mới nhất.',
    };
    return preservedCheck ?? test;
  }

  async recordVerifiedVnpayPayment(
    config: NonNullable<NonNullable<DeliverySettings['paymentProviders']>['vnpay']>,
    source: 'IPN' | 'QueryDR',
  ): Promise<void> {
    const checkedAt = new Date().toISOString();
    const test: PlatformSettingsTestResult = {
      section: 'vnpay', status: 'passed', checkedAt,
      message: `Giao dịch VNPAY ${config.mode === 'sandbox' ? 'sandbox ' : ''}đã được xác minh qua ${source}.`,
    };
    await this.persistTestResult(undefined, 'vnpay', JSON.stringify(config), test);
  }

  async safeSettings(): Promise<PlatformSettingsStatus> {
    const row = await this.encryptedRow();
    if (row && !/^[0-9a-f]{64}$/i.test(process.env.APP_CONFIG_MASTER_KEY?.trim() ?? '')) {
      return {
        encryptionReady: false,
        smtp: { configured: false, passwordConfigured: false },
        guestToken: { configured: false, keyIds: [] },
        paymentProviders: {
          vnpay: { enabled: false, configured: false, mode: 'sandbox' },
          momo: { enabled: false, configured: false, mode: 'sandbox' },
        },
        ...(process.env.PAYMENTS_API_PUBLIC_URL ? { paymentCallbackUrls: {
          vnpay: `${process.env.PAYMENTS_API_PUBLIC_URL}/v1/billing/webhooks/vnpay`,
          momo: `${process.env.PAYMENTS_API_PUBLIC_URL}/v1/billing/webhooks/momo`,
        } } : {}),
      };
    }
    return this.safeStatus(await this.loadSettings());
  }

  async unlockSettings(user: User, currentPassword: unknown): Promise<{ unlocked: true }> {
    if (typeof currentPassword !== 'string' || !user.passwordHash || user.accountStatus !== 'active' || !await this.passwords.verifyPassword(currentPassword, user.passwordHash)) {
      throw new ForbiddenException('Current password is invalid');
    }
    return { unlocked: true };
  }

  private normalizeSmtp(input: UpdatePlatformSettingsRequest['smtp'], existing?: SmtpSettings): SmtpSettings {
    if (!input || typeof input !== 'object') throw new BadRequestException('SMTP settings are required');
    const host = typeof input.host === 'string' ? input.host.trim().toLowerCase() : '';
    const fromEmail = typeof input.fromEmail === 'string' ? input.fromEmail.trim().toLowerCase() : '';
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const fromName = typeof input.fromName === 'string' ? input.fromName.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) throw new BadRequestException('SMTP host is invalid');
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new BadRequestException('SMTP port must be between 1 and 65535');
    if (typeof input.secure !== 'boolean') throw new BadRequestException('SMTP secure must be true or false');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail) || fromEmail.length > 255) throw new BadRequestException('A valid SMTP sender email is required');
    if (username.length > 255 || password.length > 1024 || fromName.length > 255) throw new BadRequestException('SMTP settings exceed the allowed length');
    return {
      host, port: input.port, secure: input.secure,
      ...(username ? { username } : {}),
      ...(password ? { password } : existing?.password ? { password: existing.password } : {}),
      fromEmail,
      ...(fromName ? { fromName } : {}),
    };
  }

  private normalizePublicAppUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 2048) throw new BadRequestException('Public app URL is invalid');
    const raw = value.trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new BadRequestException('Public app URL must be an absolute HTTP or HTTPS URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /[?#]/.test(raw)) {
      throw new BadRequestException('Public app URL must not contain credentials, query parameters or a fragment');
    }
    if (parsed.pathname !== '/') throw new BadRequestException('Public app URL must be an origin without a path');
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Public app URL must use HTTPS in production');
    }
    return parsed.origin;
  }

  async updateSettings(user: User, input: UpdatePlatformSettingsRequest): Promise<PlatformSettingsStatus> {
    if (!input || typeof input !== 'object' || (!input.smtp && !input.guestTokenKey && !input.paymentProviders && input.publicAppUrl === undefined)) {
      throw new BadRequestException('At least one system setting must be supplied');
    }
    if (typeof input.currentPassword !== 'string' || !user.passwordHash || user.accountStatus !== 'active' || !await this.passwords.verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new ForbiddenException('Current password is required to change system secrets');
    }
    const masterKey = systemSettingsMasterKey();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('platform-settings-write-v1', 0))`);
      const [row] = await tx.select().from(platformSettings).where(eq(platformSettings.id, 1)).for('update').limit(1);
      let settings = row
        ? decryptSystemSettings<DeliverySettings>({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }, masterKey)
        : emptySettings();
      settings = { ...settings, guestTokenKeys: { ...(settings.guestTokenKeys ?? {}) } };

      const legacyKey = process.env.GUEST_TOKEN_ENCRYPTION_KEY?.trim() ?? '';
      if (/^[0-9a-f]{64}$/i.test(legacyKey)) {
        const legacyKeyId = process.env.GUEST_TOKEN_ENCRYPTION_KEY_ID?.trim() || 'v1';
        const previous = settings.guestTokenKeys[legacyKeyId];
        if (previous && previous.toLowerCase() !== legacyKey.toLowerCase()) {
          throw new ConflictException('The legacy guest key ID is already used by a different key');
        }
        settings.guestTokenKeys[legacyKeyId] = legacyKey;
        settings.activeGuestTokenKeyId ??= legacyKeyId;
      }

      if (input.smtp) settings.smtp = this.normalizeSmtp(input.smtp, settings.smtp);
      if (input.publicAppUrl !== undefined) settings.publicAppUrl = this.normalizePublicAppUrl(input.publicAppUrl);
      if (input.guestTokenKey) {
        const keyId = typeof input.guestTokenKey.keyId === 'string' ? input.guestTokenKey.keyId.trim() : '';
        const key = typeof input.guestTokenKey.key === 'string' ? input.guestTokenKey.key.trim() : '';
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new BadRequestException('Guest key ID is invalid');
        if (!/^[0-9a-f]{64}$/i.test(key)) throw new BadRequestException('Guest token key must be a 32-byte value encoded as 64 hexadecimal characters');
        const previous = settings.guestTokenKeys[keyId];
        if (previous && previous.toLowerCase() !== key.toLowerCase()) {
          throw new ConflictException('Guest key IDs cannot be reused for different key material');
        }
        settings.guestTokenKeys[keyId] = key.toLowerCase();
        settings.activeGuestTokenKeyId = keyId;
      }

      if (input.paymentProviders) {
        const providers = { ...(settings.paymentProviders ?? {}) };
        const normalizeMode = (value: unknown): 'sandbox' | 'production' => {
          if (value !== 'sandbox' && value !== 'production') throw new BadRequestException('Payment provider mode must be sandbox or production');
          return value;
        };
        const normalizeSecret = (value: unknown, max: number, name: string): string | undefined => {
          if (value === undefined || value === '') return undefined;
          if (typeof value !== 'string' || value.trim().length > max || !value.trim()) throw new BadRequestException(`${name} is invalid`);
          return value.trim();
        };
        if (input.paymentProviders.vnpay) {
          const value = input.paymentProviders.vnpay;
          if (typeof value.enabled !== 'boolean') throw new BadRequestException('VNPAY enabled must be boolean');
          const tmnCode = normalizeSecret(value.tmnCode, 32, 'VNPAY TmnCode') ?? providers.vnpay?.tmnCode;
          const hashSecret = normalizeSecret(value.hashSecret, 256, 'VNPAY HashSecret') ?? providers.vnpay?.hashSecret;
          if (value.enabled && (!tmnCode || !hashSecret)) throw new BadRequestException('VNPAY credentials are required before enabling it');
          providers.vnpay = { enabled: value.enabled, mode: normalizeMode(value.mode), ...(tmnCode ? { tmnCode } : {}), ...(hashSecret ? { hashSecret } : {}) };
        }
        if (input.paymentProviders.momo) {
          const value = input.paymentProviders.momo;
          if (typeof value.enabled !== 'boolean') throw new BadRequestException('MoMo enabled must be boolean');
          const partnerCode = normalizeSecret(value.partnerCode, 64, 'MoMo partnerCode') ?? providers.momo?.partnerCode;
          const accessKey = normalizeSecret(value.accessKey, 128, 'MoMo accessKey') ?? providers.momo?.accessKey;
          const secretKey = normalizeSecret(value.secretKey, 256, 'MoMo secretKey') ?? providers.momo?.secretKey;
          if (value.enabled && (!partnerCode || !accessKey || !secretKey)) throw new BadRequestException('MoMo credentials are required before enabling it');
          providers.momo = { enabled: value.enabled, mode: normalizeMode(value.mode), ...(partnerCode ? { partnerCode } : {}), ...(accessKey ? { accessKey } : {}), ...(secretKey ? { secretKey } : {}) };
        }
        settings.paymentProviders = providers;
      }

      const checks = { ...(settings.checks ?? {}) };
      if (input.publicAppUrl !== undefined) delete checks.publicUrl;
      if (input.smtp) delete checks.smtp;
      if (input.guestTokenKey) delete checks.guestToken;
      if (input.paymentProviders?.vnpay) delete checks.vnpay;
      if (input.paymentProviders?.momo) delete checks.momo;
      settings.checks = checks;

      const encrypted = encryptSystemSettings(settings, masterKey);
      await tx.insert(platformSettings).values({
        id: 1, ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag,
        updatedBy: user.id, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: platformSettings.id,
        set: { ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag, updatedBy: user.id, updatedAt: new Date() },
      });
    });
    return this.safeSettings();
  }

  async assertAdmin(userId: string): Promise<void> {
    const [admin] = await db.select({ userId: platformAdmins.userId })
      .from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1);
    if (!admin) throw new ForbiddenException('Platform administrator access is required');
  }
}
