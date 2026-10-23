# SeatFlow: Event Registration with Fair Waitlist

> **Instructions for the coding agent (read first)**
>
> - This file is the single source of truth. Re-read it at the start of every session.
> - Implement ONLY the session you are asked to do (see section 13). Do not start later sessions.
> - Make small commits with clear messages (`feat:`, `fix:`, `test:`, `docs:`). Never one giant commit. Never commit `.env`; commit `.env.example` only. Run `git status` before every push.
> - If anything is ambiguous, or you want to deviate from this spec, **ask first**. Do not silently choose a different design. In particular, never replace the atomic operations in section 6 with read-then-write logic, and never add timing-based waits (sleep, retry loops) to make a test pass.
> - Application code must call `allocate()` (serialized per event), never `allocateUnlocked()`. Anything that changes `heldSeats` and then needs re-allocation (cancel, decline, expiry, capacity change, sweeper) goes through `allocate()`. The reconciler's fix runs inside `withLock`. See 6.2.
> - Do NOT add Socket.io, Redis, payments, or extra features. Real-time is done by polling.
> - After each session, state exactly how the human can verify it (a command or a click path), and list every deviation from this spec in your report.
> - The "Human-only appendix" at the end is not for you. Ignore it.

---

## 1. Product

**Problem:** Popular campus workshops and fest events fill in minutes. People who miss out have no fair queue, and seats freed by cancellations go to whoever refreshes fastest or are wasted.

**Users:** Student clubs and fest teams (organizers) and students (attendees).

**Solution:** Capacity-safe registration. When an event is full, students join a FIFO waitlist. When a seat frees up, the next person gets a time-limited offer (default 10 minutes). If they do not claim it, the offer expires and cascades to the next person.

**Roles:** `organizer`, `student`. JWT auth sent as `Authorization: Bearer <token>`. Role comes from the verified token and the DB, never from request bodies after signup. Signup lets the user pick a role; if `ORGANIZER_INVITE_CODE` is set in env, creating an organizer account requires that code.

## 2. Stack (keep it boring)

- Backend: Node.js, Express, MongoDB Atlas, Mongoose, JWT, bcrypt, zod, node-cron, helmet, express-rate-limit, cors
- Frontend: React (Vite), React Router, polling every 5 to 10 seconds (pause polling when the tab is hidden)
- Tests: Jest, supertest, mongodb-memory-server
- Deploy: Render (API), Vercel (client), MongoDB Atlas free tier
- Structure: MVC with a service layer

```
server/
  src/
    config/        db.js, env.js
    models/        User, Event, Registration, Notification, AuditLog
    controllers/   auth, event, registration, notification
    routes/
    middleware/    authRequired, authOptional, requireRole, validate, errorHandler
    services/      registrationService.js   <- ALL state transitions live here
                   eventService.js, notificationService.js, auditService.js
    jobs/          sweeper.js (cron)
    utils/         ApiError.js, asyncHandler.js, keyedMutex.js
  scripts/         seed.js, loadtest.js
  tests/
client/
  src/ pages/, components/, context/, hooks/ (usePolling), services/api.js
docs/              decisions.md, loadtest-output.txt
```

Local dev: `npm run dev` (`nodemon src/server.js`) so a stale server process cannot be tested by mistake. Before any load test run `lsof -i :5001` and confirm exactly one server is listening.

## 3. Data model

**User:** name, email (unique, lowercase), passwordHash, role (`organizer | student`), createdAt.

**Event:** organizerId, title, description, location, startsAt, registrationDeadline, capacity, heldSeats (confirmed + checked-in + active offers; default 0), nextSeq (waitlist counter; default 0), status (`DRAFT | PUBLISHED | CANCELLED`), createdAt.

**Registration:** eventId, userId, status, seq, registering (boolean, default false; true only while the registering request is in flight, see 6.3), offeredAt, offerExpiresAt, confirmedAt, cancelledAt, checkedInAt, createdAt.

