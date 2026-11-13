import { Injectable, Logger, OnModuleDestroy, OnModuleInit, type MessageEvent } from '@nestjs/common';
import { interval, merge, of, Subject, takeUntil, timer, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getPostgresClient } from '../../database';

const CHANNEL = 'platform_notifications';
const STREAM_MAX_AGE_MS = 5 * 60_000;
const HEARTBEAT_MS = 20_000;

@Injectable()
export class PlatformNotificationEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformNotificationEventsService.name);
  private readonly signals = new Subject<MessageEvent>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopListening: (() => Promise<void>) | undefined;
  private stopping = false;

  onModuleInit(): void {
    void this.startListening();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stopListening) {
      try { await this.stopListening(); }
      catch (error) { this.logger.warn(`Could not stop PostgreSQL notification listener (${error instanceof Error ? error.name : 'unknown error'}).`); }
    }
    this.signals.complete();
  }

  stream(): Observable<MessageEvent> {
    const initialSync: MessageEvent = { type: 'notification', data: { kind: 'sync' } };
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ comment: 'keep-alive' })));
    return merge(of(initialSync), this.signals.asObservable(), heartbeat).pipe(takeUntil(timer(STREAM_MAX_AGE_MS)));
  }

  private async startListening(): Promise<void> {
    if (this.stopping) return;
    try {
      const listener = await getPostgresClient().listen(
        CHANNEL,
        () => this.signals.next({ type: 'notification', data: { kind: 'changed' } }),
        () => this.signals.next({ type: 'notification', data: { kind: 'sync' } }),
      );
      if (this.stopping) {
        await listener.unlisten();
        return;
      }
      this.stopListening = () => listener.unlisten();
    } catch (error) {
      this.logger.error(`PostgreSQL notification listener could not connect (${error instanceof Error ? error.name : 'unknown error'}); retrying.`);
      if (!this.stopping) this.retryTimer = setTimeout(() => void this.startListening(), 5_000);
    }
  }
}
