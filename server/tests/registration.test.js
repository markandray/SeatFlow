const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Registration = require('../src/models/Registration');
const env = require('../src/config/env');
const { checkInvariants } = require('./helpers/invariants');

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
});
