const { z } = require('zod');
const validate = require('./validate');

const objectId = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid ID');
const eventIdParams = validate(z.object({ params: z.object({ id: objectId }) }));
const registrationIdParams = eventIdParams;
const publicEventsQuery = validate(
  z.object({
    query: z.object({
      search: z.string().optional(),
      status: z.literal('PUBLISHED').optional(),
      organizerId: objectId.optional(),
      startsAfter: z.string().datetime({ offset: true }).optional(),
      startsBefore: z.string().datetime({ offset: true }).optional(),
    }),
  })
);
const auditQuery = validate(
  z.object({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  })
);

module.exports = { eventIdParams, registrationIdParams, publicEventsQuery, auditQuery };
