# Operations guide

This guide covers local setup for the platform settings UI, the guest email worker, database backup/restore, and a manual demo tenant. It is not a production deployment approval or a claim that production readiness has been verified.

## Local setup and first platform administrator

1. Copy `.env.example` to `.env` and keep `.env` out of source control. The included PostgreSQL password is for local development only.
2. Generate two independent random values for `APP_CONFIG_MASTER_KEY` and `PLATFORM_BOOTSTRAP_TOKEN` in PowerShell, then place them in `.env` before starting the API:

   ```powershell
   $masterBytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Fill($masterBytes)
   $masterKey = [Convert]::ToHexString($masterBytes).ToLower()
   $bootstrapBytes = New-Object byte[] 48
   [Security.Cryptography.RandomNumberGenerator]::Fill($bootstrapBytes)
   $bootstrapToken = [Convert]::ToBase64String($bootstrapBytes)
   $masterKey
   $bootstrapToken
   ```

   The master key is 32 random bytes encoded as 64 hexadecimal characters. The bootstrap token contains 48 random bytes encoded as Base64. Copy both values directly into the local `.env`; do not put them in chat, source files, screenshots, or logs. Do not reuse the guest token key, JWT secret, or database password for either value.
3. Keep a protected backup of `APP_CONFIG_MASTER_KEY` outside the database. `platform_settings` stores secrets encrypted with it; losing the master key makes the saved SMTP and guest keys unreadable. Do not commit, email, or paste these values into support chat.
4. Start local PostgreSQL with `docker compose up -d postgres`, then install dependencies with `pnpm install`.
5. Build shared packages and apply the additive migrations:

   ```powershell
   pnpm --filter @sbc/contracts build
   pnpm --filter @sbc/database build
   pnpm db:migrate
   ```

6. Start the API and web with `pnpm dev`. Register or log into the account that should become the first platform administrator, then open `/platform/settings` from the workspace.
7. Enter the one-time `PLATFORM_BOOTSTRAP_TOKEN`. Bootstrap can appoint only the first administrator; tenant owner/admin roles do not grant platform access.
8. In Platform Settings, enter the public web origin, SMTP server settings, and a guest token key. The page can generate a 32-byte guest key. Saved secrets are never returned to the browser; changes require the account password again. A blank SMTP password preserves the saved password.
9. Start the worker in a separate terminal with `pnpm dev:worker`.

`APP_CONFIG_MASTER_KEY` and `PLATFORM_BOOTSTRAP_TOKEN` are bootstrap values and must stay outside the UI. The UI stores the operational SMTP password and guest token keys encrypted in the database. In production, provide the bootstrap values from a secret manager rather than a committed file.

## Browser authentication and plan management

Account authentication uses short-lived JWT access cookies and rotating refresh JWT cookies. Both are `HttpOnly`; production cookies are `Secure` and `SameSite=Lax`. Access lasts 10 minutes. Refresh sessions are tracked in PostgreSQL: platform administrators expire after 8 hours idle or 24 hours absolute, and tenant accounts after 7 days idle or 30 days absolute. Recent human interaction extends the idle window; background polling does not. Refresh-token reuse revokes that session. PostgreSQL is the session source of truth, so Redis is not required for this deployment model. Configure `WEB_ORIGINS` as a comma-separated list of exact web origins; production values must use HTTPS. Existing browser login state is intentionally invalidated when the auth-session migration is applied, so users sign in again.

Build `@sbc/contracts` and `@sbc/database` before applying the pending additive migrations. Migrations 0009 through 0011 add server-side auth sessions, versioned plan configuration/audit, and dynamic requested plan codes. The Platform Admin has a **Gói dịch vụ** page to publish a new version and a tenant detail action to assign an active plan with a required audit note. Publishing a version does not change existing subscriptions; tenant assignments start a new period immediately. The public landing page reads active plan prices, limits, and features from the API catalog. Build/restart API and web after migration; do not manually edit historical plan rows or billing orders.

## Guest email worker

The worker processes only `guest_access.delivery.requested` outbox rows. It claims rows with a lease so another worker can recover a row after the original process stops. SMTP errors use exponential backoff with jitter; messages are marked dead-lettered after the configured retry limit. Missing settings or a missing historical guest key defer the message without consuming its retry budget.

Use these scripts after building the database package and applying migrations:

```powershell
pnpm dev:worker
pnpm build:worker
pnpm start:worker
```