- Status values: `WAITLISTED, OFFERED, CONFIRMED, CHECKED_IN, EXPIRED, CANCELLED, NO_SHOW`
- **Partial unique index** on `(eventId, userId)` with `partialFilterExpression: { status: { $in: ['WAITLISTED','OFFERED','CONFIRMED','CHECKED_IN'] } }`. This blocks duplicates and double-clicks at the DB level and still allows re-joining after a cancel or expiry. (Fallback if Mongo rejects the `$in`: add an `isActive` boolean maintained by the service layer, and make the partial index `{ isActive: true }`.)
- Index on `(eventId, status, seq)` for head-of-waitlist lookup, and on `(userId, status)` for "my registrations".

**Notification:** userId, eventId, type (`OFFER | OFFER_EXPIRED | CONFIRMED | PROMOTED | EVENT_CANCELLED`), message, readAt, createdAt.

**AuditLog:** eventId, actorId (null for system), action, registrationId, payload, createdAt. Write one on every state transition.

**Derived, never stored:** waitlist position = `count(WAITLISTED with seq < mine) + 1`. Seats left = `capacity - heldSeats`.

## 4. State machine (the only allowed transitions)

```
(new) -> WAITLISTED -> OFFERED -> CONFIRMED -> CHECKED_IN
                          |            |
                          v            v
                       EXPIRED      CANCELLED

(new) -> WAITLISTED -> CONFIRMED   (instant confirm for a registering request, see 6.3)

WAITLISTED -> CANCELLED         (frees no seat)
OFFERED    -> CANCELLED         (decline; frees a seat)
OFFERED    -> EXPIRED           (lazy or sweeper; frees a seat)
CONFIRMED  -> CANCELLED         (frees a seat)
CONFIRMED  -> CHECKED_IN        (organizer)
CONFIRMED  -> NO_SHOW           (organizer, only after startsAt; decrements heldSeats, no re-allocation)
```

Rules:

- Every transition goes through `registrationService.js`. Controllers never set status directly.
- Every transition is a guarded atomic update: the filter includes the expected current status.
- Whoever wins the guarded update does the follow-up work (`heldSeats` change, audit, notification). Whoever loses gets a 409 or 410 and does nothing. This is what makes races safe: for example, if cancel and the sweeper race on the same offer, only one of them changes the status, so `heldSeats` is decremented exactly once.

## 5. Invariants (tests must prove these)

1. `heldSeats` equals the number of registrations in `OFFERED + CONFIRMED + CHECKED_IN`.
2. `heldSeats <= capacity` always.
3. A user has at most one active registration per event.
4. The waitlist is strict FIFO by `seq`.
5. Each free seat produces at most one outstanding offer (one-at-a-time offers). Document this trade-off in `docs/decisions.md`: simple, fair, provable, at the cost of slightly lower throughput than offering to several people at once.
6. No offer is created after `startsAt`, and `offerExpiresAt` never exceeds `startsAt`.

Invariants 1 to 6 are SAFETY properties and hold even without the in-process lock. The lock only adds a behavior guarantee for single-process deployments: a request that registers while a seat is free is confirmed instantly, not offered.

## 6. Core concurrency design

MongoDB has no row locks, so correctness comes from single atomic operations plus guarded transitions. Do not replace these with read-then-write code.

**Safety vs liveness (document this):** *Safety* (never over-book, never double-confirm) comes from the guarded atomic updates. *Liveness* (freed seats get re-offered promptly) comes from expiring stale offers on reads and from the cron sweeper. Safety never depends on the cron, which matters because Render's free tier sleeps and cron does not run while it sleeps.

### 6.1 expireStaleOffers(eventId)

Releases offers whose time ran out. Does not allocate (the caller does).

```js
async function expireStaleOffers(eventId) {
  const now = new Date();
  const stale = await Registration.find({ eventId, status: 'OFFERED', offerExpiresAt: { $lt: now } });
  let expired = 0;
  for (const r of stale) {
    const won = await Registration.findOneAndUpdate(
      { _id: r._id, status: 'OFFERED', offerExpiresAt: { $lt: now } },
      { status: 'EXPIRED' }
    );
    if (won) {
      await Event.updateOne({ _id: eventId }, { $inc: { heldSeats: -1 } });
      // audit + notify OFFER_EXPIRED
      expired++;
    }
  }
  return expired;
}
```

