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
- **Fallback consideration:** If any target MongoDB cluster rejects `$in` within `partialFilterExpression`, the planned fallback is an `isActive: Boolean` field maintained by the service layer with a partial index on `{ isActive: true }`. Testing verified that MongoDB 6.0+ fully supports `$in` partial filter expressions.

---

## 2. One-at-a-Time Offers & Queue Fairness

### Decision
When a seat is freed up, exactly one time-limited offer is extended to the head of the waitlist (lowest `seq`). Multiple offers are never broadcast simultaneously for the same seat.

### Trade-off & Rationale
- **Fairness & Determinism:** Strict FIFO queue ordering is guaranteed. The person who has been waiting longest is guaranteed exclusive claim rights for their offer duration (default 10 minutes; configurable via `OFFER_MINUTES`).
- **Safety over speculative throughput:** While broadcasting an offer to 3 people simultaneously ("first to click wins") might fill seats faster, it causes user frustration, race conditions, and unfairness for users who were ahead in line. One-at-a-time offers provide a mathematically provable guarantee that `heldSeats <= capacity` at all times.

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
Stale offers (`status: 'OFFERED', offerExpiresAt < now`) are actively expired both when read endpoints are queried (`GET /api/events/:id`, `GET /api/registrations/mine`, organizer attendee lists) and periodically by a 15-second cron sweeper.

### Rationale
- Immediate responsiveness: A user refreshing their screen immediately sees an up-to-date queue and freed seats, without waiting for the next cron tick.
- Asynchronous coverage: Unattended events with no active web traffic are still advanced by the background sweeper when the service is awake.

---

## 5. Reconciler Design and Double-Check Mechanism

### Decision
A background job runs once per minute to reconcile `heldSeats` against `count(OFFERED + CONFIRMED + CHECKED_IN)`. The reconciler computes the actual count, pauses for 2 seconds, and computes it a second time. It only adjusts `heldSeats` if both counts agree with each other and disagree with the stored counter.

### Rationale
- Under heavy concurrent load, intermediate atomic state transitions (e.g. seat grab followed by waitlist assignment) could temporarily create a 1-seat transient gap. The double check ensures in-flight requests are not erroneously "corrected" into an invalid state. Every reconciliation writes a `RECONCILED` entry to `AuditLog`.

---

## 6. No Redis, No Socket.io (Why Polling is Enough)

### Decision
SeatFlow deliberately omits Redis and Socket.io. Real-time updates are driven by client-side HTTP polling (5–10 second intervals) that pauses when the browser tab is hidden.

### Rationale
- **Operational simplicity & reliability:** A standard Node.js + MongoDB deployment removes external broker dependencies, distributed cache invalidation bugs, and WebSocket connection state synchronization across horizontal replicas.
- **Campus event scale:** For campus workshops and fest events with hundreds to low thousands of attendees, lightweight HTTP polling with conditional `serverTime` countdowns is robust, highly cacheable, and cost-effective.

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
- Standard, cross-origin compatible, and free of CSRF vulnerabilities inherent to cookie-based approaches across separate frontend/backend deployment domains (e.g. Vercel frontend + Render backend).

---

## 11. Deterministic Instant-Confirm via `registering` Flag and Atomic Update Pipeline

### Decision
Registration replaces any client-side or service-layer sleep/polling loops with a single atomic update pipeline in MongoDB. When a user calls `register()`, their registration is created with `registering: true`. During `allocate(eventId)`, taking the head of the waitlist evaluates an atomic pipeline condition:
- If `registering === true` AND `createdAt` is within the last 15 seconds (`$$NOW`), the registration transitions directly to `CONFIRMED` (`confirmedAt = $$NOW, offerExpiresAt = null, registering = false`).
- Otherwise (e.g., when a seat is freed by cancellation or expiry), it transitions to `OFFERED` with an `offerExpiresAt` countdown.

### Rationale
- **Zero timing waits:** Eliminates all non-deterministic sleep, retry, or polling loops in `register()`.
- **Race-free concurrent execution:** When 50 parallel registration requests arrive simultaneously, one request's `allocate` loop may pop another request's waitlisted entry. Because the transition is evaluated atomically inside the database engine during the head-of-waitlist pop, the registration is guaranteed to become `CONFIRMED` instantly and safely, without read-then-write windows or races.
- **Safety guarantee:** The 15-second freshness check on `createdAt` ensures that stale registrations cannot be accidentally auto-confirmed if a crash occurs before `registering` is cleared.

