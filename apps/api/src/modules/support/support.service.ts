import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateSupportTicketRequest, SupportTicketCategory, SupportTicketDto, SupportTicketStatus } from '@sbc/contracts';
import { and, asc, desc, eq, ilike, ne, or } from 'drizzle-orm';
import { billingOrders, supportMessages, supportTickets, tenants, users } from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';

const categories = new Set<SupportTicketCategory>(['billing', 'account', 'booking', 'technical', 'other']);
const statuses = new Set<SupportTicketStatus>(['waiting_admin', 'waiting_tenant', 'resolved', 'closed']);

@Injectable()
export class SupportService {
  async listTenant(tenantId: string): Promise<SupportTicketDto[]> {
    const rows = await db.select().from(supportTickets).where(eq(supportTickets.tenantId, tenantId))
      .orderBy(desc(supportTickets.updatedAt), desc(supportTickets.id)).limit(100);
    return rows.map((ticket) => this.ticketDto(ticket));
  }

  async listPlatform(status?: string, search?: string): Promise<SupportTicketDto[]> {
    if (status && status !== 'all' && !statuses.has(status as SupportTicketStatus)) throw new BadRequestException('Trạng thái ticket không hợp lệ.');
    const normalizedSearch = search?.trim().slice(0, 100);
    const where = and(
      status && status !== 'all' ? eq(supportTickets.status, status) : undefined,
      normalizedSearch ? or(ilike(supportTickets.subject, `%${normalizedSearch}%`), ilike(tenants.displayName, `%${normalizedSearch}%`), ilike(tenants.slug, `%${normalizedSearch}%`)) : undefined,
    );
    const rows = await db.select({ ticket: supportTickets, tenantName: tenants.displayName, tenantSlug: tenants.slug })
      .from(supportTickets).innerJoin(tenants, eq(tenants.id, supportTickets.tenantId))
      .where(where).orderBy(desc(supportTickets.updatedAt), desc(supportTickets.id)).limit(200);
    return rows.map(({ ticket, tenantName, tenantSlug }) => ({ ...this.ticketDto(ticket), tenantName, tenantSlug }));
  }

