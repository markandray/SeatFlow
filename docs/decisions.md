# SeatFlow: Architectural & Design Decisions

This document records the foundational architectural decisions, invariants, and trade-offs made in the design and implementation of SeatFlow.

---

## 1. Partial Unique Index vs. Status-tracking Columns

### Decision
We use a MongoDB partial unique index on `(eventId, userId)` with the filter:
```json
{
  "status": { "$in": ["WAITLISTED", "OFFERED", "CONFIRMED", "CHECKED_IN"] }
}
```

### Rationale
- **Double-click and concurrency protection:** Ensures that concurrent or duplicate registration attempts are blocked directly at the database engine level, resulting in MongoDB code 11000 which we map cleanly to HTTP 409 Conflict.
- **Re-joining support:** When a registration transitions to `CANCELLED` or `EXPIRED`, it drops out of the partial index filter. This allows the user to re-register for the event later without requiring complex soft-deletion schemes or artificial active/inactive flags.
- **Fallback consideration:** If any target MongoDB cluster rejects `$in` within `partialFilterExpression`, the planned fallback is an `isActive: Boolean` field maintained by the service layer with a partial index on `{ isActive: true }`. Testing verified that MongoDB 6.0+ fully supports `$in` partial filter expressions, and the index was confirmed (UNIQUE + PARTIAL) in Atlas.

---

## 2. One-at-a-Time Offers & Queue Fairness

### Decision
When a seat is freed up, exactly one time-limited offer is extended to the head of the waitlist (lowest `seq`). Multiple offers are never broadcast simultaneously for the same seat.

### Trade-off & Rationale
- **Fairness & Determinism:** Strict FIFO queue ordering is guaranteed. The person who has been waiting longest is guaranteed exclusive claim rights for their offer duration (default 10 minutes; configurable via `OFFER_MINUTES`).
- **Safety over speculative throughput:** While broadcasting an offer to 3 people simultaneously ("first to click wins") might fill seats faster, it causes user frustration, race conditions, and unfairness for users who were ahead in line. One-at-a-time offers provide a provable guarantee that `heldSeats <= capacity` at all times.

---

## 3. Safety vs. Liveness (Guarded Updates vs. Sweeper)

### Decision
- **Safety:** Enforced purely via guarded single-document atomic updates (`findOneAndUpdate` with pre-condition filters on current status, capacity, and timestamps). Controllers never mutate status directly.
- **Liveness:** Maintained through three complementary layers: (1) claim guard timestamp check, (2) lazy expiry on read requests (`refreshEvent`), and (3) an active background cron sweeper.

### Rationale
- On platforms like Render where free-tier web services sleep after inactivity, cron sweepers do not run during sleep. Because safety relies strictly on guarded atomic updates and lazy evaluation during incoming HTTP reads, an event can never become overbooked or double-confirmed, even if the cron sweeper has not executed for hours.

---

## 4. Expiry on Read + Background Sweeper

### Decision
Stale offers (`status: 'OFFERED', offerExpiresAt < now`) are expired both when read endpoints are queried (`GET /api/events/:id`, `GET /api/registrations/mine`, organizer attendee lists) and periodically by a 15-second cron sweeper. The sweeper calls the same `refreshEvent` function as the read paths, not its own allocation code.

### Rationale
- Immediate responsiveness: A user refreshing their screen immediately sees an up-to-date queue and freed seats, without waiting for the next cron tick.
- Asynchronous coverage: Unattended events with no active web traffic are still advanced by the background sweeper when the service is awake.

---

## 5. Reconciler Design and Double-Check Mechanism

### Decision
A background job runs once per minute to reconcile `heldSeats` against `count(OFFERED + CONFIRMED + CHECKED_IN)`. The sequence is: count, wait about 2 seconds (outside the lock), count again. Only if both counts agree with each other and differ from the stored counter does it take the per-event lock, re-read the event, and apply the correction as a guarded update (`updateOne({ _id, heldSeats: observedValue }, { heldSeats: actual })`). If the counter changed in the meantime, the fix is skipped and retried on the next cycle. An audit entry (`RECONCILED`) is written only when the update modified a document.

### Rationale
- Under heavy concurrent load, intermediate atomic state transitions (e.g. seat grab followed by waitlist assignment) could temporarily create a 1-seat transient gap. The double check ensures in-flight requests are not erroneously "corrected" into an invalid state, and the guarded update catches anything that changed after the second count.
- The recheck delay is a parameter (`recheckMs`) so tests call the reconciler directly with `recheckMs: 0` and never wait on the cron schedule. It is the one deliberate delay in the codebase; no request flow sleeps or retries.
- The wait is never held inside the lock, so it cannot block registrations.

