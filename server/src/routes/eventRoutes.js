const express = require('express');
const {
  createEventSchema,
  updateEventSchema,
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  publishEvent,
  getMine,
  getAttendees,
  getAudit,
  cancelEvent,
} = require('../controllers/eventController');
const { register } = require('../controllers/registrationController');
const authRequired = require('../middleware/authRequired');
const authOptional = require('../middleware/authOptional');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { eventIdParams, publicEventsQuery, auditQuery } = require('../middleware/routeSchemas');

const router = express.Router();

// Public routes
router.get('/', publicEventsQuery, getEvents);

// Organizer event list must be registered before the /:id route.
router.get('/mine', authRequired, requireRole('organizer'), getMine);
router.get('/:id/attendees', authRequired, requireRole('organizer'), eventIdParams, getAttendees);
router.get('/:id/audit', authRequired, requireRole('organizer'), eventIdParams, auditQuery, getAudit);
router.get('/:id', eventIdParams, authOptional, getEventById);

// Organizer routes
router.post(
  '/',
  authRequired,
  requireRole('organizer'),
  validate(createEventSchema),
  createEvent
);

router.patch(
  '/:id',
  authRequired,
  requireRole('organizer'),
  eventIdParams,
  validate(updateEventSchema),
  updateEvent
);

router.post(
  '/:id/publish',
  authRequired,
  requireRole('organizer'),
  eventIdParams,
  publishEvent
);

router.post('/:id/cancel', authRequired, requireRole('organizer'), eventIdParams, cancelEvent);

// Student registration
router.post(
  '/:id/register',
  authRequired,
  requireRole('student'),
  eventIdParams,
  register
);

module.exports = router;
