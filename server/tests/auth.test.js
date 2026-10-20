const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');

describe('Auth API (/api/auth)', () => {
  const studentData = {
    name: 'Alice Student',
    email: 'alice@example.com',
    password: 'password123',
    role: 'student',
  };

  describe('POST /api/auth/register', () => {
    it('should register a new student successfully', async () => {
      const res = await request(app).post('/api/auth/register').send(studentData);

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.name).toBe(studentData.name);
      expect(res.body.user.email).toBe(studentData.email);
      expect(res.body.user.role).toBe('student');
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('should reject registration with invalid email or short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Bob',
          email: 'not-an-email',
          password: '123',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration if email is already registered (409)', async () => {
      await request(app).post('/api/auth/register').send(studentData);

      const res = await request(app).post('/api/auth/register').send(studentData);

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_EXISTS');
    });

    it('should require invite code for organizer if ORGANIZER_INVITE_CODE is set', async () => {
      const originalInviteCode = env.ORGANIZER_INVITE_CODE;
      env.ORGANIZER_INVITE_CODE = 'SECRET_TEST_CODE';

      try {
        // Without invite code
        const resWithout = await request(app).post('/api/auth/register').send({
          name: 'Organizer Dan',
          email: 'dan@example.com',
          password: 'password123',
          role: 'organizer',
        });
        expect(resWithout.statusCode).toBe(403);
        expect(resWithout.body.error.code).toBe('INVALID_INVITE_CODE');

        // With wrong invite code
        const resWrong = await request(app).post('/api/auth/register').send({
          name: 'Organizer Dan',
          email: 'dan@example.com',
          password: 'password123',
          role: 'organizer',
          inviteCode: 'WRONG_CODE',
        });
        expect(resWrong.statusCode).toBe(403);

        // With valid invite code
        const resValid = await request(app).post('/api/auth/register').send({
          name: 'Organizer Dan',
          email: 'dan@example.com',
          password: 'password123',
          role: 'organizer',
          inviteCode: 'SECRET_TEST_CODE',
        });
        expect(resValid.statusCode).toBe(201);
        expect(resValid.body.user.role).toBe('organizer');
      } finally {
        env.ORGANIZER_INVITE_CODE = originalInviteCode;
      }
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(studentData);
    });

    it('should login with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: studentData.email,
        password: studentData.password,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe(studentData.email);
    });

    it('should fail with incorrect password', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: studentData.email,
        password: 'wrongpassword',
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should fail with non-existent email', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'nobody@example.com',
        password: 'password123',
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('GET /api/auth/me', () => {
    let token;

    beforeEach(async () => {
      const res = await request(app).post('/api/auth/register').send(studentData);
      token = res.body.token;
    });

    it('should return current user when authenticated with Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.user.email).toBe(studentData.email);
      expect(res.body.user.name).toBe(studentData.name);
    });

    it('should return 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token-xyz');

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });
});
