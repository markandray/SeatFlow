const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Registration = require('../src/models/Registration');
const AuditLog = require('../src/models/AuditLog');
const env = require('../src/config/env');
const { checkInvariants } = require('./helpers/invariants');
const {
  setPreHeadPopHook,
  allocateUnlocked,
  refreshEvent,
  reconcileEvent,
} = require('../src/services/registrationService');

describe('Registration & Concurrency Invariants (Workflow 2)', () => {
  let organizer;
  let organizerToken;

  const signToken = (user) => {
    return jwt.sign(
      { id: user._id.toString(), role: user.role },
      env.JWT_SECRET,
      { expiresIn: '1d' }
    );
  };

  beforeEach(async () => {
    organizer = await User.create({
      name: 'Organizer Test',
      email: 'org_test@example.com',
      passwordHash: 'hash',
      role: 'organizer',
    });
    organizerToken = signToken(organizer);
  });

  /**
   * TEST 1: Last-seat race
   * Event with capacity 1; 20 parallel register requests from 20 users.
   * Exactly one CONFIRMED, 19 WAITLISTED, heldSeats == 1.
   */
  it('Test 1: Last-seat race (capacity 1, 20 parallel requests -> 1 CONFIRMED, 19 WAITLISTED, heldSeats == 1)', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'High-Demand Workshop',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 0,
      nextSeq: 0,
      status: 'PUBLISHED',
    });

    // Create 20 distinct users directly in DB and generate tokens
    const userDocs = [];
    for (let i = 0; i < 20; i++) {
      userDocs.push({
        name: `Student ${i}`,
        email: `student_${i}@example.com`,
        passwordHash: 'hash',
        role: 'student',
      });
    }
    const createdUsers = await User.insertMany(userDocs);
    const tokens = createdUsers.map((u) => signToken(u));

    // Fire 20 parallel register requests with Promise.all
    const responses = await Promise.all(
      tokens.map((token) =>
        request(app)
          .post(`/api/events/${event._id}/register`)
          .set('Authorization', `Bearer ${token}`)
      )
    );

    // All requests should return 201
    for (const res of responses) {
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('registration');
    }

    // Inspect registrations in DB
    const registrations = await Registration.find({ eventId: event._id });
    expect(registrations.length).toBe(20);

    const confirmed = registrations.filter((r) => r.status === 'CONFIRMED');
    const waitlisted = registrations.filter((r) => r.status === 'WAITLISTED');

    expect(confirmed.length).toBe(1);
    expect(waitlisted.length).toBe(19);

    const reloadedEvent = await Event.findById(event._id);
    expect(reloadedEvent.heldSeats).toBe(1);

    // Verify seq numbers are distinct and sequential from 1 to 20
    const seqs = registrations.map((r) => r.seq).sort((a, b) => a - b);
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(20);

    // Recompute invariants
    await checkInvariants(event._id);
  });

  /**
   * TEST 2: Double-click
   * The same user registers twice in parallel.
   * Exactly one active registration; the other request gets 409.
   */
  it('Test 2: Double-click race (same user registers twice in parallel -> 1 active, 1 gets 409)', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Double Click Event',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 5,
      heldSeats: 0,
      nextSeq: 0,
      status: 'PUBLISHED',
    });

    const user = await User.create({
      name: 'Double Clicker',
      email: 'clicker@example.com',
      passwordHash: 'hash',
      role: 'student',
    });
    const token = signToken(user);

    // Fire 2 parallel register requests from the same user
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/events/${event._id}/register`)
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .post(`/api/events/${event._id}/register`)
        .set('Authorization', `Bearer ${token}`),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const errRes = res1.statusCode === 409 ? res1 : res2;
    expect(errRes.body.error.code).toBe('ALREADY_REGISTERED');

    const activeRegs = await Registration.find({
      eventId: event._id,
      userId: user._id,
      status: { $in: ['WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
    });
    expect(activeRegs.length).toBe(1);

    await checkInvariants(event._id);
  });

  /**
   * TEST 5: Cancel from WAITLISTED frees no seat
   * User 1 is CONFIRMED (holding the only seat).
   * User 2 is WAITLISTED.
   * User 2 cancels registration -> status becomes CANCELLED, heldSeats remains 1.
   */
  it('Test 5: Cancel from WAITLISTED frees no seat (heldSeats unchanged)', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Waitlist Cancel Event',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 0,
      nextSeq: 0,
      status: 'PUBLISHED',
    });

    const user1 = await User.create({
      name: 'Student 1',
      email: 's1@example.com',
      passwordHash: 'hash',
      role: 'student',
    });
    const token1 = signToken(user1);

    const user2 = await User.create({
      name: 'Student 2',
      email: 's2@example.com',
      passwordHash: 'hash',
      role: 'student',
    });
    const token2 = signToken(user2);

    // User 1 registers and gets CONFIRMED
    const regRes1 = await request(app)
      .post(`/api/events/${event._id}/register`)
      .set('Authorization', `Bearer ${token1}`);
    expect(regRes1.statusCode).toBe(201);
    expect(regRes1.body.registration.status).toBe('CONFIRMED');

    // Event heldSeats is now 1
    let reloaded = await Event.findById(event._id);
    expect(reloaded.heldSeats).toBe(1);

    // User 2 registers and gets WAITLISTED
    const regRes2 = await request(app)
      .post(`/api/events/${event._id}/register`)
      .set('Authorization', `Bearer ${token2}`);
    expect(regRes2.statusCode).toBe(201);
    expect(regRes2.body.registration.status).toBe('WAITLISTED');
    expect(regRes2.body.position).toBe(1);

    // Event heldSeats is STILL 1
    reloaded = await Event.findById(event._id);
    expect(reloaded.heldSeats).toBe(1);

    // User 2 cancels their registration
    const cancelRes = await request(app)
      .post(`/api/registrations/${regRes2.body.registration._id}/cancel`)
      .set('Authorization', `Bearer ${token2}`);
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.body.registration.status).toBe('CANCELLED');

    // Crucial check: heldSeats is still 1! Cancelling from WAITLISTED frees no seat.
    reloaded = await Event.findById(event._id);
    expect(reloaded.heldSeats).toBe(1);

    await checkInvariants(event._id);
  });

  it('GET /api/registrations/mine returns list of registrations with positions', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'My Regs Event',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 10,
      heldSeats: 0,
      nextSeq: 0,
      status: 'PUBLISHED',
    });

    const user = await User.create({
      name: 'Registered Student',
      email: 'reg_student@example.com',
      passwordHash: 'hash',
      role: 'student',
    });
    const token = signToken(user);

    await request(app)
      .post(`/api/events/${event._id}/register`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .get('/api/registrations/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.registrations)).toBe(true);
    expect(res.body.registrations.length).toBe(1);
    expect(res.body.registrations[0].status).toBe('CONFIRMED');
    expect(res.body).toHaveProperty('serverTime');

    await checkInvariants(event._id);
  });

  /** Test 10: run both with and without the pre-head-pop hook. */
  it('Test 10: confirms capacity seats in ten 50-request runs, with and without the pre-head-pop hook', async () => {
    const capacity = 10;
    let runId = 0;

    try {
      for (const hookEnabled of [false, true]) {
        setPreHeadPopHook(
          hookEnabled ? () => new Promise((resolve) => setImmediate(resolve)) : null
        );
        for (let repetition = 0; repetition < 10; repetition++, runId++) {
          const event = await Event.create({
            organizerId: organizer._id,
            title: `Stress Event ${runId}`,
            startsAt: new Date(Date.now() + 86400000),
            registrationDeadline: new Date(Date.now() + 43200000),
            capacity,
            heldSeats: 0,
            nextSeq: 0,
            status: 'PUBLISHED',
          });

          const runKey = `${Date.now()}_${runId}`;
          const createdUsers = await User.insertMany(
            Array.from({ length: 50 }, (_, i) => ({
              name: `User ${runId}_${i}`,
              email: `stress_${runKey}_${i}@example.com`,
              passwordHash: 'hash',
              role: 'student',
            }))
          );

          const responses = await Promise.all(
            createdUsers.map((user) =>
              request(app)
                .post(`/api/events/${event._id}/register`)
                .set('Authorization', `Bearer ${signToken(user)}`)
            )
          );
          expect(responses.every((res) => res.statusCode === 201)).toBe(true);

          const registrations = await Registration.find({ eventId: event._id });
          const confirmed = registrations.filter((reg) => reg.status === 'CONFIRMED');
          const reloadedEvent = await Event.findById(event._id);
          expect(confirmed.length).toBe(capacity);
          expect(reloadedEvent.heldSeats).toBe(capacity);
          await checkInvariants(event._id);
        }
      }
    } finally {
      setPreHeadPopHook(null);
    }
  }, 120000);

  it('Test 11: allocation remains safe with 20 unlocked allocators racing', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Unlocked Allocation Safety',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 5,
      heldSeats: 0,
      nextSeq: 30,
      status: 'PUBLISHED',
    });

    const users = await User.insertMany(
      Array.from({ length: 30 }, (_, i) => ({
        name: `Unlocked Student ${i}`,
        email: `unlocked_${Date.now()}_${i}@example.com`,
        passwordHash: 'hash',
        role: 'student',
      }))
    );
    await Registration.insertMany(
      users.map((user, i) => ({
        eventId: event._id,
        userId: user._id,
        status: 'WAITLISTED',
        seq: i + 1,
        registering: false,
      }))
    );

    await Promise.all(Array.from({ length: 20 }, () => allocateUnlocked(event._id)));

    const updatedEvent = await Event.findById(event._id);
    const registrations = await Registration.find({ eventId: event._id });
    const held = registrations.filter((reg) => ['OFFERED', 'CONFIRMED'].includes(reg.status));
    expect(updatedEvent.heldSeats).toBe(5);
    expect(held).toHaveLength(5);
    expect(new Set(held.map((reg) => reg.userId.toString())).size).toBe(held.length);
    await checkInvariants(event._id);
  });

  it('Test 3: claim racing expiry has one guarded outcome and keeps the seat count correct', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Claim Expiry Race',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const [offeree, waiter] = await User.insertMany([
      { name: 'Offeree', email: 'offeree@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Waiter', email: 'waiter@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    const offered = await Registration.create({
      eventId: event._id,
      userId: offeree._id,
      status: 'OFFERED',
      seq: 1,
      offeredAt: new Date(Date.now() - 60000),
      offerExpiresAt: new Date(Date.now() - 1),
    });
    await Registration.create({
      eventId: event._id,
      userId: waiter._id,
      status: 'WAITLISTED',
      seq: 2,
      registering: false,
    });

    const [claimResponse] = await Promise.all([
      request(app)
        .post(`/api/registrations/${offered._id}/claim`)
        .set('Authorization', `Bearer ${signToken(offeree)}`),
      refreshEvent(event._id),
    ]);

    expect(claimResponse.statusCode).toBe(410);
    expect((await Registration.findById(offered._id)).status).toBe('EXPIRED');
    expect((await Registration.findOne({ eventId: event._id, userId: waiter._id })).status).toBe('OFFERED');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });

  it('Test 4: cancel and offer expiry cascade to the next waitlisted registration', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Offer Cascade',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const users = await User.insertMany(
      Array.from({ length: 3 }, (_, i) => ({
        name: `Cascade ${i}`,
        email: `cascade_${i}@example.com`,
        passwordHash: 'hash',
        role: 'student',
      }))
    );
    const confirmed = await Registration.create({
      eventId: event._id,
      userId: users[0]._id,
      status: 'CONFIRMED',
      seq: 1,
      confirmedAt: new Date(),
    });
    const [first, second] = await Registration.insertMany([
      { eventId: event._id, userId: users[1]._id, status: 'WAITLISTED', seq: 2, registering: false },
      { eventId: event._id, userId: users[2]._id, status: 'WAITLISTED', seq: 3, registering: false },
    ]);

    const cancelResponse = await request(app)
      .post(`/api/registrations/${confirmed._id}/cancel`)
      .set('Authorization', `Bearer ${signToken(users[0])}`);
    expect(cancelResponse.statusCode).toBe(200);
    expect((await Registration.findById(first._id)).status).toBe('OFFERED');

    await Registration.updateOne({ _id: first._id }, { offerExpiresAt: new Date(Date.now() - 1) });
    await refreshEvent(event._id);
    expect((await Registration.findById(first._id)).status).toBe('EXPIRED');
    expect((await Registration.findById(second._id)).status).toBe('OFFERED');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });

  it('Test 7: GET event lazily expires stale offers and reallocates the seat', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Lazy Expiry',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const [offeree, waiter] = await User.insertMany([
      { name: 'Lazy Offeree', email: 'lazy_offeree@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Lazy Waiter', email: 'lazy_waiter@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    const stale = await Registration.create({
      eventId: event._id,
      userId: offeree._id,
      status: 'OFFERED',
      seq: 1,
      offeredAt: new Date(Date.now() - 60000),
      offerExpiresAt: new Date(Date.now() - 1),
    });
    const next = await Registration.create({
      eventId: event._id,
      userId: waiter._id,
      status: 'WAITLISTED',
      seq: 2,
      registering: false,
    });

    const response = await request(app).get(`/api/events/${event._id}`);
    expect(response.statusCode).toBe(200);
    expect((await Registration.findById(stale._id)).status).toBe('EXPIRED');
    expect((await Registration.findById(next._id)).status).toBe('OFFERED');
    await checkInvariants(event._id);
  });

  it('Test 12: reconciler corrects stable drift, leaves matching counters, and skips transient counts', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Reconciler Stable Drift',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 3,
      heldSeats: 0,
      status: 'PUBLISHED',
    });
    const users = await User.insertMany([
      { name: 'Held One', email: 'held_one@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Held Two', email: 'held_two@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    await Registration.create({
      eventId: event._id,
      userId: users[0]._id,
      status: 'CONFIRMED',
      seq: 1,
      confirmedAt: new Date(),
    });

    expect(await reconcileEvent(event._id, { recheckMs: 0 })).toBe(true);
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    const auditCount = await AuditLog.countDocuments({ eventId: event._id, action: 'RECONCILED' });
    expect(await reconcileEvent(event._id, { recheckMs: 0 })).toBe(false);
    expect(await AuditLog.countDocuments({ eventId: event._id, action: 'RECONCILED' })).toBe(auditCount);

    const transientEvent = await Event.create({
      organizerId: organizer._id,
      title: 'Reconciler Transient Mismatch',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 3,
      heldSeats: 0,
      status: 'PUBLISHED',
    });
    expect(
      await reconcileEvent(transientEvent._id, {
        recheckMs: 0,
        afterFirstCount: async () => {
          await Registration.create({
            eventId: transientEvent._id,
            userId: users[1]._id,
            status: 'CONFIRMED',
            seq: 1,
            confirmedAt: new Date(),
          });
        },
      })
    ).toBe(false);
    expect((await Event.findById(transientEvent._id)).heldSeats).toBe(0);
    expect(await AuditLog.countDocuments({ eventId: transientEvent._id, action: 'RECONCILED' })).toBe(0);
  });

  it('Part A: declining an offer gives the seat to the next waitlisted person', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Decline Cascade',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const users = await User.insertMany([
      { name: 'Offer Holder', email: 'decline_holder@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Next in Line', email: 'decline_next@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    const offer = await Registration.create({
      eventId: event._id,
      userId: users[0]._id,
      status: 'OFFERED',
      seq: 1,
      offeredAt: new Date(),
      offerExpiresAt: new Date(Date.now() + 60000),
    });
    const waiting = await Registration.create({
      eventId: event._id,
      userId: users[1]._id,
      status: 'WAITLISTED',
      seq: 2,
      registering: false,
    });

    const response = await request(app)
      .post(`/api/registrations/${offer._id}/decline`)
      .set('Authorization', `Bearer ${signToken(users[0])}`);
    expect(response.statusCode).toBe(200);
    expect((await Registration.findById(offer._id)).status).toBe('CANCELLED');
    expect((await Registration.findById(waiting._id)).status).toBe('OFFERED');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });

  it('Part A: a second claim returns 410 after the first claim wins', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Double Claim',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const user = await User.create({ name: 'Claim Student', email: 'double_claim@example.com', passwordHash: 'hash', role: 'student' });
    const offer = await Registration.create({
      eventId: event._id,
      userId: user._id,
      status: 'OFFERED',
      seq: 1,
      offeredAt: new Date(),
      offerExpiresAt: new Date(Date.now() + 60000),
    });
    const token = signToken(user);

    const first = await request(app).post(`/api/registrations/${offer._id}/claim`).set('Authorization', `Bearer ${token}`);
    const second = await request(app).post(`/api/registrations/${offer._id}/claim`).set('Authorization', `Bearer ${token}`);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(410);
    expect((await Registration.findById(offer._id)).status).toBe('CONFIRMED');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });

  it('Part A: another user cannot claim an offer and state is unchanged', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Foreign Claim',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const users = await User.insertMany([
      { name: 'Owner', email: 'foreign_owner@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Other', email: 'foreign_other@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    const offer = await Registration.create({
      eventId: event._id,
      userId: users[0]._id,
      status: 'OFFERED',
      seq: 1,
      offeredAt: new Date(),
      offerExpiresAt: new Date(Date.now() + 60000),
    });

    const response = await request(app)
      .post(`/api/registrations/${offer._id}/claim`)
      .set('Authorization', `Bearer ${signToken(users[1])}`);
    expect([403, 410]).toContain(response.statusCode);
    expect((await Registration.findById(offer._id)).status).toBe('OFFERED');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });

  it('Part A: an expired offer cannot be claimed', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Expired Claim',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const user = await User.create({ name: 'Expired Student', email: 'expired_claim@example.com', passwordHash: 'hash', role: 'student' });
    const offer = await Registration.create({
      eventId: event._id,
      userId: user._id,
      status: 'OFFERED',
      seq: 1,
      offeredAt: new Date(Date.now() - 60000),
      offerExpiresAt: new Date(Date.now() - 1),
    });

    const response = await request(app)
      .post(`/api/registrations/${offer._id}/claim`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(response.statusCode).toBe(410);
    expect((await Registration.findById(offer._id)).status).toBe('OFFERED');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });

  it('Part A: cancelling a confirmed registration offers its seat to the waitlist head', async () => {
    const event = await Event.create({
      organizerId: organizer._id,
      title: 'Confirmed Cancellation',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      heldSeats: 1,
      status: 'PUBLISHED',
    });
    const users = await User.insertMany([
      { name: 'Confirmed', email: 'confirmed_cancel@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Waitlisted', email: 'confirmed_cancel_wait@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    const confirmed = await Registration.create({
      eventId: event._id,
      userId: users[0]._id,
      status: 'CONFIRMED',
      seq: 1,
      confirmedAt: new Date(),
    });
    const waiting = await Registration.create({
      eventId: event._id,
      userId: users[1]._id,
      status: 'WAITLISTED',
      seq: 2,
      registering: false,
    });

    const response = await request(app)
      .post(`/api/registrations/${confirmed._id}/cancel`)
      .set('Authorization', `Bearer ${signToken(users[0])}`);
    expect(response.statusCode).toBe(200);
    expect((await Registration.findById(confirmed._id)).status).toBe('CANCELLED');
    expect((await Registration.findById(waiting._id)).status).toBe('OFFERED');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });
});