  async getTenant(tenantId: string, ticketId: string): Promise<SupportTicketDto> {
    const [ticket] = await db.select().from(supportTickets).where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, ticketId))).limit(1);
    if (!ticket) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ.');
    return this.withMessages(ticket);
  }

  async getPlatform(ticketId: string): Promise<SupportTicketDto> {
    const [row] = await db.select({ ticket: supportTickets, tenantName: tenants.displayName, tenantSlug: tenants.slug })
      .from(supportTickets).innerJoin(tenants, eq(tenants.id, supportTickets.tenantId)).where(eq(supportTickets.id, ticketId)).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ.');
    return { ...await this.withMessages(row.ticket), tenantName: row.tenantName, tenantSlug: row.tenantSlug };
  }

  async create(tenantId: string, userId: string, input: CreateSupportTicketRequest): Promise<SupportTicketDto> {
    const subject = typeof input?.subject === 'string' ? input.subject.trim() : '';
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    const category = input?.category;
    if (subject.length < 4 || subject.length > 140) throw new BadRequestException('Tiêu đề cần có từ 4 đến 140 ký tự.');
    if (message.length < 8 || message.length > 5000) throw new BadRequestException('Nội dung cần có từ 8 đến 5000 ký tự.');
    if (!categories.has(category)) throw new BadRequestException('Chủ đề hỗ trợ không hợp lệ.');
    const billingOrderId = input.billingOrderId || null;
    if (billingOrderId) {
      if (typeof billingOrderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(billingOrderId)) {
        throw new BadRequestException('Mã đơn thanh toán không hợp lệ.');
      }
      const [order] = await db.select({ id: billingOrders.id }).from(billingOrders)
        .where(and(eq(billingOrders.id, billingOrderId), eq(billingOrders.tenantId, tenantId))).limit(1);
      if (!order) throw new BadRequestException('Đơn thanh toán không thuộc tenant hiện tại.');
    }
    const [ticket] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(supportTickets).values({ tenantId, createdBy: userId, billingOrderId, subject, category, status: 'waiting_admin' }).returning();
      await tx.insert(supportMessages).values({ tenantId, ticketId: created.id, senderId: userId, senderRole: 'tenant', body: message });
      return [created];
    });
    return this.getTenant(tenantId, ticket.id);
  }

  async replyTenant(tenantId: string, ticketId: string, userId: string, body: string): Promise<SupportTicketDto> {
    return this.reply(tenantId, ticketId, userId, 'tenant', body);
  }

  async replyPlatform(ticketId: string, userId: string, body: string): Promise<SupportTicketDto> {
    const [ticket] = await db.select({ tenantId: supportTickets.tenantId }).from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
    if (!ticket) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ.');
    await this.reply(ticket.tenantId, ticketId, userId, 'platform_admin', body);
    return this.getPlatform(ticketId);
  }

  async setStatus(ticketId: string, status: string): Promise<SupportTicketDto> {
    if (!statuses.has(status as SupportTicketStatus)) throw new BadRequestException('Trạng thái ticket không hợp lệ.');
    if (status === 'waiting_tenant') throw new BadRequestException('Trạng thái chờ tenant được đặt tự động khi ZenBook gửi phản hồi.');
    const [updated] = await db.update(supportTickets).set({ status, updatedAt: new Date() }).where(eq(supportTickets.id, ticketId)).returning({ id: supportTickets.id });
    if (!updated) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ.');
    return this.getPlatform(ticketId);
  }

  private async reply(tenantId: string, ticketId: string, userId: string, senderRole: 'tenant' | 'platform_admin', rawBody: string): Promise<SupportTicketDto> {
    const body = typeof rawBody === 'string' ? rawBody.trim() : '';
    if (body.length < 1 || body.length > 5000) throw new BadRequestException('Phản hồi cần có từ 1 đến 5000 ký tự.');
    const nextStatus: SupportTicketStatus = senderRole === 'tenant' ? 'waiting_admin' : 'waiting_tenant';
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(supportTickets).set({ status: nextStatus, updatedAt: new Date() })
        .where(and(
          eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenantId), ne(supportTickets.status, 'closed'),
          senderRole === 'tenant'
            ? or(eq(supportTickets.status, 'waiting_tenant'), eq(supportTickets.status, 'resolved'))
            : eq(supportTickets.status, 'waiting_admin'),
        ))
        .returning({ id: supportTickets.id });
      if (!updated) {
        const [existing] = await tx.select({ id: supportTickets.id }).from(supportTickets)
          .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenantId))).limit(1);
        if (!existing) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ.');
        const [current] = await tx.select({ status: supportTickets.status }).from(supportTickets)
          .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenantId))).limit(1);
        if (current?.status === 'closed') throw new ForbiddenException('Yêu cầu đã đóng. Hãy tạo yêu cầu mới nếu cần hỗ trợ tiếp.');
        throw new ConflictException(senderRole === 'tenant' ? 'Ticket đang chờ ZenBook phản hồi.' : 'Ticket đang chờ tenant phản hồi.');
      }
      await tx.insert(supportMessages).values({ tenantId, ticketId, senderId: userId, senderRole, body });
    });
    return senderRole === 'tenant' ? this.getTenant(tenantId, ticketId) : this.getPlatform(ticketId);
  }

  private ticketDto(ticket: typeof supportTickets.$inferSelect): SupportTicketDto {
    return { id: ticket.id, tenantId: ticket.tenantId, subject: ticket.subject, category: ticket.category as SupportTicketCategory,
      status: ticket.status as SupportTicketStatus, billingOrderId: ticket.billingOrderId,
      createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString(), messages: [] };
  }

  private async withMessages(ticket: typeof supportTickets.$inferSelect): Promise<SupportTicketDto> {
    const messages = await db.select({ message: supportMessages, senderName: users.displayName }).from(supportMessages)
      .innerJoin(users, eq(users.id, supportMessages.senderId))
      .where(and(eq(supportMessages.tenantId, ticket.tenantId), eq(supportMessages.ticketId, ticket.id)))
      .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id)).limit(500);
    return { ...this.ticketDto(ticket), messages: messages.map(({ message, senderName }) => ({ id: message.id,
      senderRole: message.senderRole as 'tenant' | 'platform_admin', senderName, message: message.body, createdAt: message.createdAt.toISOString() })) };
  }
}
