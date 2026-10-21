const Event = require('../../src/models/Event');
const Registration = require('../../src/models/Registration');

/**
 * Recomputes invariants 1, 2, 3, and 6 from section 5 of SPEC.md for an event.
 * Throws an assertion error if any invariant is violated.
 *
 * Invariant 1: heldSeats equals the number of registrations in OFFERED + CONFIRMED + CHECKED_IN.
 * Invariant 2: heldSeats <= capacity always.
 * Invariant 3: A user has at most one active registration per event.
 * Invariant 6: No offer is created after startsAt, and offerExpiresAt never exceeds startsAt.
 */
async function checkInvariants(eventId) {
  const event = await Event.findById(eventId);
  if (!event) {
    throw new Error(`Invariant check failed: Event ${eventId} not found`);
  }

  // Invariant 1: heldSeats == count(OFFERED + CONFIRMED + CHECKED_IN)
  const heldCount = await Registration.countDocuments({
    eventId,
    status: { $in: ['OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
  });

  if (event.heldSeats !== heldCount) {
    throw new Error(
      `Invariant 1 Violated: event.heldSeats (${event.heldSeats}) !== active held registrations (${heldCount})`
    );
  }

  // Invariant 2: heldSeats <= capacity
  if (event.heldSeats > event.capacity) {
    throw new Error(
      `Invariant 2 Violated: event.heldSeats (${event.heldSeats}) > event.capacity (${event.capacity})`
    );
  }

  // Invariant 3: A user has at most one active registration per event
  const activeRegistrations = await Registration.find({
    eventId,
    status: { $in: ['WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
  });

  const seenUsers = new Set();
  for (const reg of activeRegistrations) {
    const uid = reg.userId.toString();
    if (seenUsers.has(uid)) {
      throw new Error(
        `Invariant 3 Violated: User ${uid} has multiple active registrations for event ${eventId}`
      );
    }
    seenUsers.add(uid);
  }

  // Invariant 6: No offer created after startsAt, and offerExpiresAt never exceeds startsAt
  const offeredRegistrations = await Registration.find({
    eventId,
    offeredAt: { $ne: null },
  });

  for (const reg of offeredRegistrations) {
    if (reg.offeredAt.getTime() > event.startsAt.getTime()) {
      throw new Error(
        `Invariant 6 Violated: offeredAt (${reg.offeredAt}) is after startsAt (${event.startsAt})`
      );
    }
    if (reg.offerExpiresAt && reg.offerExpiresAt.getTime() > event.startsAt.getTime()) {
      throw new Error(
        `Invariant 6 Violated: offerExpiresAt (${reg.offerExpiresAt}) exceeds startsAt (${event.startsAt})`
      );
    }
  }

  return true;
}

module.exports = {
  checkInvariants,
};
