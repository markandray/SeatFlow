const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const Event = require('../src/models/Event');
const { checkInvariants } = require('./helpers/invariants');

describe('Event Management Workflow 1 (/api/events)', () => {
  let organizerToken;
  let otherOrganizerToken;
  let studentToken;
  let organizerId;

  beforeEach(async () => {
    // Register organizer 1
    const orgRes = await request(app).post('/api/auth/register').send({
      name: 'Organizer One',
      email: 'org1@example.com',
      password: 'password123',
      role: 'organizer',
    });
    organizerToken = orgRes.body.token;
    organizerId = orgRes.body.user._id;

    // Register organizer 2
    const org2Res = await request(app).post('/api/auth/register').send({
      name: 'Organizer Two',
      email: 'org2@example.com',
      password: 'password123',
      role: 'organizer',
    });
    otherOrganizerToken = org2Res.body.token;

    // Register student
    const studRes = await request(app).post('/api/auth/register').send({
      name: 'Student One',
      email: 'stud1@example.com',
      password: 'password123',
      role: 'student',
    });
    studentToken = studRes.body.token;
  });

  describe('POST /api/events', () => {
    it('should allow organizer to create draft event with valid inputs', async () => {
      const startsAt = new Date(Date.now() + 86400000).toISOString();
      const registrationDeadline = new Date(Date.now() + 43200000).toISOString();

      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Full Stack Workshop',
          description: 'Hands on MERN workshop',
          location: 'Lab 302',
          startsAt,
          registrationDeadline,
          capacity: 50,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.event).toHaveProperty('_id');
      expect(res.body.event.status).toBe('DRAFT');
      expect(res.body.event.capacity).toBe(50);
      expect(res.body.event.heldSeats).toBe(0);

      await checkInvariants(res.body.event._id);
    });

    it('should reject non-organizer users (403)', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          title: 'Sneaky Event',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          registrationDeadline: new Date(Date.now() + 43200000).toISOString(),
          capacity: 10,
        });

      expect(res.statusCode).toBe(403);
    });

    it('should reject invalid dates (startsAt in past, deadline after startsAt)', async () => {
      // startsAt in past
      const res1 = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Past Event',
          startsAt: new Date(Date.now() - 10000).toISOString(),
          registrationDeadline: new Date(Date.now() - 20000).toISOString(),
          capacity: 10,
        });
      expect(res1.statusCode).toBe(400);

      // deadline after startsAt
      const res2 = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Bad Deadline Event',
          startsAt: new Date(Date.now() + 100000).toISOString(),
          registrationDeadline: new Date(Date.now() + 200000).toISOString(),
          capacity: 10,
        });
      expect(res2.statusCode).toBe(400);

      // capacity < 1
      const res3 = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Zero Capacity',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          registrationDeadline: new Date(Date.now() + 43200000).toISOString(),
          capacity: 0,
        });
      expect(res3.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/events/:id and POST /api/events/:id/publish', () => {
    let eventId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Draft Event',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          registrationDeadline: new Date(Date.now() + 43200000).toISOString(),
          capacity: 20,
        });
      eventId = res.body.event._id;
    });

    it('should reject modifications by non-owners (403)', async () => {
      const res = await request(app)
        .patch(`/api/events/${eventId}`)
        .set('Authorization', `Bearer ${otherOrganizerToken}`)
        .send({ title: 'Hacked Title' });

      expect(res.statusCode).toBe(403);
    });

    it('should update event details and publish successfully', async () => {
      const patchRes = await request(app)
        .patch(`/api/events/${eventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ title: 'Updated Title', capacity: 25 });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.body.event.title).toBe('Updated Title');
      expect(patchRes.body.event.capacity).toBe(25);

      const pubRes = await request(app)
        .post(`/api/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(pubRes.statusCode).toBe(200);
      expect(pubRes.body.event.status).toBe('PUBLISHED');

      await checkInvariants(eventId);
    });
  });

  describe('GET /api/events and GET /api/events/:id', () => {
    let publishedEventId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'AI Summit 2026',
          description: 'Exploring LLMs and agents',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          registrationDeadline: new Date(Date.now() + 43200000).toISOString(),
          capacity: 10,
        });
      publishedEventId = res.body.event._id;

      await request(app)
        .post(`/api/events/${publishedEventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);
    });

    it('GET /api/events should list published events with seatsLeft', async () => {
      const res = await request(app).get('/api/events');
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBeGreaterThanOrEqual(1);
      expect(res.body.events[0]).toHaveProperty('seatsLeft', 10);
    });

    it('GET /api/events/:id returns seatsLeft, waitlistCount, serverTime, and myRegistration', async () => {
      // Unauthenticated read
      const publicRes = await request(app).get(`/api/events/${publishedEventId}`);
      expect(publicRes.statusCode).toBe(200);
      expect(publicRes.body).toHaveProperty('seatsLeft', 10);
      expect(publicRes.body).toHaveProperty('waitlistCount', 0);
      expect(publicRes.body).toHaveProperty('serverTime');
      expect(publicRes.body.myRegistration).toBeNull();

      // Authenticated student read
      const authRes = await request(app)
        .get(`/api/events/${publishedEventId}`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(authRes.statusCode).toBe(200);
      expect(authRes.body.myRegistration).toBeNull();

      await checkInvariants(publishedEventId);
    });
  });
});
