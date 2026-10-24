const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  getToken() {
    return localStorage.getItem('seatflow_token');
  }

  setToken(token) {
    if (token) {
      localStorage.setItem('seatflow_token', token);
    } else {
      localStorage.removeItem('seatflow_token');
    }
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers,
    };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, config);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Request failed');
      error.statusCode = response.status;
      error.code = data?.error?.code || 'UNKNOWN_ERROR';
      error.details = data?.error?.details || null;
      throw error;
    }

    return data;
  }

  // Health
  getHealth() {
    return this.request('/health');
  }

  // Auth
  register(userData) {
    return this.request('/auth/register', {
      method: 'POST',
      body: userData,
    });
  }

  login(credentials) {
    return this.request('/auth/login', {
      method: 'POST',
      body: credentials,
    });
  }

  getMe() {
    return this.request('/auth/me');
  }

  // Events
  getEvents(query = {}) {
    const params = new URLSearchParams();
    if (query.search) params.append('search', query.search);
    if (query.status) params.append('status', query.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/events${qs}`);
  }

  getOrganizerEvents() {
    return this.request('/events/mine');
  }

  getEventAttendees(eventId) {
    return this.request(`/events/${eventId}/attendees`);
  }

  getEventAudit(eventId, page = 1, limit = 25) {
    return this.request(`/events/${eventId}/audit?page=${page}&limit=${limit}`);
  }

  cancelEvent(eventId) {
    return this.request(`/events/${eventId}/cancel`, { method: 'POST' });
  }

  getEventById(id) {
    return this.request(`/events/${id}`);
  }

  createEvent(eventData) {
    return this.request('/events', {
      method: 'POST',
      body: eventData,
    });
  }

  updateEvent(id, updateData) {
    return this.request(`/events/${id}`, {
      method: 'PATCH',
      body: updateData,
    });
  }

  checkInRegistration(registrationId) {
    return this.request(`/registrations/${registrationId}/check-in`, { method: 'POST' });
  }

  markNoShow(registrationId) {
    return this.request(`/registrations/${registrationId}/no-show`, { method: 'POST' });
  }

  publishEvent(id) {
    return this.request(`/events/${id}/publish`, {
      method: 'POST',
    });
  }

  // Registrations
  registerForEvent(eventId) {
    return this.request(`/events/${eventId}/register`, {
      method: 'POST',
    });
  }

  getMyRegistrations() {
    return this.request('/registrations/mine');
  }

  cancelRegistration(registrationId) {
    return this.request(`/registrations/${registrationId}/cancel`, {
      method: 'POST',
    });
  }

  claimOffer(registrationId) {
    return this.request(`/registrations/${registrationId}/claim`, { method: 'POST' });
  }

  declineOffer(registrationId) {
    return this.request(`/registrations/${registrationId}/decline`, { method: 'POST' });
  }

  getNotifications() {
    return this.request('/notifications');
  }

  markNotificationRead(notificationId) {
    return this.request(`/notifications/${notificationId}/read`, { method: 'POST' });
  }
}

export const api = new ApiClient(BASE_URL);
export default api;
