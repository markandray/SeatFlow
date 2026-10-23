const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const Notification = require('../src/models/Notification');
const env = require('../src/config/env');

describe('Notifications API', () => {
  let student;
  let token;
  let event;

  beforeEach(async () => {
    student = await User.create({
      name: 'Notification Student',
      email: 'notification_student@example.com',
      passwordHash: 'hash',
      role: 'student',
    });
    token = jwt.sign({ id: student._id.toString(), role: student.role }, env.JWT_SECRET);
    event = await Event.create({
      organizerId: student._id,
      title: 'Notification Event',
      startsAt: new Date(Date.now() + 86400000),
      registrationDeadline: new Date(Date.now() + 43200000),
      capacity: 1,
      status: 'PUBLISHED',
    });
  });

  it('lists a student’s notifications and marks only their own notification read', async () => {
    const notification = await Notification.create({
      userId: student._id,
      eventId: event._id,
      type: 'OFFER',
      message: 'A seat is available.',
    });

    const listed = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
    expect(listed.statusCode).toBe(200);
    expect(listed.body.unreadCount).toBe(1);
    expect(listed.body.notifications[0]._id).toBe(notification._id.toString());
    expect(listed.body).toHaveProperty('serverTime');

    const marked = await request(app)
      .post(`/api/notifications/${notification._id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(marked.statusCode).toBe(200);
    expect(marked.body.notification.readAt).toBeTruthy();

    const invalidId = await request(app)
      .post('/api/notifications/not-an-id/read')
      .set('Authorization', `Bearer ${token}`);
    expect(invalidId.statusCode).toBe(400);
  });
});
