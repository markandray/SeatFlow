const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('../models/User');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['organizer', 'student']).default('student'),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
    },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, inviteCode } = req.body;

  // If registering as organizer, check invite code if configured
  if (role === 'organizer' && env.ORGANIZER_INVITE_CODE) {
    if (!inviteCode || inviteCode !== env.ORGANIZER_INVITE_CODE) {
      throw new ApiError(
        403,
        'INVALID_INVITE_CODE',
        'Valid organizer invite code required to create an organizer account'
      );
    }
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = await User.create({
    name,
    email,
    passwordHash,
    role,
  });

  const token = generateToken(user);

  res.status(201).json({
    user,
    token,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const token = generateToken(user);

  res.status(200).json({
    user,
    token,
  });
});

const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    user: req.user,
  });
});

module.exports = {
  registerSchema,
  loginSchema,
  register,
  login,
  getMe,
};