---

## 6. No Redis, No Socket.io (Why Polling is Enough)

### Decision
SeatFlow deliberately omits Redis and Socket.io. Real-time updates are driven by client-side HTTP polling (5 to 10 second intervals) that pauses when the browser tab is hidden.

### Rationale
- **Operational simplicity & reliability:** A standard Node.js + MongoDB deployment removes external broker dependencies, distributed cache invalidation bugs, and WebSocket connection state synchronization across horizontal replicas.
- **Campus event scale:** For campus workshops and fest events with hundreds to low thousands of attendees, lightweight HTTP polling with server-time-based countdowns is robust and cost-effective.

---

## 7. Single Allocation Path (`allocate(eventId)`)

### Decision
All seat allocation logic is centralized in a single service function: `allocate(eventId)`. It is called by:
- User registration
- User cancellation
- User declining an offer
- Offer expiry (lazy or sweeper)
- Organizer increasing event capacity
- Cron sweeper cycles

### Rationale
- Eliminates duplicated or diverging seat-allocation logic.
- Guarantees that free capacity is always offered strictly in FIFO order to the waitlist head before any general registration can consume it.
- The unlocked implementation (`allocateUnlocked`) is exported for testing only; application code never calls it directly (see decision 12).

---

## 8. Post-Deadline Rule

### Decision
The `registrationDeadline` strictly gates new registrations. However, existing waitlist offers and cascades continue to cycle until `startsAt`.

### Rationale
- Prevents new participants from joining when registration is closed, while ensuring existing waitlisted students who signed up before the deadline still receive seats vacated by cancellations right up until the event starts.

---

## 9. Re-joining Goes to Back of Queue

### Decision
If a user cancels their registration or allows an offer to expire, re-registering assigns a new sequence number (`seq`), placing them at the back of the queue.

### Rationale
- Maintains queue integrity. A student cannot "park" an offer or leave and re-enter the front of the queue ahead of other students who remained waiting.

---

## 10. JWT in Authorization Header

### Decision
Authentication uses stateless JSON Web Tokens passed in standard `Authorization: Bearer <token>` headers. The token payload contains user ID and role, and requests verify user status and role against both the token and the database.

### Rationale
- Standard, cross-origin compatible, and free of CSRF vulnerabilities inherent to cookie-based approaches across separate frontend/backend deployment domains (e.g. Vercel frontend + Render backend). Because no cookies are used, CORS is configured without credentials and limited to a single configured origin.

---

## 11. Instant Confirm via the `registering` Flag and an Atomic Update Pipeline

### Problem
A request that registers while a seat is free should be confirmed instantly, not handed a 10-minute offer. But `allocate` always takes the lowest `seq` from the waitlist, which is not necessarily the registrant that triggered it. Under concurrency, request A's allocation can pop request B's registration after B's own allocation already saw a full event.

### Decision
`register()` inserts the registration with `registering: true`. Inside `allocate`, taking the head of the waitlist is ONE atomic `findOneAndUpdate` with an update pipeline:
- If `registering === true` AND `createdAt` is within the last 15 seconds (`$$NOW`), the registration becomes `CONFIRMED` (`confirmedAt = $$NOW`, `offerExpiresAt = null`, `registering = false`).
- Otherwise (a waitlist cascade after a cancel or expiry) it becomes `OFFERED` with an `offerExpiresAt`.

`register()` clears the flag in a `finally` block after its own `allocate` finishes, so it is cleared even if `allocate` throws.

### Rejected alternatives
- **Sleep/poll loop in `register()`** (an earlier attempt): timing-dependent, adds up to about 600 ms of latency per waitlisted registration, and fails intermittently under higher latency. Removed.
- **The flag alone**: not sufficient. Repeated load runs showed 7 to 9 confirmed instead of 10; the surplus registrants received offers instead (no over-booking, but wrong behavior). See decision 12.

### Rationale
- **No timing waits:** nothing in `register()` sleeps, polls, or retries.
- **Safety:** the 15-second freshness check on `createdAt` ensures a stale registration cannot be auto-confirmed if a crash happens before the flag is cleared.

---

## 12. Per-Event Allocation Lock (In-Process Keyed Mutex)

### Decision
`allocate(eventId)` runs `allocateUnlocked(eventId)` inside an in-process keyed mutex (`utils/keyedMutex.js`). Allocations for one event run one at a time; different events run in parallel. The reconciler's correction and event cancellation use the same lock.

