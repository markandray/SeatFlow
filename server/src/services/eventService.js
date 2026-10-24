const Event = require('../models/Event');
const Registration = require('../models/Registration');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/ApiError');
const { refreshEvent, allocate } = require('./registrationService');

/**
 * Create a new event in DRAFT status
 */
async function createEvent(organizerId, data) {
  const now = new Date();
  const startsAt = new Date(data.startsAt);
  const registrationDeadline = new Date(data.registrationDeadline);

  if (isNaN(startsAt.getTime()) || startsAt <= now) {
    throw new ApiError(400, 'INVALID_DATE', 'Event start time must be in the future');
  }

  if (isNaN(registrationDeadline.getTime()) || registrationDeadline >= startsAt) {
    throw new ApiError(
      400,
      'INVALID_DEADLINE',
      'Registration deadline must be before event start time'
    );
  }

  if (registrationDeadline <= now) {
    throw new ApiError(
      400,
      'INVALID_DEADLINE',
      'Registration deadline must be in the future'
    );
  }

  if (!data.capacity || data.capacity < 1) {
    throw new ApiError(400, 'INVALID_CAPACITY', 'Capacity must be at least 1');
  }

  const event = await Event.create({
    organizerId,
    title: data.title,
    description: data.description || '',
    location: data.location || '',
    startsAt,
    registrationDeadline,
    capacity: data.capacity,
    heldSeats: 0,
    nextSeq: 0,
    status: 'DRAFT',
  });

  await AuditLog.create({
    eventId: event._id,
    actorId: organizerId,
    action: 'EVENT_CREATED',
    payload: { title: event.title, capacity: event.capacity },
  });

  return event;
}

/**
 * List events with search and filters
 */
async function getEvents(query = {}) {
  const filter = { status: 'PUBLISHED', startsAt: { $gt: new Date() } };

  if (query.organizerId) {
    filter.organizerId = query.organizerId;
  }

  // Search keyword in title or description
  if (typeof query.search === 'string' && query.search.trim()) {
    const searchTerm = query.search.trim().slice(0, 100);
    const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearchTerm, 'i');
    filter.$or = [{ title: searchRegex }, { description: searchRegex }];
  }

  // Date filtering
  if (query.startsAfter) {
    const startsAfter = new Date(query.startsAfter);
    if (startsAfter > filter.startsAt.$gt) filter.startsAt.$gt = startsAfter;
  }
  if (query.startsBefore) {
    filter.startsAt = { ...filter.startsAt, $lt: new Date(query.startsBefore) };
  }

  const events = await Event.find(filter)
    .populate('organizerId', 'name email')
    .sort({ startsAt: 1 });

  return events.map((ev) => ({
    ...ev.toObject(),
    seatsLeft: Math.max(0, ev.capacity - ev.heldSeats),
  }));
}

/**
 * Get event details by ID with derived queue counts and user registration state
 */
