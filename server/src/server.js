const mongoose = require('mongoose');
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const { startSweeper } = require('./jobs/sweeper');
require('./models');

const startServer = async () => {
  await connectDB();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  console.log('Indexes ready');
  startSweeper();

  app.listen(env.PORT, () => {
    console.log(`SeatFlow API server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = startServer;
