const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file if it exists
dotenv.config();

const env = {
  PORT: parseInt(process.env.PORT, 10) || 5001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/seatflow',
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_key_change_in_production',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  OFFER_MINUTES: parseFloat(process.env.OFFER_MINUTES || '10'),
  ORGANIZER_INVITE_CODE: process.env.ORGANIZER_INVITE_CODE || null,
};

module.exports = env;
