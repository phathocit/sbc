import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type {
  ConfirmTelegramGroupRequest, SaveTenantTelegramIntegrationRequest,
  TelegramGroupDiscoveryDto, TelegramIntegrationTestDto, TelegramPairingCodeDto, TenantTelegramIntegrationDto,
} from '@sbc/contracts';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { tenantTelegramIntegrations } from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { decryptSystemSettings, encryptSystemSettings } from '../platform-settings/system-settings.crypto';

const TELEGRAM_API = 'https://api.telegram.org';
const TOKEN_PATTERN = /^\d{5,12}:[A-Za-z0-9_-]{20,180}$/;
const LINK_TTL_MS = 10 * 60_000;
const POLL_LEASE_MS = 15_000;

type TelegramToken = { botToken: string };
type TelegramApiResult<T> = { ok: boolean; result?: T; error_code?: number };
type TelegramChat = { id: number; type: string; title?: string; username?: string };
type TelegramUpdate = { message?: { text?: string; chat?: TelegramChat } };
type StoredCandidate = { chatId: string; title: string | null; type: 'group' | 'supergroup' };

@Injectable()
export class TenantIntegrationsService {
  private async row(tenantId: string) {
    const [row] = await db.select().from(tenantTelegramIntegrations)
      .where(eq(tenantTelegramIntegrations.tenantId, tenantId)).limit(1);
    return row;
  }

  private decryptToken(row: { botTokenCiphertext: string; botTokenIv: string; botTokenAuthTag: string }): string {
    const value = decryptSystemSettings<TelegramToken>({ ciphertext: row.botTokenCiphertext, iv: row.botTokenIv, authTag: row.botTokenAuthTag });
    if (!value || typeof value.botToken !== 'string' || !TOKEN_PATTERN.test(value.botToken)) {
      throw new ServiceUnavailableException({ errorCode: 'TELEGRAM_SECRET_UNAVAILABLE', message: 'Cấu hình Telegram chưa thể giải mã.' });
    }
    return value.botToken;
  }

