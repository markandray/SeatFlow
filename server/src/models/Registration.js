const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        'WAITLISTED',
        'OFFERED',
        'CONFIRMED',
        'CHECKED_IN',
        'EXPIRED',
        'CANCELLED',
        'NO_SHOW',
      ],
      default: 'WAITLISTED',
      required: true,
      index: true,
    },
    seq: {
      type: Number,
      required: true,
    },
    offeredAt: {
      type: Date,
      default: null,
    },
    offerExpiresAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    checkedInAt: {
      type: Date,
      default: null,
    },
    registering: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

// Partial unique index on (eventId, userId) for active statuses
// Blocks duplicates and double-clicks at the DB level while allowing re-joining after cancel/expiry.
registrationSchema.index(
  { eventId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'] },
    },
  }
);

// Index for head-of-waitlist lookup: FIFO by seq
registrationSchema.index({ eventId: 1, status: 1, seq: 1 });

// Index for user registrations query
registrationSchema.index({ userId: 1, status: 1 });

const Registration = mongoose.model('Registration', registrationSchema);

module.exports = Registration;
