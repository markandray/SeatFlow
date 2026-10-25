const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Registration = require('../src/models/Registration');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');
const env = require('../src/config/env');
const registrationService = require('../src/services/registrationService');
const { checkInvariants } = require('./helpers/invariants');

const signToken = (user) => jwt.sign({ id: user._id.toString(), role: user.role }, env.JWT_SECRET);

describe('Organizer tools and Session 4 invariants', () => {
  let organizer;
  let otherOrganizer;
  let student;
  let organizerToken;
  let otherOrganizerToken;
  let studentToken;

  beforeEach(async () => {
    [organizer, otherOrganizer, student] = await User.insertMany([
      { name: 'Owner Organizer', email: 'owner_org@example.com', passwordHash: 'hash', role: 'organizer' },
      { name: 'Other Organizer', email: 'other_org@example.com', passwordHash: 'hash', role: 'organizer' },
      { name: 'Student', email: 'owner_student@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    organizerToken = signToken(organizer);
    otherOrganizerToken = signToken(otherOrganizer);
    studentToken = signToken(student);
  });

  const makeEvent = (overrides = {}) => Event.create({
    organizerId: organizer._id,
    title: 'Organizer Test Event',
    startsAt: new Date(Date.now() + 86400000),
    registrationDeadline: new Date(Date.now() + 43200000),
    capacity: 5,
    heldSeats: 0,
    nextSeq: 0,
    status: 'PUBLISHED',
    ...overrides,
  });

  it('Test 6: capacity reduction below held seats conflicts and an increase offers to the FIFO head', async () => {
    const event = await makeEvent({ capacity: 2, heldSeats: 2, nextSeq: 3 });
    const users = await User.insertMany([
      { name: 'Seat One', email: 'capacity_one@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Seat Two', email: 'capacity_two@example.com', passwordHash: 'hash', role: 'student' },
      { name: 'Queue Head', email: 'capacity_head@example.com', passwordHash: 'hash', role: 'student' },
    ]);
    await Registration.insertMany([
      { eventId: event._id, userId: users[0]._id, status: 'CONFIRMED', seq: 1, confirmedAt: new Date() },
      { eventId: event._id, userId: users[1]._id, status: 'CONFIRMED', seq: 2, confirmedAt: new Date() },
      { eventId: event._id, userId: users[2]._id, status: 'WAITLISTED', seq: 3, registering: false },
    ]);

    const rejected = await request(app)
      .patch(`/api/events/${event._id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ capacity: 1 });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.body.error.code).toBe('CAPACITY_TOO_LOW');

    const increased = await request(app)
      .patch(`/api/events/${event._id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ capacity: 3 });
    expect(increased.statusCode).toBe(200);
    expect((await Registration.findOne({ eventId: event._id, userId: users[2]._id })).status).toBe('OFFERED');
    expect((await Event.findById(event._id)).heldSeats).toBe(3);
    await checkInvariants(event._id);
  });

  it('GET /api/events/mine returns owned events in any status with registration counts', async () => {
    const event = await makeEvent({ capacity: 5, heldSeats: 3 });
    await Event.create({
      organizerId: organizer._id,
      title: 'Draft Count Event',
      startsAt: new Date(Date.now() + 2 * 86400000),
      registrationDeadline: new Date(Date.now() + 86400000),
      capacity: 1,
      status: 'DRAFT',
    });
    await Event.create({
      organizerId: organizer._id,
      title: 'Cancelled Count Event',
      startsAt: new Date(Date.now() + 3 * 86400000),
      registrationDeadline: new Date(Date.now() + 2 * 86400000),
      capacity: 1,
      status: 'CANCELLED',
    });
    const users = await User.insertMany(
      Array.from({ length: 4 }, (_, index) => ({
        name: `Count User ${index}`,
        email: `count_user_${index}@example.com`,
        passwordHash: 'hash',
        role: 'student',
      }))
    );
    await Registration.insertMany([
      { eventId: event._id, userId: users[0]._id, status: 'CONFIRMED', seq: 1, confirmedAt: new Date() },
      { eventId: event._id, userId: users[1]._id, status: 'CHECKED_IN', seq: 2, checkedInAt: new Date() },
      { eventId: event._id, userId: users[2]._id, status: 'WAITLISTED', seq: 3 },
      { eventId: event._id, userId: users[3]._id, status: 'OFFERED', seq: 4, offeredAt: new Date(), offerExpiresAt: new Date(Date.now() + 60000) },
    ]);

    const response = await request(app).get('/api/events/mine').set('Authorization', `Bearer ${organizerToken}`);
    expect(response.statusCode).toBe(200);
    expect(response.body.events).toHaveLength(3);
    const listed = response.body.events.find((item) => item._id === event._id.toString());
    expect(listed.counts).toEqual({ confirmed: 1, checkedIn: 1, waitlisted: 1, offered: 1 });
    expect(listed.seatsLeft).toBe(2);
    await checkInvariants(event._id);
  });

  it('attendee list refreshes offers and groups registrations with user identity', async () => {
    const event = await makeEvent({ heldSeats: 1 });
    const offered = await Registration.create({
      eventId: event._id,
      userId: student._id,
      status: 'OFFERED',
      seq: 1,
      offeredAt: new Date(Date.now() - 60000),
      offerExpiresAt: new Date(Date.now() - 1),
    });
    const next = await User.create({ name: 'FIFO Next', email: 'fifo_next@example.com', passwordHash: 'hash', role: 'student' });
    const waiting = await Registration.create({ eventId: event._id, userId: next._id, status: 'WAITLISTED', seq: 2 });

    const response = await request(app)
      .get(`/api/events/${event._id}/attendees`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(response.statusCode).toBe(200);
    expect(response.body.groups.EXPIRED[0].userId.email).toBe(student.email);
    expect(response.body.groups.OFFERED[0]._id).toBe(waiting._id.toString());
    expect(response.body.groups.OFFERED[0].userId.name).toBe(next.name);
    expect(response.body.counts).toMatchObject({ offered: 1, waitlisted: 0, seatsLeft: 4 });
    expect((await Registration.findById(offered._id)).status).toBe('EXPIRED');
    await checkInvariants(event._id);
  });

  it('check-in preserves heldSeats and does not change the waitlist', async () => {
    const event = await makeEvent({ heldSeats: 1 });
    const second = await User.create({ name: 'Second Student', email: 'second_no_show@example.com', passwordHash: 'hash', role: 'student' });
    const [confirmed, waiting] = await Registration.insertMany([
      { eventId: event._id, userId: student._id, status: 'CONFIRMED', seq: 1, confirmedAt: new Date() },
      { eventId: event._id, userId: second._id, status: 'WAITLISTED', seq: 2 },
    ]);
    const checked = await request(app)
      .post(`/api/registrations/${confirmed._id}/check-in`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(checked.statusCode).toBe(200);
    expect(checked.body.registration.status).toBe('CHECKED_IN');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);

    await Event.updateOne({ _id: event._id }, { startsAt: new Date(Date.now() - 1) });
    const noShow = await request(app)
      .post(`/api/registrations/${confirmed._id}/no-show`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(noShow.statusCode).toBe(409);
    expect(noShow.body.error.code).toBe('INVALID_STATUS');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    expect((await Registration.findById(waiting._id)).status).toBe('WAITLISTED');
    await checkInvariants(event._id);
  });

  it('no-show is rejected before the start and releases its seat after startsAt without allocation', async () => {
    const event = await makeEvent({ startsAt: new Date(Date.now() + 86400000), heldSeats: 1 });
    const next = await User.create({ name: 'No-show Queue', email: 'no_show_queue@example.com', passwordHash: 'hash', role: 'student' });
    const [confirmed, waiting] = await Registration.insertMany([
      { eventId: event._id, userId: student._id, status: 'CONFIRMED', seq: 1, confirmedAt: new Date() },
      { eventId: event._id, userId: next._id, status: 'WAITLISTED', seq: 2 },
    ]);
    const early = await request(app)
      .post(`/api/registrations/${confirmed._id}/no-show`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(early.statusCode).toBe(409);
    expect(early.body.error.code).toBe('NOT_STARTED');

    await Event.updateOne({ _id: event._id }, { startsAt: new Date(Date.now() - 1) });
    const marked = await request(app)
      .post(`/api/registrations/${confirmed._id}/no-show`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(marked.statusCode).toBe(200);
    expect(marked.body.registration.status).toBe('NO_SHOW');
    expect((await Event.findById(event._id)).heldSeats).toBe(0);
    expect((await Registration.findById(waiting._id)).status).toBe('WAITLISTED');
    expect(await AuditLog.countDocuments({ eventId: event._id, action: 'REGISTRATION_NO_SHOW' })).toBe(1);
    await checkInvariants(event._id);
  });

    it('no-show sent three times in parallel decrements heldSeats exactly once', async () => {
    const event = await makeEvent({ startsAt: new Date(Date.now() + 86400000), heldSeats: 1 });
    const confirmed = await Registration.create({
      eventId: event._id, userId: student._id, status: 'CONFIRMED', seq: 1, confirmedAt: new Date(),
    });
    await Event.updateOne({ _id: event._id }, { startsAt: new Date(Date.now() - 1) });

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app)
          .post(`/api/registrations/${confirmed._id}/no-show`)
          .set('Authorization', `Bearer ${organizerToken}`)
      )
    );

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect((await Registration.findById(confirmed._id)).status).toBe('NO_SHOW');
    expect((await Event.findById(event._id)).heldSeats).toBe(0);
    expect(await AuditLog.countDocuments({ eventId: event._id, action: 'REGISTRATION_NO_SHOW' })).toBe(1);
    await checkInvariants(event._id);
  });

  it('check-in sent three times in parallel succeeds once and leaves heldSeats unchanged', async () => {
    const event = await makeEvent({ heldSeats: 1 });
    const confirmed = await Registration.create({
      eventId: event._id, userId: student._id, status: 'CONFIRMED', seq: 1, confirmedAt: new Date(),
    });

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app)
          .post(`/api/registrations/${confirmed._id}/check-in`)
          .set('Authorization', `Bearer ${organizerToken}`)
      )
    );

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect((await Registration.findById(confirmed._id)).status).toBe('CHECKED_IN');
    expect((await Event.findById(event._id)).heldSeats).toBe(1);
    await checkInvariants(event._id);
  });

  it('Test 8: event cancellation clears active registrations, seats, sends notifications, and blocks allocation', async () => {
    const event = await makeEvent({ capacity: 4, heldSeats: 3 });
    const users = await User.insertMany(
      Array.from({ length: 4 }, (_, index) => ({
        name: `Cancel User ${index}`,
        email: `cancel_user_${index}@example.com`,
        passwordHash: 'hash',
        role: 'student',
      }))
    );
    await Registration.insertMany([
      { eventId: event._id, userId: users[0]._id, status: 'CONFIRMED', seq: 1, confirmedAt: new Date() },
      { eventId: event._id, userId: users[1]._id, status: 'OFFERED', seq: 2, offeredAt: new Date(), offerExpiresAt: new Date(Date.now() + 60000) },
      { eventId: event._id, userId: users[2]._id, status: 'WAITLISTED', seq: 3 },
      { eventId: event._id, userId: users[3]._id, status: 'CHECKED_IN', seq: 4, checkedInAt: new Date() },
    ]);

    const response = await request(app)
      .post(`/api/events/${event._id}/cancel`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(response.statusCode).toBe(200);
    expect(response.body.event.status).toBe('CANCELLED');
    expect((await Event.findById(event._id)).heldSeats).toBe(0);
    expect(await Registration.countDocuments({ eventId: event._id, status: 'CANCELLED' })).toBe(4);
    expect(await Notification.countDocuments({ eventId: event._id, type: 'EVENT_CANCELLED' })).toBe(4);
    expect(await AuditLog.countDocuments({ eventId: event._id, action: 'EVENT_CANCELLED' })).toBe(1);
    await registrationService.allocate(event._id);
    expect(await Registration.countDocuments({ eventId: event._id, status: 'OFFERED' })).toBe(0);
    const detail = await request(app).get(`/api/events/${event._id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.body.event.status).toBe('CANCELLED');
    await checkInvariants(event._id);
  });

  it('cancelled events reject edits, capacity changes, publishing, and repeat cancellation without side effects', async () => {
    const event = await makeEvent({ title: 'Read Only Event' });
    await Registration.create({ eventId: event._id, userId: student._id, status: 'WAITLISTED', seq: 1 });
    const firstCancel = await request(app)
      .post(`/api/events/${event._id}/cancel`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(firstCancel.statusCode).toBe(200);

    const auditCount = await AuditLog.countDocuments({ eventId: event._id, action: 'EVENT_CANCELLED' });
    const notificationCount = await Notification.countDocuments({ eventId: event._id, type: 'EVENT_CANCELLED' });
    expect(auditCount).toBe(1);
    expect(notificationCount).toBe(1);

    const attempts = [
      request(app).patch(`/api/events/${event._id}`).set('Authorization', `Bearer ${organizerToken}`).send({ title: 'Changed' }),
      request(app).patch(`/api/events/${event._id}`).set('Authorization', `Bearer ${organizerToken}`).send({ capacity: 9 }),
      request(app).post(`/api/events/${event._id}/publish`).set('Authorization', `Bearer ${organizerToken}`),
      request(app).post(`/api/events/${event._id}/cancel`).set('Authorization', `Bearer ${organizerToken}`),
    ];
    for (const attempt of attempts) {
      const response = await attempt;
      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe('EVENT_CANCELLED');
      expect(response.body.error.message).toBe('Cancelled events cannot be changed');
    }

    const unchanged = await Event.findById(event._id);
    expect(unchanged.title).toBe('Read Only Event');
    expect(unchanged.capacity).toBe(5);
    expect(unchanged.status).toBe('CANCELLED');
    expect(await AuditLog.countDocuments({ eventId: event._id, action: 'EVENT_CANCELLED' })).toBe(auditCount);
    expect(await Notification.countDocuments({ eventId: event._id, type: 'EVENT_CANCELLED' })).toBe(notificationCount);
    await checkInvariants(event._id);
  });

  it('another organizer receives 403 for all changes to a cancelled event', async () => {
    const event = await makeEvent({ status: 'CANCELLED' });
    const attempts = [
      request(app).patch(`/api/events/${event._id}`).set('Authorization', `Bearer ${otherOrganizerToken}`).send({ title: 'Changed' }),
      request(app).patch(`/api/events/${event._id}`).set('Authorization', `Bearer ${otherOrganizerToken}`).send({ capacity: 9 }),
      request(app).post(`/api/events/${event._id}/publish`).set('Authorization', `Bearer ${otherOrganizerToken}`),
      request(app).post(`/api/events/${event._id}/cancel`).set('Authorization', `Bearer ${otherOrganizerToken}`),
    ];
    for (const attempt of attempts) expect((await attempt).statusCode).toBe(403);
    expect((await Event.findById(event._id)).status).toBe('CANCELLED');
    await checkInvariants(event._id);
  });

  it('serializes event cancellation behind an in-flight allocation without leaving a held seat', async () => {
    const event = await makeEvent({ capacity: 1 });
    let signalHeadPop;
    let releaseHeadPop;
    const headPopEntered = new Promise((resolve) => { signalHeadPop = resolve; });
    const holdAllocation = new Promise((resolve) => { releaseHeadPop = resolve; });
    registrationService.setPreHeadPopHook(async () => {
      signalHeadPop();
      await holdAllocation;
    });
    const attendee = await User.create({ name: 'In-flight Student', email: 'in_flight_cancel@example.com', passwordHash: 'hash', role: 'student' });

    try {
      const registering = registrationService.register(event._id, attendee._id);
      await headPopEntered;
      const cancelling = registrationService.cancelEvent(event._id, organizer._id);
      releaseHeadPop();
      await Promise.all([registering, cancelling]);
    } finally {
      releaseHeadPop();
      registrationService.setPreHeadPopHook(null);
    }

    expect((await Event.findById(event._id)).status).toBe('CANCELLED');
    expect((await Event.findById(event._id)).heldSeats).toBe(0);
    expect(await Registration.countDocuments({ eventId: event._id, status: 'CANCELLED' })).toBe(1);
    await checkInvariants(event._id);
  });

  it('Test 8 ownership checks reject another organizer and a student on every organizer endpoint', async () => {
    const event = await makeEvent({ heldSeats: 1, startsAt: new Date(Date.now() - 1) });
    const confirmed = await Registration.create({
      eventId: event._id,
      userId: student._id,
      status: 'CONFIRMED',
      seq: 1,
      confirmedAt: new Date(),
    });
    const ownerDenied = [
      () => request(app).get(`/api/events/${event._id}/attendees`).set('Authorization', `Bearer ${otherOrganizerToken}`),
      () => request(app).post(`/api/registrations/${confirmed._id}/check-in`).set('Authorization', `Bearer ${otherOrganizerToken}`),
      () => request(app).post(`/api/registrations/${confirmed._id}/no-show`).set('Authorization', `Bearer ${otherOrganizerToken}`),
      () => request(app).post(`/api/events/${event._id}/cancel`).set('Authorization', `Bearer ${otherOrganizerToken}`),
      () => request(app).get(`/api/events/${event._id}/audit`).set('Authorization', `Bearer ${otherOrganizerToken}`),
      () => request(app).patch(`/api/events/${event._id}`).set('Authorization', `Bearer ${otherOrganizerToken}`).send({ capacity: 2 }),
    ];
    const studentDenied = [
      () => request(app).get(`/api/events/${event._id}/attendees`).set('Authorization', `Bearer ${studentToken}`),
      () => request(app).post(`/api/registrations/${confirmed._id}/check-in`).set('Authorization', `Bearer ${studentToken}`),
      () => request(app).post(`/api/registrations/${confirmed._id}/no-show`).set('Authorization', `Bearer ${studentToken}`),
      () => request(app).post(`/api/events/${event._id}/cancel`).set('Authorization', `Bearer ${studentToken}`),
      () => request(app).get(`/api/events/${event._id}/audit`).set('Authorization', `Bearer ${studentToken}`),
      () => request(app).patch(`/api/events/${event._id}`).set('Authorization', `Bearer ${studentToken}`).send({ capacity: 2 }),
    ];
    for (const call of ownerDenied) expect((await call()).statusCode).toBe(403);
    for (const call of studentDenied) expect((await call()).statusCode).toBe(403);
    await checkInvariants(event._id);
  });

  it('audit log is newest-first and paginated with validated page and limit', async () => {
    const event = await makeEvent();
    await AuditLog.insertMany([
      { eventId: event._id, actorId: organizer._id, action: 'OLDER', createdAt: new Date('2026-01-01T00:00:00Z') },
      { eventId: event._id, actorId: organizer._id, action: 'NEWER', createdAt: new Date('2026-01-02T00:00:00Z') },
    ]);
    const response = await request(app)
      .get(`/api/events/${event._id}/audit?page=1&limit=1`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(response.statusCode).toBe(200);
    expect(response.body.logs).toHaveLength(1);
    expect(response.body.logs[0].action).toBe('NEWER');
    expect(response.body.total).toBe(2);
    expect(response.body.totalPages).toBe(2);
    const invalid = await request(app)
      .get(`/api/events/${event._id}/audit?page=0&limit=101`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(invalid.statusCode).toBe(400);
    await checkInvariants(event._id);
  });

  it('public event list exposes only future PUBLISHED events, while detail reads cancelled events', async () => {
    const visible = await makeEvent();
    await Event.create({
      organizerId: organizer._id,
      title: 'Draft Hidden',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      status: 'DRAFT',
    });
    await makeEvent({ title: 'Cancelled Hidden', status: 'CANCELLED' });
    await makeEvent({ title: 'Past Hidden', startsAt: new Date(Date.now() - 86400000) });
    const list = await request(app).get('/api/events');
    expect(list.statusCode).toBe(200);
    expect(list.body.events.map((event) => event._id)).toEqual([visible._id.toString()]);
    const detail = await request(app).get(`/api/events/${visible._id}`);
    expect(detail.statusCode).toBe(200);
    const unsupportedStatus = await request(app).get('/api/events?status=DRAFT');
    expect(unsupportedStatus.statusCode).toBe(400);
    await checkInvariants(visible._id);
  });
});
