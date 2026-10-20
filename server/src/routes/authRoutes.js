const express = require('express');
const {
  registerSchema,
  loginSchema,
  register,
  login,
  getMe,
} = require('../controllers/authController');
const validate = require('../middleware/validate');
const authRequired = require('../middleware/authRequired');

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', authRequired, getMe);

module.exports = router;
