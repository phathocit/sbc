import { Injectable, Logger, OnModuleDestroy, OnModuleInit, type MessageEvent } from '@nestjs/common';
import { filter, interval, map, merge, of, Subject, takeUntil, timer, type Observable } from 'rxjs';
import { getPostgresClient } from '../../database';

@Injectable()
export class TenantNotificationEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantNotificationEventsService.name);
  private readonly signals = new Subject<string>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopListening: (() => Promise<void>) | undefined;
  private stopping = false;

  onModuleInit(): void { void this.startListening(); }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stopListening) await this.stopListening().catch(() => undefined);
    this.signals.complete();
  }

  stream(tenantId: string): Observable<MessageEvent> {
    const initial: MessageEvent = { type: 'notification', data: { kind: 'sync' } };
    const changes = this.signals.pipe(filter((id) => id === tenantId), map((): MessageEvent => ({ type: 'notification', data: { kind: 'changed' } })));
    const heartbeat = interval(20_000).pipe(map((): MessageEvent => ({ comment: 'keep-alive' })));
    return merge(of(initial), changes, heartbeat).pipe(takeUntil(timer(5 * 60_000)));
  }

  private async startListening(): Promise<void> {
    if (this.stopping) return;
    try {
      const listener = await getPostgresClient().listen('tenant_notifications', (payload) => this.signals.next(payload));
      if (this.stopping) { await listener.unlisten(); return; }
      this.stopListening = () => listener.unlisten();
    } catch (error) {
      this.logger.warn(`Tenant notification listener unavailable: ${error instanceof Error ? error.name : 'unknown'}`);
      if (!this.stopping) this.retryTimer = setTimeout(() => void this.startListening(), 5_000);
    }
  }
}