  private async call<T>(token: string, method: string, body?: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('TELEGRAM_API_UNAVAILABLE');
    }
    let result: TelegramApiResult<T>;
    try { result = await response.json() as TelegramApiResult<T>; }
    catch { throw new Error('TELEGRAM_API_INVALID_RESPONSE'); }
    if (!response.ok || !result.ok || result.result === undefined) {
      if (response.status === 409 || result.error_code === 409) throw new Error('TELEGRAM_WEBHOOK_ACTIVE');
      if (result.error_code === 401) throw new Error('TELEGRAM_TOKEN_INVALID');
      throw new Error('TELEGRAM_API_REJECTED');
    }
    return result.result;
  }

  private status(row: Awaited<ReturnType<TenantIntegrationsService['row']>>): TenantTelegramIntegrationDto {
    if (!row) return {
      configured: false, enabled: false, status: 'not_configured', botUsername: null, group: null,
      lastCheckedAt: null, lastVerifiedAt: null, lastErrorCode: null, lastDeliveryAt: null,
      lastDeliveryStatus: null, lastDeliveryErrorCode: null, pairingExpiresAt: null,
    };
    return {
      configured: true, enabled: row.enabled, status: row.status as TenantTelegramIntegrationDto['status'],
      botUsername: row.botUsername, group: row.chatId && row.chatType
        ? { chatId: row.chatId, title: row.chatTitle, type: row.chatType as 'group' | 'supergroup' } : null,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null, lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode, lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
      lastDeliveryStatus: row.lastDeliveryStatus as 'sent' | 'failed' | null,
      lastDeliveryErrorCode: row.lastDeliveryErrorCode, pairingExpiresAt: row.pairingExpiresAt?.toISOString() ?? null,
    };
  }

  async get(tenantId: string): Promise<TenantTelegramIntegrationDto> {
    return this.status(await this.row(tenantId));
  }

  async save(tenantId: string, userId: string, input: SaveTenantTelegramIntegrationRequest): Promise<TenantTelegramIntegrationDto> {
    if (!input || typeof input !== 'object' || (input.enabled !== undefined && typeof input.enabled !== 'boolean')) {
      throw new BadRequestException('Thông tin cấu hình Telegram không hợp lệ.');
    }
    const existing = await this.row(tenantId);
    const token = typeof input.botToken === 'string' ? input.botToken.trim() : '';
    if (!existing && !token) throw new BadRequestException('Hãy nhập token bot Telegram để lưu cấu hình.');
    if (token && !TOKEN_PATTERN.test(token)) throw new BadRequestException('Token bot Telegram không đúng định dạng.');
    if (input.enabled === true && (token || existing?.status !== 'verified')) {
      throw new ConflictException({ errorCode: 'TELEGRAM_TEST_REQUIRED', message: 'Hãy kiểm tra tích hợp thành công trước khi bật gửi thông báo.' });
    }
    const encrypted = token ? encryptSystemSettings({ botToken: token }) : undefined;
    const changedToken = Boolean(encrypted);
    const values = {
      ...(encrypted ? { botTokenCiphertext: encrypted.ciphertext, botTokenIv: encrypted.iv, botTokenAuthTag: encrypted.authTag } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(changedToken ? {
        botUsername: null, chatId: null, chatTitle: null, chatType: null, enabled: false, status: 'saved',
        lastCheckedAt: null, lastVerifiedAt: null, lastErrorCode: null,
        lastDeliveryAt: null, lastDeliveryStatus: null, lastDeliveryErrorCode: null,
        pairingCodeHash: null, pairingExpiresAt: null, candidateChats: [],
      } : {}),
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(tenantTelegramIntegrations).set(values).where(eq(tenantTelegramIntegrations.tenantId, tenantId));
    } else {
      await db.insert(tenantTelegramIntegrations).values({
        tenantId, botTokenCiphertext: encrypted!.ciphertext, botTokenIv: encrypted!.iv, botTokenAuthTag: encrypted!.authTag,
        enabled: input.enabled ?? false, status: 'saved', updatedAt: new Date(),
      });
    }
    void userId;
    return this.get(tenantId);
  }

  async createPairingCode(tenantId: string): Promise<TelegramPairingCodeDto> {
    const row = await this.row(tenantId);
    if (!row) throw new NotFoundException('Hãy lưu token bot Telegram trước khi liên kết nhóm.');
    let botUsername = row.botUsername;
    if (!botUsername) {
      try {
        const bot = await this.call<{ username?: string }>(this.decryptToken(row), 'getMe');
        if (!bot.username || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username)) throw new Error('TELEGRAM_BOT_INVALID');
        botUsername = bot.username;
        await db.update(tenantTelegramIntegrations).set({ botUsername, updatedAt: new Date() })
          .where(eq(tenantTelegramIntegrations.tenantId, tenantId));
      } catch {
        throw new ServiceUnavailableException({ errorCode: 'TELEGRAM_BOT_UNAVAILABLE', message: 'Could not read the bot username. Check the saved token and try again.' });
      }
    }
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await db.update(tenantTelegramIntegrations).set({
      pairingCodeHash: createHash('sha256').update(code).digest('hex'), pairingExpiresAt: expiresAt,
      candidateChats: [], lastDiscoveryAt: null, pollingUntil: null, updatedAt: new Date(),
    }).where(eq(tenantTelegramIntegrations.tenantId, tenantId));
    return { code, commandText: `/connect@${botUsername} ${code}`, expiresAt: expiresAt.toISOString() };
  }

  private async webhookState(token: string): Promise<void> {
    const result = await this.call<{ url?: string }>(token, 'getWebhookInfo');
    if (result.url) throw new Error('TELEGRAM_WEBHOOK_ACTIVE');
  }

  async discoverGroup(tenantId: string): Promise<TelegramGroupDiscoveryDto> {
    const row = await this.row(tenantId);
    if (!row) throw new NotFoundException('Cấu hình Telegram chưa được lưu.');
    if (!row.pairingCodeHash || !row.pairingExpiresAt || row.pairingExpiresAt <= new Date()) {
      throw new ConflictException({ errorCode: 'TELEGRAM_PAIRING_EXPIRED', message: 'Mã liên kết đã hết hạn. Hãy tạo mã mới.' });
    }
    const token = this.decryptToken(row);
    await this.webhookState(token).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'TELEGRAM_WEBHOOK_ACTIVE') {
        throw new ConflictException({ errorCode: 'TELEGRAM_WEBHOOK_ACTIVE', message: 'Bot đang bật webhook. Hãy tắt webhook trong cấu hình bot rồi thử lại; hệ thống không tự thay đổi webhook.' });
      }
      throw new ServiceUnavailableException({ errorCode: 'TELEGRAM_API_UNAVAILABLE', message: 'Không thể kết nối Telegram lúc này.' });
    });
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + POLL_LEASE_MS);
    const [leased] = await db.update(tenantTelegramIntegrations).set({ pollingUntil: leaseUntil, lastDiscoveryAt: now })
      .where(and(eq(tenantTelegramIntegrations.tenantId, tenantId), eq(tenantTelegramIntegrations.pairingCodeHash, row.pairingCodeHash),
        or(isNull(tenantTelegramIntegrations.pollingUntil), lte(tenantTelegramIntegrations.pollingUntil, now))))
      .returning();
    if (!leased) throw new ConflictException({ errorCode: 'TELEGRAM_POLL_IN_PROGRESS', message: 'Đang dò nhóm Telegram. Vui lòng đợi một chút rồi thử lại.' });
    try {
      const updates = await this.call<TelegramUpdate[]>(token, 'getUpdates', { timeout: 8, allowed_updates: ['message'] }, 11_000);
      const candidates = new Map<string, StoredCandidate>();
      for (const update of updates) {
        const message = update.message;
        const chat = message?.chat;
        if (!message?.text || !chat || (chat.type !== 'group' && chat.type !== 'supergroup')) continue;
        const match = message.text.trim().match(/^\/connect(?:@[A-Za-z0-9_]+)?\s+([A-Fa-f0-9]{12})\s*$/);
        if (!match || createHash('sha256').update(match[1].toUpperCase()).digest('hex') !== leased.pairingCodeHash) continue;
        const chatId = String(chat.id);
        candidates.set(chatId, { chatId, title: typeof chat.title === 'string' ? chat.title.slice(0, 255) : null, type: chat.type });
      }
      const found = [...candidates.values()];
      await db.update(tenantTelegramIntegrations).set({ candidateChats: found, pollingUntil: null, updatedAt: new Date() })
        .where(and(eq(tenantTelegramIntegrations.tenantId, tenantId), eq(tenantTelegramIntegrations.pairingCodeHash, leased.pairingCodeHash)));
      return { candidates: found, pairingExpiresAt: leased.pairingExpiresAt!.toISOString() };
    } catch (error) {
      await db.update(tenantTelegramIntegrations).set({ pollingUntil: null }).where(and(
        eq(tenantTelegramIntegrations.tenantId, tenantId),
        eq(tenantTelegramIntegrations.pairingCodeHash, leased.pairingCodeHash),
      ));
      if (error instanceof Error && error.message === 'TELEGRAM_WEBHOOK_ACTIVE') {
        throw new ConflictException({ errorCode: 'TELEGRAM_WEBHOOK_ACTIVE', message: 'Bot đang bật webhook. Hãy tắt webhook trong cấu hình bot rồi thử lại.' });
      }
      if (error instanceof Error && error.message === 'TELEGRAM_API_REJECTED') {
        throw new ServiceUnavailableException({ errorCode: 'TELEGRAM_POLL_FAILED', message: 'Telegram chưa trả về nhóm có mã liên kết này. Hãy kiểm tra lệnh /connect trong nhóm.' });
      }
      throw new ServiceUnavailableException({ errorCode: 'TELEGRAM_POLL_FAILED', message: 'Không thể dò nhóm Telegram lúc này.' });
    }
  }

  async confirmGroup(tenantId: string, input: ConfirmTelegramGroupRequest): Promise<TenantTelegramIntegrationDto> {
    if (!input || typeof input.chatId !== 'string' || !/^-?\d{5,20}$/.test(input.chatId)) throw new BadRequestException('Nhóm Telegram được chọn không hợp lệ.');
    const row = await this.row(tenantId);
    if (!row?.pairingCodeHash || !row.pairingExpiresAt || row.pairingExpiresAt <= new Date()) throw new ConflictException({ errorCode: 'TELEGRAM_PAIRING_EXPIRED', message: 'Mã liên kết đã hết hạn. Hãy tạo mã mới.' });
    const candidate = row.candidateChats.find((item) => item.chatId === input.chatId);
    if (!candidate) throw new ConflictException({ errorCode: 'TELEGRAM_GROUP_NOT_DISCOVERED', message: 'Nhóm này chưa được xác nhận bằng mã liên kết. Hãy dò nhóm lại.' });
    const [updated] = await db.update(tenantTelegramIntegrations).set({
      chatId: candidate.chatId, chatTitle: candidate.title, chatType: candidate.type,
      status: 'saved', enabled: false, lastCheckedAt: null, lastVerifiedAt: null, lastErrorCode: null,
      lastDeliveryAt: null, lastDeliveryStatus: null, lastDeliveryErrorCode: null,
      pairingCodeHash: null, pairingExpiresAt: null, candidateChats: [], pollingUntil: null, updatedAt: new Date(),
    }).where(and(
      eq(tenantTelegramIntegrations.tenantId, tenantId),
      eq(tenantTelegramIntegrations.pairingCodeHash, row.pairingCodeHash),
      gt(tenantTelegramIntegrations.pairingExpiresAt, new Date()),
    )).returning({ tenantId: tenantTelegramIntegrations.tenantId });
    if (!updated) throw new ConflictException({ errorCode: 'TELEGRAM_PAIRING_EXPIRED', message: 'The pairing code changed or expired. Create a new one.' });
    return this.get(tenantId);
  }

  async test(tenantId: string): Promise<TelegramIntegrationTestDto> {
    const row = await this.row(tenantId);
    if (!row) throw new NotFoundException('Cấu hình Telegram chưa được lưu.');
    if (!row.chatId || !row.chatType) throw new ConflictException({ errorCode: 'TELEGRAM_GROUP_REQUIRED', message: 'Hãy liên kết nhóm Telegram trước khi kiểm tra.' });
    const checkedAt = new Date();
    try {
      const token = this.decryptToken(row);
      const bot = await this.call<{ username?: string }>(token, 'getMe');
      if (!bot.username) throw new Error('TELEGRAM_BOT_INVALID');
      await this.call(token, 'sendMessage', { chat_id: row.chatId, text: 'ZenBook: Kết nối Telegram thành công. Bạn sẽ nhận thông báo workspace tại nhóm này.' });
      await db.update(tenantTelegramIntegrations).set({
        botUsername: bot.username, status: 'verified', lastCheckedAt: checkedAt, lastVerifiedAt: checkedAt,
        lastErrorCode: null, updatedAt: checkedAt,
      }).where(eq(tenantTelegramIntegrations.tenantId, tenantId));
      return { verified: true, botUsername: bot.username, groupTitle: row.chatTitle, checkedAt: checkedAt.toISOString() };
    } catch (error) {
      const code = error instanceof Error && ['TELEGRAM_WEBHOOK_ACTIVE', 'TELEGRAM_TOKEN_INVALID'].includes(error.message)
        ? error.message : 'TELEGRAM_GROUP_UNREACHABLE';
      await db.update(tenantTelegramIntegrations).set({ status: 'failed', lastCheckedAt: checkedAt, lastErrorCode: code, updatedAt: checkedAt })
        .where(eq(tenantTelegramIntegrations.tenantId, tenantId));
      const message = code === 'TELEGRAM_TOKEN_INVALID' ? 'Token bot không hợp lệ.'
        : code === 'TELEGRAM_WEBHOOK_ACTIVE' ? 'Bot đang bật webhook nên chưa thể kiểm tra bằng long polling.'
          : 'Không gửi được tin nhắn kiểm tra. Hãy xác nhận bot vẫn ở trong nhóm và được phép gửi tin nhắn.';
      throw new ConflictException({ errorCode: code, message });
    }
  }
}
