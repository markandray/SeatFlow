const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const eventService = require('../services/eventService');

const createEventSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().optional().default(''),
  location: z.string().optional().default(''),
  startsAt: z.string().min(1, 'Start date is required'),
  registrationDeadline: z.string().min(1, 'Registration deadline is required'),
  capacity: z.number().int().min(1, 'Capacity must be at least 1'),
});

const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  startsAt: z.string().optional(),
  registrationDeadline: z.string().optional(),
  capacity: z.number().int().min(1).optional(),
});

const createEvent = asyncHandler(async (req, res) => {
  const event = await eventService.createEvent(req.user._id, req.body);
  res.status(201).json({ event });
});

const getEvents = asyncHandler(async (req, res) => {
  const events = await eventService.getEvents(req.query);
  res.status(200).json({ events });
});

const getEventById = asyncHandler(async (req, res) => {
  const result = await eventService.getEventById(req.params.id, req.user?._id);
  res.status(200).json(result);
});

const updateEvent = asyncHandler(async (req, res) => {
  const event = await eventService.updateEvent(req.params.id, req.user._id, req.body);
  res.status(200).json({ event });
});

const publishEvent = asyncHandler(async (req, res) => {
  const event = await eventService.publishEvent(req.params.id, req.user._id);
  res.status(200).json({ event });
});

module.exports = {
  createEventSchema,
  updateEventSchema,
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  publishEvent,
};