The worker emits readiness, aggregate counters, and sanitized reason codes with outbox IDs. It never logs recipient addresses, token fragments, SMTP passwords, or decrypted links. Inspect dead-lettered rows through the operational database tooling and correct the underlying configuration before deciding how to replay them; do not mark them processed just to clear the queue.

SMTP delivery is at-least-once. If the provider accepts a message and the worker stops before saving `processed_at`, the worker may send it again after the lease expires. The stable `Message-ID` can help mail systems identify retries but does not guarantee deduplication.

When rotating a guest token key, use a new key ID. Keep old key IDs until no queued or dead-lettered delivery needs them. The worker uses the key ID recorded in each outbox payload. Do not rotate `APP_CONFIG_MASTER_KEY` without an explicit re-encryption procedure and a protected backup of the old key.

## Manual demo tenant

The project does not seed or alter a database automatically. Create a demo tenant through the UI:

1. Register a local demo account and complete onboarding to create the tenant and its active location.
2. Open the workspace catalog. Create a service, make it active and published, create a staff profile, and assign the staff member to the service.
3. Configure business hours and the staff member's working hours so at least one future appointment slot is available.
4. Open `/public/<tenant-slug>`, select the service, staff preference, date, and time, then submit the guest details.
5. Review the booking in `/workspace/calendar`. When SMTP is configured and the worker is running, check the demo inbox for the management link and use it to inspect guest cancellation/rescheduling.

Use a dedicated local test mailbox. Do not put real customer data into a demo tenant.

## Database backup and restore

Install PostgreSQL client tools (`pg_dump` and `pg_restore`) on the host. Use an interactive password prompt or a protected PostgreSQL password file; avoid putting the database password directly in command arguments. Store backup archives outside the repository in a directory with restricted access.

Example PowerShell backup using an interactive password prompt:

```powershell
$backupDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'SBC-backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupFile = Join-Path $backupDir ("sbc-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
pg_dump --format=custom --no-owner --host=localhost --port=5432 --username=sbc --dbname=service_business_cloud --file=$backupFile
```

Restore into a separate, empty recovery database so the existing database is not overwritten. Create that empty database through your normal PostgreSQL administration process, then restore the archive without `--clean` or `--if-exists`:

```powershell
pg_restore --no-owner --host=localhost --port=5432 --username=sbc --dbname=sbc_recovery $backupFile
```

After restore, verify the recovery database with the application owner before redirecting any application to it. Back up `APP_CONFIG_MASTER_KEY` separately in the secret manager; the database archive contains encrypted settings, not the key required to decrypt them. Periodically test restore into a disposable database. Never run restore against a database containing data you need to keep.

For local PostgreSQL, `docker compose up -d postgres` starts the service and the named `postgres_data` volume persists its files. `docker compose down` stops the container without removing that volume. Do not use volume deletion as a backup or restore procedure.

## Production preparation checklist

Production deployment is not included here. Before any production rollout, an operator must separately approve and prepare:

- HTTPS for the web app and API, strict origin/CORS settings, and secure host/container configuration.
- Secret-manager delivery for `APP_CONFIG_MASTER_KEY`, bootstrap credentials, database credentials, and any required runtime values.
- A managed PostgreSQL backup schedule, retention policy, access controls, and a tested restore procedure.
- Worker/API monitoring for queue age, retries, dead letters, database health, and SMTP delivery errors, with log redaction retained.
- SMTP provider approval, sender-domain verification, rate/volume limits, and an explicit decision to enable production email.
- Migration review, rollout and rollback procedure, resource limits, and ownership for incident response.

Do not treat the local Compose file, this checklist, or local manual walkthrough as a production-ready deployment.
# Payments and plan limits

Payment activation requires the database migration through 0008, built `@sbc/contracts` and `@sbc/database` packages, the API rebuilt against those packages, and a running PostgreSQL database. Set `PAYMENTS_API_PUBLIC_URL` to the public API origin (HTTPS in production) and configure the public web origin in Platform settings. The platform admin then saves VNPAY and/or MoMo merchant credentials in `/platform/settings`; encrypted secret values are never returned to the browser.

VNPAY requires the callback URL displayed in Platform settings to be registered as the merchant IPN URL. MoMo receives its IPN URL in each signed checkout request. Use sandbox mode and merchant-provided sandbox accounts first. This application does not auto-debit: owners pay each monthly period manually. A browser redirect never activates a plan; only a valid provider server notification does. Test quotas by creating staff profiles and bookings; cancelling a booking does not restore its consumed monthly booking quota.
