const express = require('express');
const { z } = require('zod');
const { getMine, cancel, claim, decline } = require('../controllers/registrationController');
const authRequired = require('../middleware/authRequired');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');

const router = express.Router();
const registrationIdParams = validate(
  z.object({ params: z.object({ id: z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid registration ID') }) })
);

router.get('/mine', authRequired, requireRole('student'), getMine);
router.post('/:id/claim', authRequired, requireRole('student'), registrationIdParams, claim);
router.post('/:id/decline', authRequired, requireRole('student'), registrationIdParams, decline);
router.post('/:id/cancel', authRequired, requireRole('student'), registrationIdParams, cancel);

module.exports = router;
