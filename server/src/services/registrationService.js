const Event = require('../models/Event');
const Registration = require('../models/Registration');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { withLock } = require('../utils/keyedMutex');
const env = require('../config/env');

/**
 * 6.1 expireStaleOffers(eventId)
 * Releases offers whose time ran out. Does not allocate (the caller does).
 */
async function expireStaleOffers(eventId) {
  const now = new Date();
  const stale = await Registration.find({
    eventId,
    status: 'OFFERED',
    offerExpiresAt: { $lt: now },
  });

  let expired = 0;
  for (const r of stale) {
    const won = await Registration.findOneAndUpdate(
      { _id: r._id, status: 'OFFERED', offerExpiresAt: { $lt: now } },
      { status: 'EXPIRED' },
      { new: true }
    );
    if (won) {
      await Event.updateOne({ _id: eventId }, { $inc: { heldSeats: -1 } });
      await AuditLog.create({
        eventId,
        actorId: null, // system
        action: 'OFFER_EXPIRED',
        registrationId: r._id,
        payload: { userId: r.userId },
      });
      await Notification.create({
        userId: r.userId,
        eventId,
        type: 'OFFER_EXPIRED',
        message: 'Your registration offer has expired.',
      });
      expired++;
    }
  }
  return expired;
}

// Hook for testing race conditions: optional hook between seat grab and head pop
let preHeadPopHook = null;
function setPreHeadPopHook(fn) {
  preHeadPopHook = fn;
}

/**
 * 6.2 allocateUnlocked(eventId)
 * The raw allocation logic. SAFETY comes from the guarded atomic updates
 * below (seat grab guarded by heldSeats < capacity, head-pop guarded by
 * status WAITLISTED). It is safe to call concurrently; the per-event lock in
 * allocate() only makes instant-confirm deterministic, it is not needed for
 * correctness. Exported for the safety test.
 */
async function allocateUnlocked(eventId) {
  await expireStaleOffers(eventId);
  const granted = [];

  while (true) {
    const now = new Date();

    // 1. grab a seat atomically (also refuses if event unpublished/cancelled or already started)
    const ev = await Event.findOneAndUpdate(
      {
        _id: eventId,
        status: 'PUBLISHED',
        startsAt: { $gt: now },
        $expr: { $lt: ['$heldSeats', '$capacity'] },
      },
      { $inc: { heldSeats: 1 } },
      { new: true }
    );

    if (!ev) break; // full, or event not open

    if (preHeadPopHook) {
      await preHeadPopHook(eventId);
    }

    // 2. take the head of the waitlist atomically with update pipeline
    const expiresAt = new Date(
      Math.min(now.getTime() + env.OFFER_MINUTES * 60000, ev.startsAt.getTime())
    );

    const isInstantConfirm = {
      $and: [
        { $eq: ['$registering', true] },
        { $gte: ['$createdAt', { $subtract: ['$$NOW', 15000] }] },
      ],
    };

    const pipeline = [
      {
        $set: {
          status: {
            $cond: {
              if: isInstantConfirm,
              then: 'CONFIRMED',
              else: 'OFFERED',
            },
          },
          confirmedAt: {
            $cond: {
              if: isInstantConfirm,
              then: '$$NOW',
              else: '$confirmedAt',
            },
          },
          offeredAt: {
            $cond: {
              if: isInstantConfirm,
              then: null,
              else: '$$NOW',
            },
          },
          offerExpiresAt: {
            $cond: {
              if: isInstantConfirm,
              then: null,
              else: expiresAt,
            },
          },
          registering: false,
        },
      },
    ];

    const reg = await Registration.findOneAndUpdate(
      { eventId, status: 'WAITLISTED' },
      pipeline,
      { sort: { seq: 1 }, new: true }
    );

    if (!reg) {
      // nobody waiting: give the seat back
      await Event.updateOne({ _id: eventId }, { $inc: { heldSeats: -1 } });
      break;
    }

    if (reg.status === 'CONFIRMED') {
      await AuditLog.create({
        eventId,
        actorId: reg.userId,
        action: 'AUTO_CONFIRMED',
        registrationId: reg._id,
        payload: { confirmedAt: reg.confirmedAt },
      });
      await Notification.create({
        userId: reg.userId,
        eventId,
        type: 'CONFIRMED',
        message: 'Your registration is confirmed!',
      });
    } else {
      await AuditLog.create({
        eventId,
        actorId: null, // system
        action: 'OFFER_GRANTED',
        registrationId: reg._id,
        payload: { userId: reg.userId, offerExpiresAt: reg.offerExpiresAt },
      });
      await Notification.create({
        userId: reg.userId,
        eventId,
        type: 'OFFER',
        message: 'A seat has opened up! Claim your offer before it expires.',
      });
    }

    granted.push(reg);
  }

  return granted;
}

