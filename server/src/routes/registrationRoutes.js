const express = require('express');
const { getMine, cancel, claim, decline, checkIn, noShow } = require('../controllers/registrationController');
const authRequired = require('../middleware/authRequired');
const requireRole = require('../middleware/requireRole');
const { registrationIdParams } = require('../middleware/routeSchemas');

const router = express.Router();

router.get('/mine', authRequired, requireRole('student'), getMine);
router.post('/:id/claim', authRequired, requireRole('student'), registrationIdParams, claim);
router.post('/:id/decline', authRequired, requireRole('student'), registrationIdParams, decline);
router.post('/:id/cancel', authRequired, requireRole('student'), registrationIdParams, cancel);
router.post('/:id/check-in', authRequired, requireRole('organizer'), registrationIdParams, checkIn);
router.post('/:id/no-show', authRequired, requireRole('organizer'), registrationIdParams, noShow);

module.exports = router;
