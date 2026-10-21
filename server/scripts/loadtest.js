const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Registration = require('../src/models/Registration');

const API_URL = process.env.API_URL || 'http://localhost:5001/api';
const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI;

const logBuffer = [];
function log(msg = '') {
  console.log(msg);
  logBuffer.push(msg);
}

const signToken = (user) => {
  return jwt.sign(
    { id: user._id.toString(), role: user.role },
    env.JWT_SECRET,
    { expiresIn: '1d' }
  );
};

async function checkInvariants(eventId) {
  const event = await Event.findById(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);

  const heldCount = await Registration.countDocuments({
    eventId,
    status: { $in: ['OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
  });

  if (event.heldSeats !== heldCount) {
    throw new Error(`Invariant 1 violated: heldSeats (${event.heldSeats}) != count (${heldCount})`);
  }

  if (event.heldSeats > event.capacity) {
    throw new Error(`Invariant 2 violated: heldSeats (${event.heldSeats}) > capacity (${event.capacity})`);
  }

  const activeRegs = await Registration.find({
    eventId,
    status: { $in: ['WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
  });
  const seenUsers = new Set();
  for (const reg of activeRegs) {
    const uid = reg.userId.toString();
    if (seenUsers.has(uid)) {
      throw new Error(`Invariant 3 violated: duplicate active registration for user ${uid}`);
    }
    seenUsers.add(uid);
  }

  const offered = await Registration.find({ eventId, offeredAt: { $ne: null } });
  for (const reg of offered) {
    if (reg.offeredAt.getTime() > event.startsAt.getTime()) {
      throw new Error('Invariant 6 violated: offeredAt > startsAt');
    }
    if (reg.offerExpiresAt && reg.offerExpiresAt.getTime() > event.startsAt.getTime()) {
      throw new Error('Invariant 6 violated: offerExpiresAt > startsAt');
    }
  }

  return true;
}

async function runLoadTest() {
  log('====================================================');
  log('            SeatFlow Concurrency Load Test          ');
  log('====================================================');
  log(`Timestamp: ${new Date().toISOString()}`);
  log(`Target API URL: ${API_URL}`);
  log(`Connecting to MongoDB...`);

  await mongoose.connect(MONGO_URI);
  log('Connected to MongoDB.\n');

  let allPassed = true;

  try {
    // ----------------------------------------------------
    // Scenario 1: 50 Parallel Registrations for Capacity 10
    // ----------------------------------------------------
    log('----------------------------------------------------');
    log('Scenario 1: 50 parallel registrations for 10 seats');
    log('----------------------------------------------------');

    const organizer = await User.create({
      name: 'LoadTest Organizer',
      email: `lt_org_${Date.now()}@test.com`,
      passwordHash: 'hash',
      role: 'organizer',
    });

    const event = await Event.create({
      organizerId: organizer._id,
      title: `Load Test Event ${Date.now()}`,
      description: 'Concurrency stress testing',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 10,
      heldSeats: 0,
      nextSeq: 0,
      status: 'PUBLISHED',
    });
    log(`Seeded Event: ${event._id} (Capacity: 10, HeldSeats: 0)`);

    // Insert 50 users directly in DB
    const usersData = [];
    const runId = Date.now();
    for (let i = 0; i < 50; i++) {
      usersData.push({
        name: `LoadUser_${i}`,
        email: `loaduser_${runId}_${i}@test.com`,
        passwordHash: 'hash',
        role: 'student',
      });
    }
    const createdUsers = await User.insertMany(usersData);
    log(`Created 50 test users directly in DB.`);

    const tokens = createdUsers.map((u) => signToken(u));

    log(`Firing 50 parallel POST ${API_URL}/events/${event._id}/register ...`);
    const startTime = Date.now();

    const responses = await Promise.all(
      tokens.map(async (token) => {
        const res = await fetch(`${API_URL}/events/${event._id}/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      })
    );

    const durationMs = Date.now() - startTime;
    log(`Completed 50 parallel requests in ${durationMs}ms.\n`);

    // Verify responses
    const statusCodes = responses.map((r) => r.status);
    const successCount = statusCodes.filter((s) => s === 201).length;
    log(`HTTP Responses: ${successCount}/50 returned 201 Created.`);

    // DB Assertions
    const registrations = await Registration.find({ eventId: event._id });
    const confirmedCount = registrations.filter((r) => r.status === 'CONFIRMED').length;
    const waitlistedCount = registrations.filter((r) => r.status === 'WAITLISTED').length;
    const reloadedEvent = await Event.findById(event._id);

    const seqs = registrations.map((r) => r.seq);
    const uniqueSeqs = new Set(seqs);

    log(`Assertions:`);
    log(`- Total registrations in DB: ${registrations.length} (expected 50)`);
    log(`- Confirmed count: ${confirmedCount} (expected 10)`);
    log(`- Waitlisted count: ${waitlistedCount} (expected 40)`);
    log(`- Held seats: ${reloadedEvent.heldSeats} (expected 10)`);
    log(`- Unique sequence numbers: ${uniqueSeqs.size}/50 (no duplicate seq)`);

    await checkInvariants(event._id);
    log(`- Invariants 1, 2, 3, 6 verified successfully.`);

    const scenario1Passed =
      registrations.length === 50 &&
      confirmedCount === 10 &&
      waitlistedCount === 40 &&
      reloadedEvent.heldSeats === 10 &&
      uniqueSeqs.size === 50;

    if (scenario1Passed) {
      log('>>> Scenario 1: PASS\n');
    } else {
      log('>>> Scenario 1: FAIL\n');
      allPassed = false;
    }

    // ----------------------------------------------------
    // Scenario 2: 20 Parallel Requests from ONE User
    // ----------------------------------------------------
    log('----------------------------------------------------');
    log('Scenario 2: 20 parallel requests from ONE user');
    log('----------------------------------------------------');

    const singleUser = await User.create({
      name: 'Single User DoubleClick',
      email: `single_${runId}@test.com`,
      passwordHash: 'hash',
      role: 'student',
    });
    const singleToken = signToken(singleUser);

    const event2 = await Event.create({
      organizerId: organizer._id,
      title: `Single User Event ${Date.now()}`,
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 5,
      heldSeats: 0,
      nextSeq: 0,
      status: 'PUBLISHED',
    });

    log(`Firing 20 parallel register requests for user ${singleUser._id}...`);
    const responses2 = await Promise.all(
      Array(20)
        .fill(null)
        .map(async () => {
          const res = await fetch(`${API_URL}/events/${event2._id}/register`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${singleToken}`,
            },
          });
          const body = await res.json().catch(() => ({}));
          return { status: res.status, body };
        })
    );

    const s201 = responses2.filter((r) => r.status === 201).length;
    const s409 = responses2.filter((r) => r.status === 409).length;

    const userRegistrations = await Registration.find({
      eventId: event2._id,
      userId: singleUser._id,
    });

    log(`HTTP Responses: ${s201} created (201), ${s409} conflicts (409)`);
    log(`Registrations in DB for user: ${userRegistrations.length} (expected exactly 1)`);

    await checkInvariants(event2._id);
    log(`- Invariants 1, 2, 3, 6 verified successfully.`);

    const scenario2Passed = s201 === 1 && s409 === 19 && userRegistrations.length === 1;

    if (scenario2Passed) {
      log('>>> Scenario 2: PASS\n');
    } else {
      log('>>> Scenario 2: FAIL\n');
      allPassed = false;
    }
  } catch (err) {
    log(`\nERROR during load test: ${err.message}`);
    log(err.stack);
    allPassed = false;
  } finally {
    await mongoose.disconnect();
    log('Disconnected from MongoDB.');
  }

  log('====================================================');
  log(`OVERALL RESULT: ${allPassed ? 'PASS' : 'FAIL'}`);
  log('====================================================');

  const outputPath = path.join(__dirname, '../../docs/loadtest-output.txt');
  fs.writeFileSync(outputPath, logBuffer.join('\n') + '\n', 'utf8');
  console.log(`Output saved to ${outputPath}`);

  if (!allPassed) {
    process.exit(1);
  }
}

if (require.main === module) {
  runLoadTest();
}

module.exports = runLoadTest;
