import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { PlatformTelegramChatDiscoveryDto, PlatformTelegramIntegrationDto, PlatformTelegramPairingCodeDto, SavePlatformTelegramIntegrationRequest, TestPlatformTelegramIntegrationRequest } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { and, eq, gt, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { platformTelegramIntegrations, platformAdminAuditEvents } from '../../../../../packages/database/dist/schema/index.js';
import { PasswordService } from '../../common/crypto/password.service';
import { db } from '../../database';
import { decryptSystemSettings, encryptSystemSettings, systemSettingsMasterKey } from '../platform-settings/system-settings.crypto';

type BotSecret = { botToken: string };
type BotUser = { id: number; username?: string; is_bot: boolean };
type BotChat = { id: number; type: string; first_name?: string; last_name?: string; username?: string };
type TelegramUpdate = { update_id: number; message?: { date?: number; text?: string; chat?: BotChat; from?: { id?: number; is_bot?: boolean } } };

async function telegramCall<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new BadGatewayException({ errorCode: 'TELEGRAM_UNREACHABLE', message: 'Không kết nối được Telegram. Hãy thử lại.' });
  }
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: T } | null;
  if (!response.ok || !body?.ok || body.result === undefined) {
    throw new BadGatewayException({ errorCode: response.status === 409 ? 'TELEGRAM_WEBHOOK_ACTIVE' : 'TELEGRAM_REQUEST_FAILED',
      message: response.status === 409 ? 'Bot đang dùng webhook. Hãy ngắt webhook trước khi dùng long polling.' : 'Telegram từ chối yêu cầu. Kiểm tra token, chat và quyền nhắn tin của bot.' });
  }
  return body.result;
}

@Injectable()
export class PlatformTelegramService {
  constructor(@Inject(PasswordService) private readonly passwords: PasswordService) {}

  private async reauthenticate(user: User, value: unknown): Promise<void> {
    if (typeof value !== 'string' || !user.passwordHash || user.accountStatus !== 'active'
      || !await this.passwords.verifyPassword(value, user.passwordHash)) {
      throw new ForbiddenException('Cần nhập đúng mật khẩu admin để thay đổi hoặc kiểm tra Telegram.');
    }
  }

  private safe(row: typeof platformTelegramIntegrations.$inferSelect | undefined): PlatformTelegramIntegrationDto {
    return {
      configured: Boolean(row), enabled: Boolean(row?.enabled),
      status: row ? row.status as PlatformTelegramIntegrationDto['status'] : 'not_configured',
      botUsername: row?.botUsername ?? null, chatId: row?.chatId ?? null, chatName: row?.chatName ?? null,
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null, lastVerifiedAt: row?.lastVerifiedAt?.toISOString() ?? null,
      lastErrorCode: row?.lastErrorCode ?? null, lastDeliveryAt: row?.lastDeliveryAt?.toISOString() ?? null,
      lastDeliveryStatus: row?.lastDeliveryStatus === 'sent' || row?.lastDeliveryStatus === 'failed' ? row.lastDeliveryStatus : null,
      lastDeliveryErrorCode: row?.lastDeliveryErrorCode ?? null, lastInboundAt: row?.lastInboundAt?.toISOString() ?? null,
    };
  }

  async status(): Promise<PlatformTelegramIntegrationDto> {
    const [row] = await db.select().from(platformTelegramIntegrations).where(eq(platformTelegramIntegrations.id, 1)).limit(1);
    return this.safe(row);
  }

