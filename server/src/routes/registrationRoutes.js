const express = require('express');
const { getMine, cancel } = require('../controllers/registrationController');
const authRequired = require('../middleware/authRequired');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.get('/mine', authRequired, requireRole('student'), getMine);
router.post('/:id/cancel', authRequired, requireRole('student'), cancel);

module.exports = router;
