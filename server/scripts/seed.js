const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Registration = require('../src/models/Registration');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');
const eventService = require('../src/services/eventService');
const registrationService = require('../src/services/registrationService');
const { DEMO_PASSWORD, DEMO_USERS } = require('./demoAccounts');

async function assertSeedInvariants(eventId) {
  const event = await Event.findById(eventId);
  const heldSeats = await Registration.countDocuments({
    eventId,
    status: { $in: ['OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
  });
  const duplicates = await Registration.aggregate([
    { $match: { eventId, status: { $in: ['WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'] } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!event || event.heldSeats !== heldSeats || event.heldSeats > event.capacity || duplicates.length) {
    throw new Error(`Seed invariant failed for event ${eventId}`);
  }
  if (event.nextSeq !== await Registration.countDocuments({ eventId })) {
    throw new Error(`Seed sequence count mismatch for event ${eventId}`);
  }
}

async function assertDemoShape(eventId, expected) {
  const event = await Event.findById(eventId);
  const [confirmed, waitlisted] = await Promise.all([
    Registration.countDocuments({ eventId, status: 'CONFIRMED' }),
    Registration.countDocuments({ eventId, status: 'WAITLISTED' }),
  ]);
  if (
    !event ||
    event.status !== expected.status ||
    event.capacity !== expected.capacity ||
    confirmed !== expected.confirmed ||
    waitlisted !== expected.waitlisted
  ) {
    throw new Error(`Seed data shape failed for event ${event.title}`);
  }
}

async function createPublishedEvent(organizerId, title, capacity, daysUntilStart) {
  const startsAt = new Date(Date.now() + daysUntilStart * 86400000);
  const registrationDeadline = new Date(startsAt.getTime() - 86400000);
  const event = await eventService.createEvent(organizerId, {
    title,
    description: `Demo data for ${title}.`,
    location: 'SeatFlow Demo Hall',
    startsAt: startsAt.toISOString(),
    registrationDeadline: registrationDeadline.toISOString(),
    capacity,
  });
  await eventService.publishEvent(event._id, organizerId);
  return event;
}

async function runSeed() {
  try {
    await mongoose.connect(env.MONGO_URI);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const users = await Promise.all(
      DEMO_USERS.map(({ email, ...fields }) => User.findOneAndUpdate(
        { email },
        { $set: { ...fields, email, passwordHash } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
      ))
    );
    const organizer = users[0];
    const students = users.slice(1);

    const previousEvents = await Event.find({ organizerId: organizer._id, title: /^DEMO / }).select('_id');
    const previousIds = previousEvents.map((event) => event._id);
    if (previousIds.length) {
      await Promise.all([
        Registration.deleteMany({ eventId: { $in: previousIds } }),
        Notification.deleteMany({ eventId: { $in: previousIds } }),
        AuditLog.deleteMany({ eventId: { $in: previousIds } }),
      ]);
      await Event.deleteMany({ _id: { $in: previousIds } });
    }

    const nearlyFull = await createPublishedEvent(organizer._id, 'DEMO Nearly Full Workshop', 3, 7);
    await registrationService.register(nearlyFull._id, students[0]._id);
    await registrationService.register(nearlyFull._id, students[1]._id);

    const full = await createPublishedEvent(organizer._id, 'DEMO Full Workshop With Waitlist', 2, 10);
    for (const student of students) await registrationService.register(full._id, student._id);

    const open = await createPublishedEvent(organizer._id, 'DEMO Open Campus Event', 50, 14);
    const startsAt = new Date(Date.now() + 21 * 86400000);
    const draft = await eventService.createEvent(organizer._id, {
      title: 'DEMO Draft Planning Event',
      description: 'A draft demo event not visible in the public listing.',
      location: 'SeatFlow Demo Hall',
      startsAt: startsAt.toISOString(),
      registrationDeadline: new Date(startsAt.getTime() - 86400000).toISOString(),
      capacity: 20,
    });

    for (const event of [nearlyFull, full, open, draft]) await assertSeedInvariants(event._id);
    await assertDemoShape(nearlyFull._id, { status: 'PUBLISHED', capacity: 3, confirmed: 2, waitlisted: 0 });
    await assertDemoShape(full._id, { status: 'PUBLISHED', capacity: 2, confirmed: 2, waitlisted: 3 });
    await assertDemoShape(open._id, { status: 'PUBLISHED', capacity: 50, confirmed: 0, waitlisted: 0 });
    await assertDemoShape(draft._id, { status: 'DRAFT', capacity: 20, confirmed: 0, waitlisted: 0 });

    console.log('Demo data is ready.');
    console.log(`Organizer: ${DEMO_USERS[0].email}`);
    console.log(`Students: ${DEMO_USERS.slice(1).map((user) => user.email).join(', ')}`);
    console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
    console.log(`Events: ${[nearlyFull, full, open, draft].map((event) => event.title).join(' | ')}`);
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  runSeed().catch((error) => {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = runSeed;