/**
 * allocate(eventId)
 * The single path used by register, cancel, decline, expiry, capacity increase,
 * and the sweeper. Runs allocateUnlocked one-at-a-time per event inside this
 * process. Why: a registrant keeps registering=true until its OWN allocate has
 * finished. Because allocations for one event are serialized, any allocation
 * that could pop that registrant finishes before the registrant's flag is
 * cleared, so the registrant is instantly confirmed (not offered) whenever a
 * seat was free for them. Assumes a single API process (see decisions.md).
 */
async function allocate(eventId) {
  return withLock(String(eventId), () => allocateUnlocked(eventId));
}

/**
 * 6.3 Register
 * 1. Validate: event is PUBLISHED, now is before registrationDeadline, now is before startsAt.
 * 2. Atomically findOneAndUpdate({_id}, {$inc:{nextSeq:1}}, {new:true}) to get this registration's seq.
 * 3. Insert the Registration as WAITLISTED with registering: true. On duplicate-key error return 409.
 * 4. Call allocate(eventId) (serialized per event).
 * 5. Clear the registering flag (always, even if allocate throws) and reload.
 * 6. Return the final status and position.
 */
async function register(eventId, userId) {
  const now = new Date();

  // 1. Validate event status & deadlines
  const ev = await Event.findById(eventId);
  if (!ev) {
    throw new ApiError(404, 'NOT_FOUND', 'Event not found');
  }

  if (ev.status !== 'PUBLISHED') {
    throw new ApiError(400, 'EVENT_NOT_PUBLISHED', 'Event is not open for registration');
  }

  if (now >= ev.startsAt) {
    throw new ApiError(400, 'EVENT_ALREADY_STARTED', 'Event has already started');
  }

  if (now >= ev.registrationDeadline) {
    throw new ApiError(400, 'REGISTRATION_CLOSED', 'Registration deadline has passed');
  }

  // 2. Atomically get next seq
  const updatedEvent = await Event.findByIdAndUpdate(
    eventId,
    { $inc: { nextSeq: 1 } },
    { new: true }
  );

  const seq = updatedEvent.nextSeq;

  // 3. Insert as WAITLISTED with registering: true (guarded by partial unique index)
  let reg;
  try {
    reg = await Registration.create({
      eventId,
      userId,
      status: 'WAITLISTED',
      seq,
      registering: true,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(
        409,
        'ALREADY_REGISTERED',
        'You already have an active registration for this event'
      );
    }
    throw err;
  }

  await AuditLog.create({
    eventId,
    actorId: userId,
    action: 'REGISTER_WAITLISTED',
    registrationId: reg._id,
    payload: { seq },
  });

  // 4 + 5. Run allocation; always clear the registering flag afterwards
  try {
    await allocate(eventId);
  } finally {
    await Registration.updateOne({ _id: reg._id, registering: true }, { registering: false });
  }

  // 6. Reload registration and return status and position
  const currentReg = await Registration.findById(reg._id);

  let position = null;
  if (currentReg.status === 'WAITLISTED') {
    position =
      (await Registration.countDocuments({
        eventId,
        status: 'WAITLISTED',
        seq: { $lt: currentReg.seq },
      })) + 1;
  }

  return {
    registration: currentReg,
    position,
  };
}

/**
 * Minimal cancel for WAITLISTED registration (Session 2 requirement for test 5)
 * Cancelling from WAITLISTED changes status only and frees no seat.
 */
async function cancelWaitlisted(registrationId, userId) {
  const reg = await Registration.findOneAndUpdate(
    { _id: registrationId, userId, status: 'WAITLISTED' },
    { status: 'CANCELLED', cancelledAt: new Date() },
    { new: true }
  );

  if (!reg) {
    const existing = await Registration.findById(registrationId);
    if (!existing) {
      throw new ApiError(404, 'NOT_FOUND', 'Registration not found');
    }
    if (existing.userId.toString() !== userId.toString()) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not own this registration');
    }
    throw new ApiError(
      409,
      'INVALID_STATUS',
      `Cannot cancel registration in status '${existing.status}' with this action`
    );
  }

  await AuditLog.create({
    eventId: reg.eventId,
    actorId: userId,
    action: 'CANCEL_WAITLISTED',
    registrationId: reg._id,
    payload: { cancelledAt: reg.cancelledAt },
  });

  return reg;
}

/**
 * Get user's active/all registrations with current waitlist position and serverTime
 */
async function getMyRegistrations(userId) {
  const registrations = await Registration.find({ userId })
    .populate('eventId', 'title startsAt location status capacity heldSeats')
    .sort({ createdAt: -1 });

  const now = new Date();
  const results = [];

  for (const reg of registrations) {
    let position = null;
    if (reg.status === 'WAITLISTED') {
      position =
        (await Registration.countDocuments({
          eventId: reg.eventId._id || reg.eventId,
          status: 'WAITLISTED',
          seq: { $lt: reg.seq },
        })) + 1;
    }

    results.push({
      ...reg.toObject(),
      position,
    });
  }

  return {
    registrations: results,
    serverTime: now.toISOString(),
  };
}

module.exports = {
  expireStaleOffers,
  allocate,
  allocateUnlocked,
  register,
  cancelWaitlisted,
  getMyRegistrations,
  setPreHeadPopHook,
};