  async save(user: User, input: SavePlatformTelegramIntegrationRequest): Promise<PlatformTelegramIntegrationDto> {
    await this.reauthenticate(user, input?.currentPassword);
    const token = input.botToken?.trim();
    if (input.botToken !== undefined && (typeof input.botToken !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{30,180}$/.test(token ?? ''))) {
      throw new BadRequestException('Bot token Telegram không hợp lệ.');
    }
    if ('chatId' in (input ?? {})) throw new BadRequestException('Chat admin phải được ghép bằng mã xác minh.');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new BadRequestException('Trạng thái bật Telegram không hợp lệ.');
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('platform-telegram-config-v1', 0))`);
      const [current] = await tx.select().from(platformTelegramIntegrations).where(eq(platformTelegramIntegrations.id, 1)).for('update').limit(1);
      if (!current && !token) throw new BadRequestException('Hãy lưu bot token trước.');
      const changed = Boolean(token);
      if (changed && input.enabled) throw new BadRequestException('Hãy kiểm tra kết nối sau khi đổi bot hoặc chat rồi mới bật.');
      if (input.enabled && (current?.status !== 'verified' || !current.chatId || !current.botId || !current.authorizedAdminId)) throw new ConflictException('Kết nối Telegram chưa được xác minh.');
      const encrypted = token ? encryptSystemSettings({ botToken: token } satisfies BotSecret, systemSettingsMasterKey()) : null;
      const values = {
        ...(encrypted ? { botTokenCiphertext: encrypted.ciphertext, botTokenIv: encrypted.iv, botTokenAuthTag: encrypted.authTag } : {}),
        ...(changed ? { enabled: false, status: 'saved', botId: null, botUsername: null, chatId: null, chatName: null, pairingCodeHash: null, pairingExpiresAt: null,
          authorizedAdminId: null, lastCheckedAt: null, lastVerifiedAt: null, lastErrorCode: null,
          lastDeliveryAt: null, lastDeliveryStatus: null, lastDeliveryErrorCode: null, lastUpdateId: 0, pollLeaseOwner: null, pollLeaseUntil: null } : {}),
        ...(!changed && input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedBy: user.id, updatedAt: new Date(),
      };
      if (current) await tx.update(platformTelegramIntegrations).set(values).where(eq(platformTelegramIntegrations.id, 1));
      else await tx.insert(platformTelegramIntegrations).values({ id: 1, botTokenCiphertext: encrypted!.ciphertext, botTokenIv: encrypted!.iv,
        botTokenAuthTag: encrypted!.authTag, updatedBy: user.id });
      await tx.insert(platformAdminAuditEvents).values({ actorUserId: user.id, entityType: 'telegram', entityId: 'platform',
        action: 'telegram.configuration_updated', before: { configured: Boolean(current), enabled: current?.enabled ?? false },
        after: { tokenChanged: changed, enabled: changed ? false : input.enabled ?? current?.enabled ?? false } });
    });
    return this.status();
  }

  async createPairingCode(user: User, currentPassword: string): Promise<PlatformTelegramPairingCodeDto> {
    await this.reauthenticate(user, currentPassword);
    const [row] = await db.select().from(platformTelegramIntegrations).where(eq(platformTelegramIntegrations.id, 1)).limit(1);
    if (!row) throw new BadRequestException('Hãy lưu bot token trước.');
    if (row.enabled) throw new ConflictException('Tắt kết nối trước khi ghép chat mới.');
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const [updated] = await db.update(platformTelegramIntegrations).set({ pairingCodeHash: createHash('sha256').update(code).digest('hex'), pairingExpiresAt: expiresAt,
      updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(platformTelegramIntegrations.id, 1), eq(platformTelegramIntegrations.botTokenCiphertext, row.botTokenCiphertext))).returning({ id: platformTelegramIntegrations.id });
    if (!updated) throw new ConflictException('Bot token đã thay đổi. Hãy tải lại rồi tạo mã ghép.');
    return { commandText: `/connect ${code}`, expiresAt: expiresAt.toISOString() };
  }

  async discover(user: User, currentPassword: string): Promise<PlatformTelegramChatDiscoveryDto> {
    await this.reauthenticate(user, currentPassword);
    const [row] = await db.select().from(platformTelegramIntegrations).where(eq(platformTelegramIntegrations.id, 1)).limit(1);
    if (!row) throw new BadRequestException('Hãy lưu bot token trước.');
    if (row.enabled) throw new ConflictException('Tắt kết nối trước khi tìm lại chat.');
    if (!row.pairingCodeHash || !row.pairingExpiresAt || row.pairingExpiresAt <= new Date()) throw new ConflictException('Mã ghép chat đã hết hạn. Hãy tạo mã mới.');
    const { botToken } = decryptSystemSettings<BotSecret>({ ciphertext: row.botTokenCiphertext, iv: row.botTokenIv, authTag: row.botTokenAuthTag });
    const updates = await telegramCall<TelegramUpdate[]>(botToken, 'getUpdates', { timeout: 0, limit: 100, allowed_updates: ['message'] });
    const cutoff = Math.floor(row.pairingExpiresAt.getTime() / 1000) - 10 * 60;
    const chats = new Map<string, string>();
    for (const item of updates) {
      const message = item.message;
      if (!message?.chat || message.chat.type !== 'private' || message.from?.is_bot || String(message.from?.id) !== String(message.chat.id)
        || (message.date ?? 0) < cutoff || (message.date ?? 0) * 1000 > row.pairingExpiresAt.getTime()) continue;
      const code = message.text?.trim().match(/^\/connect(?:@\w+)?\s+([A-Fa-f0-9]{12})$/)?.[1]?.toUpperCase();
      if (!code || createHash('sha256').update(code).digest('hex') !== row.pairingCodeHash) continue;
      const name = [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ') || message.chat.username || String(message.chat.id);
      chats.set(String(message.chat.id), name.slice(0, 100));
    }
    if (chats.size > 1) throw new ConflictException('Mã ghép đã xuất hiện ở nhiều chat. Hãy tạo mã mới và chỉ gửi trong chat admin.');
    if (chats.size === 1) {
      const [chatId, chatName] = [...chats][0];
      const [updated] = await db.update(platformTelegramIntegrations).set({ chatId, chatName, pairingCodeHash: null, pairingExpiresAt: null,
        enabled: false, status: 'saved', botId: null, botUsername: null, authorizedAdminId: null, lastCheckedAt: null, lastVerifiedAt: null, lastErrorCode: null,
        lastUpdateId: 0, updatedBy: user.id, updatedAt: new Date() }).where(and(eq(platformTelegramIntegrations.id, 1), eq(platformTelegramIntegrations.botTokenCiphertext, row.botTokenCiphertext),
        eq(platformTelegramIntegrations.pairingCodeHash, row.pairingCodeHash), gt(platformTelegramIntegrations.pairingExpiresAt, new Date()))).returning({ chatId: platformTelegramIntegrations.chatId });
      if (!updated) throw new ConflictException('Cấu hình đã thay đổi. Hãy tải lại rồi ghép chat lần nữa.');
    }
    return { candidates: [...chats].map(([id, name]) => ({ chatId: id, name })) };
  }

  async test(user: User, input: TestPlatformTelegramIntegrationRequest): Promise<PlatformTelegramIntegrationDto> {
    await this.reauthenticate(user, input?.currentPassword);
    const [row] = await db.select().from(platformTelegramIntegrations).where(eq(platformTelegramIntegrations.id, 1)).limit(1);
    if (!row?.chatId) throw new BadRequestException('Hãy lưu bot token và chọn chat riêng trước.');
    const { botToken } = decryptSystemSettings<BotSecret>({ ciphertext: row.botTokenCiphertext, iv: row.botTokenIv, authTag: row.botTokenAuthTag });
    try {
      const bot = await telegramCall<BotUser>(botToken, 'getMe', {});
      if (!bot.is_bot) throw new BadRequestException('Token không thuộc bot Telegram.');
      const webhook = await telegramCall<{ url?: string }>(botToken, 'getWebhookInfo', {});
      if (webhook.url) throw new ConflictException('Bot đang dùng webhook. Hãy ngắt webhook để nhận phản hồi bằng long polling.');
      const chat = await telegramCall<BotChat>(botToken, 'getChat', { chat_id: row.chatId });
      if (chat.type !== 'private' || String(chat.id) !== row.chatId) throw new BadRequestException('Chỉ chấp nhận chat riêng với admin.');
      await telegramCall(botToken, 'sendMessage', { chat_id: row.chatId, text: 'ZenBook Platform Admin: Kết nối Telegram đã được kiểm tra. Cảnh báo vận hành và phản hồi ticket sẽ đến đây.' });
      const [updated] = await db.update(platformTelegramIntegrations).set({ status: 'verified', botId: String(bot.id), botUsername: bot.username ?? null, authorizedAdminId: user.id,
        chatName: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || null,
        lastCheckedAt: new Date(), lastVerifiedAt: new Date(), lastErrorCode: null, updatedBy: user.id, updatedAt: new Date() })
        .where(and(eq(platformTelegramIntegrations.id, 1), eq(platformTelegramIntegrations.botTokenCiphertext, row.botTokenCiphertext), eq(platformTelegramIntegrations.chatId, row.chatId)))
        .returning({ id: platformTelegramIntegrations.id });
      if (!updated) throw new ConflictException('Cấu hình đã thay đổi trong lúc kiểm tra. Hãy thử lại.');
      return this.status();
    } catch (error) {
      const code = error instanceof BadRequestException ? 'TELEGRAM_CHAT_INVALID' : error instanceof ConflictException ? 'TELEGRAM_WEBHOOK_ACTIVE' : 'TELEGRAM_TEST_FAILED';
      await db.update(platformTelegramIntegrations).set({ status: 'failed', enabled: false, lastCheckedAt: new Date(), lastErrorCode: code })
        .where(and(eq(platformTelegramIntegrations.id, 1), eq(platformTelegramIntegrations.botTokenCiphertext, row.botTokenCiphertext), eq(platformTelegramIntegrations.chatId, row.chatId)));
      throw error;
    }
  }
}
