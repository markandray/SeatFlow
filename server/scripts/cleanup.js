const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Registration = require('../src/models/Registration');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');
const { DEMO_USERS } = require('./demoAccounts');

function getConnectionDetails(uri) {
  const parsed = new URL(uri);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0]);
  if (!database) throw new Error('MONGO_URI must include a database name before cleanup can run.');
  return {
    host: parsed.hostname,
    database,
  };
}

async function runCleanup({ confirm = process.argv.includes('--confirm') } = {}) {
  try {
    const details = getConnectionDetails(env.MONGO_URI);
    await mongoose.connect(env.MONGO_URI);
    const demoEmails = DEMO_USERS.map((user) => user.email);
    const counts = {
      events: await Event.countDocuments({}),
      registrations: await Registration.countDocuments({}),
      notifications: await Notification.countDocuments({}),
      auditLogs: await AuditLog.countDocuments({}),
      users: await User.countDocuments({ email: { $nin: demoEmails } }),
    };

    console.log(`Database: ${details.database}`);
    console.log(`Host: ${details.host}`);
    console.log('Records to delete:');
    for (const [collection, count] of Object.entries(counts)) console.log(`  ${collection}: ${count}`);

    if (!confirm) {
      console.log('Dry run only. To delete these records, run npm run cleanup -- --confirm.');
      return;
    }

    const prompt = readline.createInterface({ input: stdin, output: stdout });
    const typedDatabase = await prompt.question(`Type the database name "${details.database}" to confirm: `);
    prompt.close();
    if (typedDatabase.trim() !== details.database) {
      throw new Error('Database name did not match; no records were deleted.');
    }

    await Promise.all([
      Registration.deleteMany({}),
      Notification.deleteMany({}),
      AuditLog.deleteMany({}),
      Event.deleteMany({}),
      User.deleteMany({ email: { $nin: demoEmails } }),
    ]);
    console.log('Cleanup complete. Demo accounts were retained.');
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  runCleanup().catch((error) => {
    console.error(`Cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { getConnectionDetails, runCleanup };
