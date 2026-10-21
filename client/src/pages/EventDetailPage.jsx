import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function EventDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const fetchEvent = () => {
    setLoading(true);
    api
      .getEventById(id)
      .then((data) => {
        setEventData(data);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load event details');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEvent();
  }, [id, user]);

  const handleRegister = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.registerForEvent(id);
      if (res.registration.status === 'CONFIRMED') {
        setSuccessMsg('🎉 Registration confirmed! Your seat is secured.');
      } else if (res.registration.status === 'WAITLISTED') {
        setSuccessMsg(`📋 Added to waitlist at position #${res.position}.`);
      }
      fetchEvent();
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '720px', margin: '4rem auto', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading event details...
      </div>
    );
  }

  if (error && !eventData) {
    return (
      <div style={{ maxWidth: '720px', margin: '4rem auto', padding: '0 1rem' }}>
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', padding: '1.5rem', borderRadius: 'var(--radius-md)' }}>
          <h3>Error loading event</h3>
          <p style={{ marginTop: '0.5rem' }}>{error}</p>
          <Link to="/" style={{ display: 'inline-block', marginTop: '1rem', color: '#fff' }}>
            &larr; Back to Events
          </Link>
        </div>
      </div>
    );
  }

  const { event, seatsLeft, waitlistCount, myRegistration } = eventData;
  const now = new Date();
  const startsAt = new Date(event.startsAt);
  const deadline = new Date(event.registrationDeadline);
  const isClosed = now >= startsAt || now >= deadline || event.status !== 'PUBLISHED';

  // Determine button state and label per spec
  let buttonLabel = 'Register';
  let buttonDisabled = false;

  if (!user) {
    buttonLabel = 'Login to Register';
    buttonDisabled = false;
  } else if (user.role === 'organizer') {
    buttonLabel = 'Organizers cannot register';
    buttonDisabled = true;
  } else if (isClosed) {
    buttonLabel = 'Event closed';
    buttonDisabled = true;
  } else if (myRegistration && ['WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'].includes(myRegistration.status)) {
    buttonDisabled = true;
    if (myRegistration.status === 'CONFIRMED') {
      buttonLabel = 'Already registered';
    } else if (myRegistration.status === 'WAITLISTED') {
      buttonLabel = `Already registered (Waitlist #${myRegistration.position || '?'})`;
    } else if (myRegistration.status === 'OFFERED') {
      buttonLabel = 'Offer Available (Check My Registrations)';
    } else {
      buttonLabel = 'Already registered';
    }
  } else {
    // Open for registration
    if (seatsLeft > 0) {
      buttonLabel = submitting ? 'Registering...' : 'Register';
    } else {
      buttonLabel = submitting ? 'Joining waitlist...' : 'Join waitlist';
    }
  }

  return (
    <div style={{ maxWidth: '720px', margin: '2rem auto', padding: '0 1.5rem' }}>
      <Link to="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem', display: 'inline-block', marginBottom: '1rem' }}>
        &larr; Back to all events
      </Link>

      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '2rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              background: seatsLeft > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: seatsLeft > 0 ? '#34d399' : '#fbbf24',
            }}
          >
            {seatsLeft > 0 ? `${seatsLeft} of ${event.capacity} seats remaining` : 'Capacity Full (Waitlist Open)'}
          </span>

          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Waitlist queue: {waitlistCount} waiting
          </span>
        </div>

        <h1 style={{ fontSize: '1.85rem', fontWeight: 800, marginBottom: '0.75rem' }}>
          {event.title}
        </h1>

        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '1.5rem', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
          {event.description || 'No detailed description provided.'}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            padding: '1.25rem',
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Location</div>
            <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>📍 {event.location || 'Campus'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Starts At</div>
            <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>
              🕒 {new Date(event.startsAt).toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Registration Deadline</div>
            <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>
              ⏳ {new Date(event.registrationDeadline).toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Organizer</div>
            <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>
              👤 {event.organizerId?.name || 'Club Organizer'}
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#f87171',
              padding: '0.85rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              fontSize: '0.9rem',
            }}
          >
            {error}
          </div>
        )}

        {successMsg && (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              color: '#34d399',
              padding: '0.85rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              fontSize: '0.9rem',
            }}
          >
            {successMsg}
          </div>
        )}

        <button
          onClick={handleRegister}
          disabled={buttonDisabled || submitting}
          style={{
            width: '100%',
            padding: '1rem',
            fontSize: '1.05rem',
            fontWeight: 700,
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: buttonDisabled
              ? 'rgba(255, 255, 255, 0.08)'
              : seatsLeft > 0
              ? 'var(--accent-primary)'
              : 'var(--warning)',
            color: buttonDisabled ? 'var(--text-muted)' : '#fff',
            cursor: buttonDisabled || submitting ? 'not-allowed' : 'pointer',
            transition: 'var(--transition)',
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
