const cron = require('node-cron');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const { refreshEvent, reconcileEvent } = require('../services/registrationService');

let sweepRunning = false;
let reconcileRunning = false;

async function runSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const eventIds = await Registration.distinct('eventId', {
      status: 'OFFERED',
      offerExpiresAt: { $lt: new Date() },
    });
    for (const eventId of eventIds) await refreshEvent(eventId);
  } finally {
    sweepRunning = false;
  }
}

async function runReconciler() {
  if (reconcileRunning) return;
  reconcileRunning = true;
  try {
    const eventIds = await Event.distinct('_id', { status: 'PUBLISHED' });
    await Promise.all(eventIds.map((eventId) => reconcileEvent(eventId)));
  } finally {
    reconcileRunning = false;
  }
}

function startSweeper() {
  if (process.env.NODE_ENV === 'test') return [];
  return [
    cron.schedule('*/15 * * * * *', () => runSweep().catch((err) => console.error('Offer sweeper failed:', err))),
    cron.schedule('0 * * * * *', () => runReconciler().catch((err) => console.error('Seat reconciler failed:', err))),
  ];
}

module.exports = { runSweep, runReconciler, startSweeper };