### Rationale
- A registrant keeps `registering: true` until its own `allocate` has finished. Because allocations for one event are serialized, any allocation that could pop that registrant finishes before the flag is cleared, so a registrant is confirmed instantly whenever a seat was free for them.
- **Safety does not depend on the lock.** It comes from the guarded atomic updates (the `heldSeats < capacity` seat grab and the status-guarded head pop). A dedicated test calls `allocateUnlocked` concurrently and asserts the safety invariants still hold. The lock only provides the instant-confirm behavior.
- **Verification:** with the lock, repeated local load runs (a 30-run soak, plus several batches of 10) gave exactly 10 confirmed and 40 waitlisted each time, and the deployed API gave the same result. One isolated failure seen once, right after a full Jest run on the same machine, did not reproduce in the 40+ runs that followed; it is believed to be local resource contention but was not conclusively explained.

### Trade-offs and assumptions
- **Single process:** the lock only serializes within one Node process. The deployment runs one API instance (Render free tier, `WEB_CONCURRENCY=1`). With several instances, a registrant could occasionally receive an offer instead of an instant confirmation; nothing would ever be over-booked.
- **Throughput on one hot event:** registrations for the same event are processed in order. Measured on the deployed free-tier stack: 50 simultaneous registrations took about 41 s warm (37 s in an earlier run) and about 63 s with a cold start, dominated by database round trips from the free-tier API to Atlas. Realistic campus traffic is far below a 50-request burst, and different events do not block each other.
- **Possible later improvement:** reduce round trips inside the locked section (batch audit/notification writes, skip the stale-offer scan when not needed). Not done, because correctness took priority.

---

## 13. Event Cancellation Under the Lock (Mutex Is Not Re-entrant)

### Decision
Cancelling an event runs its whole sequence (guarded status change to `CANCELLED`, moving active registrations to `CANCELLED`, setting `heldSeats = 0`, inserting `EVENT_CANCELLED` notifications, one audit entry) inside `withLock(String(eventId), ...)`.

### Rationale
- An in-flight allocation could otherwise grab a seat or promote a waitlisted registration after the cancellation started and leave a held seat on a cancelled event. A test cancels while an allocation is in flight and checks the invariants afterwards.
- The keyed mutex is not re-entrant, so nothing inside a `withLock` callback may call `allocate()`, `refreshEvent()`, or anything else that takes the same event's lock; doing so would deadlock the request. The cancellation code therefore uses direct guarded updates only.

---

## 14. Events Are Cancelled, Never Deleted

### Decision
There is no delete endpoint. Organizers cancel events, and cancelled events remain readable by id (students see "Event cancelled") but disappear from the public list. Draft and cancelled events never appear in the public listing; organizers see all their own events through `GET /api/events/mine`.

### Rationale
- Deleting an event would orphan registrations, notifications, and the audit log. Cancelling keeps the history intact and gives attendees a clear message and a notification.

Cancelled events are read-only: edit, capacity change, publish, and repeat cancellation return 409 EVENT_CANCELLED (enforced by guarded updates, with ownership checked first), while attendees and the audit log stay viewable.
---

## 15. Demo Data and Cleanup Tooling

### Decision
`npm run seed` is idempotent and creates the demo organizer, five demo students, and four `DEMO ` events (nearly full, full with a waitlist, open, draft) through the service layer, so the data satisfies the same invariants as live data. `npm run cleanup` is a dry run by default that prints the database name, host (without credentials), and counts; `--confirm` requires typing the database name before anything is deleted. `npm run reset-demo` runs the confirmed cleanup then the seed. The load test tags its own data (`LOADTEST` events, `@loadtest.local` users) and removes it in a `finally` block, so a failed run does not leave junk in a shared database.

### Rationale
- The same database serves local development and the live demo, so destructive scripts need explicit, hard-to-trigger confirmation. Seeding through the service layer avoids hand-built data that could silently violate invariants.

---

## 16. Known Limitations

- Single API instance assumption (decision 12).
- Allocation is serialized per event; a single very hot event handles registrations in order.
- Free-tier cold starts (Render sleeps after inactivity; the first request can take about a minute).
- Polling (5 to 10 seconds) instead of push updates, so countdowns and positions can be a few seconds stale.
- The background sweeper does not run while the free-tier service sleeps; correctness does not depend on it (decision 3).
- Notifications are in-app only.
- `npm audit` reports advisories in some dependencies (zod, node-cron/uuid on the server; react-router on the client) whose fixes require major upgrades; not applied.