### 6.2 allocate(eventId) and allocateUnlocked(eventId)

`allocate` is the single path used by register, cancel, decline, expiry, capacity increase, and the sweeper. It runs `allocateUnlocked` inside an in-process keyed mutex (`utils/keyedMutex.js`, `withLock(key, fn)`), so allocations for ONE event run one at a time while different events run in parallel.

```js
async function allocate(eventId) {
  return withLock(String(eventId), () => allocateUnlocked(eventId));
}

// Safe to call concurrently (safety = guarded atomic updates). Exported for the
// safety test only. Application code must call allocate().
async function allocateUnlocked(eventId) {
  await expireStaleOffers(eventId);
  const granted = [];
  while (true) {
    const now = new Date();
    // 1. grab a seat atomically (refuses if event unpublished/cancelled or already started)
    const ev = await Event.findOneAndUpdate(
      { _id: eventId, status: 'PUBLISHED', startsAt: { $gt: now },
        $expr: { $lt: ['$heldSeats', '$capacity'] } },
      { $inc: { heldSeats: 1 } },
      { new: true }
    );
    if (!ev) break; // full, or event not open

    // 2. take the head of the waitlist with ONE atomic pipeline update
    const expiresAt = new Date(Math.min(
      now.getTime() + OFFER_MINUTES * 60000, ev.startsAt.getTime()));
    const instant = { $and: [
      { $eq: ['$registering', true] },
      { $gte: ['$createdAt', { $subtract: ['$$NOW', 15000] }] },
    ] };
    const reg = await Registration.findOneAndUpdate(
      { eventId, status: 'WAITLISTED' },
      [ { $set: {
          status:         { $cond: [instant, 'CONFIRMED', 'OFFERED'] },
          confirmedAt:    { $cond: [instant, '$$NOW', '$confirmedAt'] },
          offeredAt:      { $cond: [instant, null, '$$NOW'] },
          offerExpiresAt: { $cond: [instant, null, expiresAt] },
          registering:    false } } ],
      { sort: { seq: 1 }, new: true }
    );
    if (!reg) { // nobody waiting: give the seat back
      await Event.updateOne({ _id: eventId }, { $inc: { heldSeats: -1 } });
      break;
    }
    granted.push(reg); // audit + notify: CONFIRMED if reg.status is CONFIRMED, else OFFER
  }
  return granted;
}
```

`OFFER_MINUTES` is parsed with `parseFloat` so `0.5` (30 seconds) works for the demo.

**Why the lock exists:** a registrant keeps `registering: true` until its OWN `allocate` has finished. Because allocations for one event are serialized, any allocation that could pop that registrant finishes before the registrant's flag is cleared, so a registrant is confirmed instantly whenever a seat was free for them. Without the lock, the flag alone is not enough: another request's allocation can pop a registrant after that registrant's own allocation already saw a full event and cleared its flag, leaving them OFFERED instead of CONFIRMED. (Observed in repeated load runs: 7 to 9 confirmed instead of 10; nothing was ever over-booked.)

