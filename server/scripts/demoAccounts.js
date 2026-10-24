const DEMO_PASSWORD = 'SeatFlowDemo!2026';
const DEMO_USERS = [
  { name: 'Demo Organizer', email: 'demo.organizer@seatflow.test', role: 'organizer' },
  ...Array.from({ length: 5 }, (_, index) => ({
    name: `Demo Student ${index + 1}`,
    email: `demo.student${index + 1}@seatflow.test`,
    role: 'student',
  })),
];

module.exports = { DEMO_PASSWORD, DEMO_USERS };