async function getEventById(eventId, userId = null) {
  // Lazy expiry on read (Section 6.7)
  await refreshEvent(eventId);

  const event = await Event.findById(eventId).populate('organizerId', 'name email');
  if (!event) {
    throw new ApiError(404, 'NOT_FOUND', 'Event not found');
  }

  const seatsLeft = Math.max(0, event.capacity - event.heldSeats);
  const waitlistCount = await Registration.countDocuments({
    eventId,
    status: 'WAITLISTED',
  });

  let myRegistration = null;
  if (userId) {
    // Prefer active registration, or latest if inactive
    const activeReg = await Registration.findOne({
      eventId,
      userId,
      status: { $in: ['WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
    });

    const reg =
      activeReg ||
      (await Registration.findOne({ eventId, userId }).sort({ createdAt: -1 }));

    if (reg) {
      let position = null;
      if (reg.status === 'WAITLISTED') {
        position =
          (await Registration.countDocuments({
            eventId,
            status: 'WAITLISTED',
            seq: { $lt: reg.seq },
          })) + 1;
      }
      myRegistration = {
        ...reg.toObject(),
        position,
      };
    }
  }

  return {
    event,
    seatsLeft,
    waitlistCount,
    myRegistration,
    serverTime: new Date().toISOString(),
  };
}

async function getOrganizerEvents(organizerId) {
  const events = await Event.find({ organizerId }).sort({ startsAt: 1 });
  if (!events.length) return [];

  const counts = await Registration.aggregate([
    { $match: { eventId: { $in: events.map((event) => event._id) } } },
    { $group: { _id: { eventId: '$eventId', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const countMap = new Map(
    counts.map((row) => [`${row._id.eventId.toString()}:${row._id.status}`, row.count])
  );

  return events.map((event) => ({
    ...event.toObject(),
    counts: {
      confirmed: countMap.get(`${event._id}:CONFIRMED`) || 0,
      checkedIn: countMap.get(`${event._id}:CHECKED_IN`) || 0,
      waitlisted: countMap.get(`${event._id}:WAITLISTED`) || 0,
      offered: countMap.get(`${event._id}:OFFERED`) || 0,
    },
    seatsLeft: Math.max(0, event.capacity - event.heldSeats),
  }));
}

async function requireOwnedEvent(eventId, organizerId) {
  const event = await Event.findById(eventId);
  if (!event) throw new ApiError(404, 'NOT_FOUND', 'Event not found');
  if (event.organizerId.toString() !== organizerId.toString()) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not own this event');
  }
  return event;
}

async function getEventAttendees(eventId, organizerId) {
  await requireOwnedEvent(eventId, organizerId);
  await refreshEvent(eventId);
  const event = await Event.findById(eventId);
  const registrations = await Registration.find({ eventId })
    .populate('userId', 'name email')
    .sort({ seq: 1 });
  const groups = {};
  for (const registration of registrations) {
    if (!groups[registration.status]) groups[registration.status] = [];
    groups[registration.status].push(registration);
  }
  return {
    event,
    groups,
    counts: {
      confirmed: groups.CONFIRMED?.length || 0,
      checkedIn: groups.CHECKED_IN?.length || 0,
      waitlisted: groups.WAITLISTED?.length || 0,
      offered: groups.OFFERED?.length || 0,
      seatsLeft: Math.max(0, event.capacity - event.heldSeats),
    },
  };
}

async function getEventAudit(eventId, organizerId, { page = 1, limit = 25 } = {}) {
  await requireOwnedEvent(eventId, organizerId);
  const total = await AuditLog.countDocuments({ eventId });
  const logs = await AuditLog.find({ eventId })
    .populate('actorId', 'name email')
    .populate('registrationId')
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  return {
    logs,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Update event details or capacity (organizer only, owner check)
 */
async function updateEvent(eventId, organizerId, data) {
  const existing = await Event.findById(eventId);
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Event not found');
  }

  if (existing.organizerId.toString() !== organizerId.toString()) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not own this event');
  }

  const updateFields = {};
  if (data.title !== undefined) updateFields.title = data.title;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.location !== undefined) updateFields.location = data.location;

  const now = new Date();
  let startsAt = existing.startsAt;
  let registrationDeadline = existing.registrationDeadline;

  if (data.startsAt !== undefined) {
    startsAt = new Date(data.startsAt);
    if (isNaN(startsAt.getTime()) || startsAt <= now) {
      throw new ApiError(400, 'INVALID_DATE', 'Event start time must be in the future');
    }
    updateFields.startsAt = startsAt;
  }

  if (data.registrationDeadline !== undefined) {
    registrationDeadline = new Date(data.registrationDeadline);
    if (isNaN(registrationDeadline.getTime())) {
      throw new ApiError(400, 'INVALID_DEADLINE', 'Invalid registration deadline');
    }
    updateFields.registrationDeadline = registrationDeadline;
  }

  if (registrationDeadline >= startsAt) {
    throw new ApiError(
      400,
      'INVALID_DEADLINE',
      'Registration deadline must be before event start time'
    );
  }

  // Handle capacity change (Section 6.6)
  if (data.capacity !== undefined) {
    const newCapacity = parseInt(data.capacity, 10);
    if (isNaN(newCapacity) || newCapacity < 1) {
      throw new ApiError(400, 'INVALID_CAPACITY', 'Capacity must be at least 1');
    }

    updateFields.capacity = newCapacity;

    const ev = await Event.findOneAndUpdate(
      {
        _id: eventId,
        organizerId,
        heldSeats: { $lte: newCapacity },
      },
      { $set: updateFields },
      { new: true }
    );

    if (!ev) {
      throw new ApiError(
        409,
        'CAPACITY_TOO_LOW',
        'Capacity cannot be below seats already held'
      );
    }

    // A capacity increase must hand the new seats to the waitlist (Section 6.6)
    await allocate(eventId);

    await AuditLog.create({
      eventId,
      actorId: organizerId,
      action: 'EVENT_CAPACITY_UPDATED',
      payload: { newCapacity },
    });

    return Event.findById(eventId);
  }

  const updated = await Event.findOneAndUpdate(
    { _id: eventId, organizerId },
    { $set: updateFields },
    { new: true }
  );

  await AuditLog.create({
    eventId,
    actorId: organizerId,
    action: 'EVENT_UPDATED',
    payload: updateFields,
  });

  return updated;
}

/**
 * Publish draft event (organizer owner only)
 */
async function publishEvent(eventId, organizerId) {
  const existing = await Event.findById(eventId);
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Event not found');
  }

  if (existing.organizerId.toString() !== organizerId.toString()) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not own this event');
  }

  if (existing.status === 'PUBLISHED') {
    return existing;
  }

  const ev = await Event.findOneAndUpdate(
    { _id: eventId, organizerId, status: 'DRAFT' },
    { status: 'PUBLISHED' },
    { new: true }
  );

  if (!ev) {
    throw new ApiError(
      409,
      'INVALID_STATUS',
      `Cannot publish event in status '${existing.status}'`
    );
  }

  await AuditLog.create({
    eventId,
    actorId: organizerId,
    action: 'EVENT_PUBLISHED',
    payload: { status: 'PUBLISHED' },
  });

  await allocate(eventId);

  return ev;
}

module.exports = {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  publishEvent,
  getOrganizerEvents,
  getEventAttendees,
  getEventAudit,
};
