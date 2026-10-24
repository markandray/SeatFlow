const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file if it exists
dotenv.config();

const jwtSecret = process.env.JWT_SECRET || 'dev_secret_key_change_in_production';
const productionJwtPlaceholders = new Set([
  'replace_with_a_random_secret_at_least_32_characters_long',
  'supersecret_seatflow_jwt_key_change_in_production',
  'dev_secret_key_change_in_production',
]);
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_SECRET ||
    jwtSecret.trim().length < 32 ||
    productionJwtPlaceholders.has(jwtSecret.trim()))
) {
  throw new Error(
    'Unsafe production JWT_SECRET: set a unique random secret at least 32 characters long; do not use an example placeholder.'
  );
}

const env = {
  PORT: parseInt(process.env.PORT, 10) || 5001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/seatflow',
  JWT_SECRET: jwtSecret,
  CLIENT_ORIGIN: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, ''),
  OFFER_MINUTES: parseFloat(process.env.OFFER_MINUTES || '10'),
  ORGANIZER_INVITE_CODE: process.env.ORGANIZER_INVITE_CODE || null,
};

module.exports = env;
