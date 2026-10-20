const mongoose = require('mongoose');
const {
  User,
  Event,
  Registration,
  Notification,
  AuditLog,
} = require('../src/models');

describe('Models and Indexes verification', () => {
  let organizerId;
  let studentId;
  let eventId;

  beforeEach(async () => {
    // Ensure all indexes are built in mongodb-memory-server
    await User.init();
    await Event.init();
    await Registration.init();
    await Notification.init();
    await AuditLog.init();

    const organizer = await User.create({
      name: 'Organizer One',
      email: 'org1@example.com',
      passwordHash: 'hash123',
      role: 'organizer',
    });
    organizerId = organizer._id;

    const student = await User.create({
      name: 'Student One',
      email: 'stud1@example.com',
      passwordHash: 'hash123',
      role: 'student',
    });
    studentId = student._id;

    const event = await Event.create({
      organizerId,
      title: 'Tech Fest Keynote',
      description: 'Annual opening keynote',
      location: 'Auditorium A',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 100,
    });
    eventId = event._id;
  });

  it('should enforce unique index on User email', async () => {
    await expect(
      User.create({
        name: 'Another User',
        email: 'stud1@example.com',
        passwordHash: 'hash456',
        role: 'student',
      })
    ).rejects.toThrow();
  });

  it('should enforce partial unique index on Registration (blocks duplicate active registrations)', async () => {
    // Create first active registration
    await Registration.create({
      eventId,
      userId: studentId,
      status: 'WAITLISTED',
      seq: 1,
    });

    // Attempt duplicate active registration
    await expect(
      Registration.create({
        eventId,
        userId: studentId,
        status: 'CONFIRMED',
        seq: 2,
      })
    ).rejects.toThrow();
  });

  it('should allow new Registration after previous one is CANCELLED (partial unique index behavior)', async () => {
    // First registration cancelled
    const reg1 = await Registration.create({
      eventId,
      userId: studentId,
      status: 'CANCELLED',
      seq: 1,
      cancelledAt: new Date(),
    });
    expect(reg1.status).toBe('CANCELLED');

    // Second registration for same event and user is allowed because CANCELLED is not in partial index
    const reg2 = await Registration.create({
      eventId,
      userId: studentId,
      status: 'WAITLISTED',
      seq: 2,
    });
    expect(reg2.status).toBe('WAITLISTED');
  });

  it('should create Notification and AuditLog successfully', async () => {
    const notif = await Notification.create({
      userId: studentId,
      eventId,
      type: 'CONFIRMED',
      message: 'Your registration is confirmed!',
    });
    expect(notif.type).toBe('CONFIRMED');
    expect(notif.readAt).toBeNull();

    const audit = await AuditLog.create({
      eventId,
      actorId: organizerId,
      action: 'EVENT_CREATED',
      payload: { capacity: 100 },
    });
    expect(audit.action).toBe('EVENT_CREATED');
  });
});
