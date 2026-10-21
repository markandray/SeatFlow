const express = require('express');
const {
  createEventSchema,
  updateEventSchema,
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  publishEvent,
} = require('../controllers/eventController');
const { register } = require('../controllers/registrationController');
const authRequired = require('../middleware/authRequired');
const authOptional = require('../middleware/authOptional');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');

const router = express.Router();

// Public routes
router.get('/', getEvents);
router.get('/:id', authOptional, getEventById);

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
  validate(updateEventSchema),
  updateEvent
);

router.post(
  '/:id/publish',
  authRequired,
  requireRole('organizer'),
  publishEvent
);

// Student registration
router.post(
  '/:id/register',
  authRequired,
  requireRole('student'),
  register
);

module.exports = router;
