const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');

const startServer = async () => {
  await connectDB();

  app.listen(env.PORT, () => {
    console.log(`SeatFlow API server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = startServer;
