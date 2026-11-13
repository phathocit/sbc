# Booking engine implementation notes

## Transaction and locking protocol

Booking writes use PostgreSQL's default `READ COMMITTED` isolation and one database transaction per operation. The transaction also writes its booking event, minimal outbox message, and idempotency result.

For create and reschedule, the lock order is:

1. The tenant's active location row with `FOR SHARE`.
2. The tenant policy row with `FOR SHARE`.
3. The service row with `FOR SHARE`.
4. All eligible staff profile rows, ordered by staff UUID, with `FOR UPDATE`.

Reschedule first locks the booking row and its active allocation, then takes the same location, policy, service, and staff locks. State transitions lock the booking row. Pending expiration locks expired pending bookings in booking UUID order.

Catalog scheduling writes use the same guard rows. Location hours and location exceptions lock the location row with `FOR UPDATE`, then the affected staff profiles in UUID order. Staff hours lock the location and that staff profile. Staff eligibility updates update the staff profile row in the same transaction as eligibility links. Creating a staff profile locks the location row. These guards make a booking re-read schedule data after it has waited for a schedule edit to commit.

The locks serialize application operations; the database exclusion constraint remains the final protection against overlapping allocations, including writes from another process. A booking allocation occupies the half-open range `[start - buffer_before, end + buffer_after)`. `active` controls whether the range blocks time. `is_current` identifies the booking's assigned staff, including after a terminal transition; rescheduling marks the prior allocation non-current and adds a new current allocation.

For `ANY_AVAILABLE`, eligible staff are ranked by nearby active workload and UUID. The transaction tries up to 32 candidates in nested savepoints; an exclusion conflict rolls back only that candidate attempt. A `SPECIFIC` request tries only the requested staff and never switches staff.

## Expiration and durable events

Every booking read path and write path first expires pending rows using database time. Expiration changes the booking and frees its active allocation in the same transaction. The outbox stores only the booking ID and event type; it contains no customer email, other customer details, or guest credential. Email delivery and guest self-service are not enabled by this item.

## Snapshots and customer records

Service and tenant policy values are copied into each booking at creation. Service edits do not alter the booking snapshot; rescheduling uses the saved service duration and buffers. Each booking creates a tenant-local customer row; email values are normalized, and unverified email addresses are not merged automatically.