**Assumption:** a single API process (Render's free tier runs one; `WEB_CONCURRENCY=1`). With several instances, a registrant could occasionally get a 10-minute offer instead of an instant confirmation. Safety is unaffected.

### 6.3 Register

1. Validate: event is `PUBLISHED`, now is before `registrationDeadline`, now is before `startsAt`.
2. Atomically `findOneAndUpdate({_id}, {$inc:{nextSeq:1}}, {new:true})` to get this registration's `seq`.
3. Insert the Registration as `WAITLISTED` with `registering: true`. On a duplicate-key error return **409** ("already registered"). Skipped `seq` numbers are harmless.
4. Call `allocate(eventId)` inside a `try`. Taking the head of the waitlist is the atomic pipeline update in 6.2: if the head has `registering: true` and was created in the last 15 seconds it becomes `CONFIRMED`, otherwise (a waitlist cascade after a cancel or expiry) `OFFERED`.
5. In a `finally`, run `updateOne({ _id, registering: true }, { registering: false })` so the flag is cleared even if `allocate` throws. Reload the registration and return its status and position.

No sleeping, polling, or retrying anywhere in this flow. This makes fairness automatic: nobody can jump ahead of people already waiting, because everyone enters through the waitlist and `allocate` always takes the lowest `seq`.

### 6.4 Claim an offer

```js
const reg = await Registration.findOneAndUpdate(
  { _id, userId, status: 'OFFERED', offerExpiresAt: { $gt: new Date() } },
  { status: 'CONFIRMED', confirmedAt: new Date(), offerExpiresAt: null },
  { new: true }
);
if (!reg) throw new ApiError(410, 'OFFER_GONE', 'This offer expired or is no longer available');
```

### 6.5 Cancel and decline

Guarded transition from `CONFIRMED` or `OFFERED` to `CANCELLED` (filter on `status: { $in: [...] }` and `userId`). Only the winner of that update does `$inc heldSeats -1`, then calls `allocate`. Cancelling from `WAITLISTED` changes status only and frees no seat (test this). Decline applies to `OFFERED` only.

### 6.6 Organizer changes capacity

```js
const ev = await Event.findOneAndUpdate(
  { _id, organizerId, heldSeats: { $lte: newCapacity } },
  { capacity: newCapacity }, { new: true });
if (!ev) throw new ApiError(409, 'CAPACITY_TOO_LOW', 'Capacity cannot be below seats already held');
await allocate(eventId); // a capacity increase must hand the new seats to the waitlist
```

### 6.7 Expiry: three layers

1. **Claim guard:** `offerExpiresAt > now` inside the claim update (an expired offer can never be claimed, even before it is swept).
2. **On read:** `refreshEvent(eventId)` = `expireStaleOffers`, then `allocate` if anything expired. Call it from `GET /api/events/:id`, `GET /api/registrations/mine` (for each of the user's events), and the organizer attendee list.
3. **Sweeper:** `node-cron` every 15 seconds: find distinct `eventId`s having stale offers, call `refreshEvent(eventId)` for each (not its own allocation code). Guard against overlapping runs with an in-process flag. Start it only when `NODE_ENV !== 'test'`. Also run the reconciler (6.8) once a minute.

### 6.8 Reconciler (guards against counter drift)

A crash between a `heldSeats` change and the registration update could leave the counter wrong. Once a minute, for each published event: compute `actual = count(OFFERED + CONFIRMED + CHECKED_IN)`, wait about 2 seconds, compute again. Only if both counts agree with each other and differ from `heldSeats`, set `heldSeats = actual` (inside `withLock(String(eventId), ...)` so it cannot interleave with `allocate`) and write an audit entry (`RECONCILED`). The double check avoids "fixing" a transient mismatch caused by an in-flight request.

### 6.9 Cancelling an event

1. Guarded update: `Event {_id, organizerId, status in [DRAFT, PUBLISHED]} -> CANCELLED` (after this, `allocate` refuses to create offers).
2. `updateMany` all active registrations to `CANCELLED`, set `heldSeats = 0`.
3. `insertMany` an `EVENT_CANCELLED` notification for each affected user, and one audit entry.

## 7. The five workflows

1. **Organizer creates, edits, and publishes an event.** Validation: capacity >= 1, `registrationDeadline` before `startsAt`, `startsAt` in the future. Capacity changes follow 6.6.
2. **Student registers** and is confirmed instantly or placed on the waitlist (6.3). UI shows status and waitlist position.
3. **Waitlist view:** "My registrations" page with status, position in queue, polling every 5 to 10 seconds, cancel button.
4. **Offer cascade:** a cancellation or expiry produces an offer for the next person, with a countdown timer; they can claim or decline; expiry cascades to the next person (6.4 to 6.7). In-app notification bell for offers and expiry.
5. **Organizer management:** attendee list grouped by status (confirmed / offered / waitlisted), check-in button, mark no-shows, cancel event (6.9), audit log view.

**Post-deadline rule (decided):** `registrationDeadline` blocks new registrations only. Waitlist offers continue until `startsAt`. Re-joining after a cancel or expiry creates a new registration at the back of the waitlist (new `seq`); this is intentional.

**Stretch (only if workflows 1 to 5 and all tests are green): smart overbooking.** Organizer can enable it per event. Add `effectiveCapacity` = `capacity + floor(capacity * noShowRate)`, capped at 10% of capacity, where `noShowRate` = NO_SHOW / (CONFIRMED + CHECKED_IN + NO_SHOW) across the organizer's past events (0 if no history). Replace `$capacity` with `$effectiveCapacity` in the guard of `allocateUnlocked`, and keep `effectiveCapacity` in sync when capacity changes. Cut this first if time is short.

## 8. API

```
GET    /api/health
POST   /api/auth/register | /api/auth/login        GET /api/auth/me
GET    /api/events                      (public; search, filter by status/date)
GET    /api/events/:id                  (public, auth optional; returns event, seatsLeft,
                                         waitlistCount, myRegistration + position if logged in, serverTime)
POST   /api/events                                  (organizer)
PATCH  /api/events/:id                              (organizer, owner only)
POST   /api/events/:id/publish | /cancel            (organizer, owner only)
POST   /api/events/:id/register                     (student)
GET    /api/registrations/mine                      (student; each item includes position, offerExpiresAt, serverTime)
POST   /api/registrations/:id/claim | /decline | /cancel   (student, owner of the registration)
GET    /api/events/:id/attendees                    (organizer, owner only)
POST   /api/registrations/:id/check-in | /no-show   (organizer who owns the event)
GET    /api/events/:id/audit                        (organizer, owner only)
GET    /api/notifications     POST /api/notifications/:id/read
```

- Error format: `{ error: { code, message } }`. Use 400 validation, 401 unauthenticated, 403 wrong role or not the owner, 404 missing, 409 duplicate or invalid state, 410 expired or gone offer.
- Include `serverTime` in responses that carry `offerExpiresAt`; the client computes the countdown from `offerExpiresAt - serverTime` to avoid clock skew.

## 9. Frontend pages

Login/Signup, Event list (search), Event detail (button reflects state: Register / Join waitlist / Already registered / Event closed), My Registrations (status, position, countdown, claim/decline/cancel), Organizer dashboard (create/edit event, attendee list, check-in, no-show, audit log), Notification bell (polls every 10 seconds).

- Every page needs loading, empty, success, and error states.
- Disable buttons while a request is in flight; show a clear message for 409 and 410.
- A shared `usePolling(fn, intervalMs)` hook that pauses when the tab is hidden.

## 10. Security and reliability checklist

- Passwords hashed with bcrypt; `JWT_SECRET` in env; never commit `.env`; commit `.env.example` with placeholders.
- Validate every request body and params with zod. Ownership check on every organizer route (an organizer can only manage their own events).
- Rate-limit auth routes, use helmet, restrict CORS to `CLIENT_ORIGIN` (trailing slashes stripped).
- Never trust client-sent role, userId, or status.
- Central error handler: no stack traces in responses in production.

## 11. Tests (the proof)

Unit and API tests (Jest + supertest + mongodb-memory-server) must cover:

1. **Last seat race:** event with capacity 1; 20 parallel register requests from 20 users. Exactly one CONFIRMED, 19 WAITLISTED, `heldSeats == 1`.
2. **Double click:** the same user registers twice in parallel. Exactly one active registration; the other request gets 409.
3. **Claim vs expiry race:** an offer at its expiry boundary; run claim and the sweeper in parallel. Exactly one outcome wins and invariant 1 holds.
4. **Cascade:** cancel one confirmed seat, so the head of the waitlist is OFFERED; let it expire (short `OFFER_MINUTES`), so the next person is OFFERED and `heldSeats` is correct.
5. **Cancel from waitlist frees no seat.**
6. **Capacity:** reducing below `heldSeats` is rejected (409); increasing it offers seats to the waitlist.
7. **Lazy expiry:** with the sweeper not running, a read of the event still expires the stale offer and re-offers the seat.
8. **Event cancel:** all active registrations become CANCELLED, `heldSeats == 0`, notifications created, no new offers possible.
9. **Invariant checker helper:** a function that recomputes invariants 1, 2, 3, 6 for an event; call it at the end of every test above.
10. **Instant-confirm regression:** the 50-request registration scenario, repeated 10 times (also with the pre-head-pop delay hook enabled), asserting `confirmed == capacity` every time.
11. **Safety without the lock:** insert 30 WAITLISTED registrations directly with `registering: false`, capacity 5, run 20 parallel `allocateUnlocked(eventId)` calls; assert `heldSeats == 5`, the OFFERED+CONFIRMED count is 5, and there are no duplicates. This proves that safety does not depend on the lock.
12. **Reconciler:** corrupt `heldSeats` on purpose and check it self-corrects; check it leaves a matching value alone.

**Load test (the headline, `server/scripts/loadtest.js`):**

- Runs against `API_URL` (local or deployed). Seeds an event with capacity 10 directly in the DB, creates 50 users by direct DB insert and signs their JWTs in the script (do not go through `/login`, because bcrypt and the auth rate limiter would slow or block it). Against a deployed API, `JWT_SECRET` and `MONGO_URI` must be the deployed values, passed as environment variables, never written to a file.
- Tags everything it creates (event title starts with `LOADTEST`, user emails end with `@loadtest.local`) and deletes it at the end, even on failure (`try/finally`).
- Fires 50 register requests in parallel (`Promise.all`). Prints an HTTP status-code breakdown and the first error body if any request fails.
- Asserts: confirmed count == 10, waitlisted count == 40, `heldSeats == 10`, no duplicate `seq`, invariants hold.
- Second scenario: 20 parallel requests from ONE user, so exactly one registration exists.
- Prints a clear PASS/FAIL summary, exits non-zero on failure, and saves output to `docs/loadtest-output.txt`.
- Measured (deployed, free tier): 50 registrations in about 37 s warm and about 63 s cold start. Record the numbers and the trade-off in the README.

## 12. Deployment

- Deploy a hello-world (`/api/health` and a blank client page) in Session 1 and redeploy after every session. Never leave first deployment for the last days.
- Env vars (server): `MONGO_URI, JWT_SECRET, CLIENT_ORIGIN, OFFER_MINUTES, PORT, ORGANIZER_INVITE_CODE` (optional). Client: `VITE_API_URL` (must end with `/api`). Keep `.env.example` files for both.
- Render's free tier sleeps. Mention the cold start in the README and hit `/api/health` before any demo. Correctness does not depend on the sweeper (see section 6).
- After pushing, wait until Render shows the new commit as Live before running anything against the deployed API.
- `scripts/seed.js` creates one demo organizer, several demo students, and one nearly-full published event. Demo credentials go in the README.

## 13. Build sessions (one at a time)

Each session ends with working, committed, deployed code and a way for the human to verify it.

**Session 1: Foundation.** Repo structure, config, User model, register/login/me with JWT and role middleware, zod validation, error handler, `/api/health`, all models and indexes created, `docs/decisions.md` started, deploy API and a blank client. *Done when:* register/login works against the deployed API and `/api/health` is live.

**Session 2: Events and registration.** Workflow 1 (event CRUD, publish) and Workflow 2 (register using `allocate`, `expireStaleOffers`, instant confirm via the `registering` flag and the per-event lock), plus the minimal UI to create an event and register. Write the invariant checker and tests 1, 2, 5, 10, 11. Write `scripts/loadtest.js`. *Done when:* the load test prints PASS locally 10 runs in a row.

**Session 3: Waitlist and offers.** Workflows 3 and 4: my registrations (position, countdown), cancel, decline, claim, `refreshEvent`, sweeper, reconciler (through `withLock`), notifications and bell. Tests 3, 4, 7, 12. *Done when:* a cancel in one browser produces an offer with a countdown in another, and an unclaimed offer cascades.

**Session 4: Organizer tools and hardening.** Workflow 5: attendee list, check-in, no-show, capacity changes (6.6), event cancel (6.9), audit log view. Tests 6, 8. Loading/empty/error states everywhere, rate limiting, helmet, CORS. *Done when:* every item in sections 10 and 11 passes.

**Session 5: Polish and docs.** Seed script, bug fixes, README (section 15), architecture diagram, `docs/decisions.md` finished, run the load test against the DEPLOYED API and save the output. Overbooking only if everything is green.

## 14. docs/decisions.md must record

Partial unique index (and the `isActive` fallback if used); one-at-a-time offers and the trade-off; safety vs liveness (guarded updates vs sweeper); expiry on read plus sweeper; reconciler design and its double check; no Redis and no Socket.io (why polling is enough); why `allocate` is the single allocation path; the `registering` flag and why it was needed; the per-event lock, its single-process assumption and its latency trade-off; post-deadline rule; re-join goes to the back of the queue; JWT in the Authorization header; known limitations.

## 15. README outline (match the brief exactly)

Project Name, Problem Statement, Target Users, Solution, Key Features, Tech Stack, Architecture (diagram, the allocation path, the state machine), Concurrency guarantees with the load-test output pasted in (include warm and cold timings), Local Setup, Environment Variables, Deployment (live link, demo credentials, cold-start note), Design decisions (link to `docs/decisions.md`), Testing (how to run tests and the load test), AI usage note, Known limitations (single API instance assumption; allocation serialized per event so one very hot event processes registrations in order; free-tier cold starts; polling instead of push).

---

# Human-only appendix (agent: ignore everything below)

## Calendar (deadline 27 Oct 2026, 11:59 PM IST)

| Day | Date | Goal |
|---|---|---|
| 1 | 21 Oct | Session 1 done, deployed. Session 2 done, load test PASS. |
| 2 | 22 Oct | Session 3 |
| 3 | 23 Oct | Session 4 |
| 4 | 24 Oct | Session 5, README, deployed load-test output |
| 5 | 25 Oct | Fix-up round, demo rehearsal, clean the Atlas database |
| 6 | 26 Oct | Record demo, test every link in an incognito window, submit the form |
| Buffer | 27 Oct | Submit by the evening, not at 11:50 PM |

## Demo script (about 4 minutes)

1. Problem in 20 seconds. 2. Organizer creates an event with 2 seats. 3. Two students register and are confirmed; a third is waitlisted (show position). 4. Run the 50-way load test and show PASS. 5. A confirmed student cancels; the waitlisted student sees an offer with a countdown in a second window. 6. Let an offer expire (set `OFFER_MINUTES=0.5` for the demo) and show it cascade to the next person. 7. Organizer checks in attendees and opens the audit log.

## You must be able to explain without reading code

- Why two users cannot take the last seat: the seat grab is one guarded atomic update, so only one request can succeed.
- Why the sweeper is not needed for safety: expired offers can never be claimed, and expiry also runs on reads.
- Why offers are one-at-a-time and what that trades off.
- What `allocate` does and why every path goes through it.
- Why the `registering` flag and the lock both exist (flag alone was not enough; the lock only gives instant-confirm, safety does not depend on it).

## Your own checks each session

Run the app yourself and click through the verification the agent describes. Restart the local server fresh (or use `npm run dev`) and confirm only one process listens on 5001 before every load test. Run the load test yourself (do not just read the agent's claim), and read the test code once to confirm the requests really are parallel. Mutation check: temporarily remove the `$expr` seat guard and confirm `npm test` fails, then restore it. Check `git log` for small meaningful commits, check that `.env` is not tracked, and open the deployed links in an incognito window.