# Outbox email worker

The worker consumes `guest_access.delivery.requested`, `tenant_application.approved_email.requested`, and `tenant_owner_invitation.requested` outbox records. It claims one record at a time with `FOR UPDATE SKIP LOCKED` and a lease. An expired lease makes an abandoned record eligible again after a process crash. Other outbox event types remain untouched.

SMTP delivery is at-least-once. If the SMTP server accepts a message and the worker crashes before recording `processed_at`, the message can be sent again after the lease expires. A stable `Message-ID` based on the outbox ID helps mail systems identify retries but does not guarantee deduplication.

SMTP settings are read from the encrypted platform settings row. The worker needs `APP_CONFIG_MASTER_KEY` to decrypt it. Guest delivery additionally uses guest token keys selected by the outbox `keyId`; retain old key IDs while messages encrypted with those keys are pending. Existing-account approval emails link to login. Public tenant approvals send a one-time owner invitation that expires after 48 hours; its token is encrypted in the outbox and the encrypted payload is erased after successful delivery. The approval decision, tenant setup, invitation hash and email outbox record are committed in the same database transaction, so SMTP outages do not undo tenant approval.

Retryable SMTP failures use exponential backoff with jitter and dead-letter after `WORKER_MAX_ATTEMPTS`. Missing delivery configuration or an unavailable historical key is deferred without consuming the retry budget. Logs contain only event names, outbox IDs, attempt counts and sanitized reason codes.

Run after building `@sbc/database` and applying the database migrations. `pnpm dev:worker` runs in watch mode; `pnpm build:worker` builds the worker and `pnpm start:worker` starts the compiled process. The process logs a readiness event after connecting to PostgreSQL, emits aggregate counters every minute, and exits cleanly on SIGINT/SIGTERM.
