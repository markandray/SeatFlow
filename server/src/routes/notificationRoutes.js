const express = require('express');
const { z } = require('zod');
const { getMine, markRead } = require('../controllers/notificationController');
const authRequired = require('../middleware/authRequired');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(authRequired, requireRole('student'));
router.get('/', getMine);
router.post(
  '/:id/read',
  validate(z.object({ params: z.object({ id: z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid notification ID') }) })),
  markRead
);

module.exports = router;
