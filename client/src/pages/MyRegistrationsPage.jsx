import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function MyRegistrationsPage() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const fetchRegistrations = () => {
    setLoading(true);
    api
      .getMyRegistrations()
      .then((data) => {
        setRegistrations(data.registrations || []);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load registrations');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRegistrations();
  }, []);

  const handleCancel = async (id) => {
    if (!window.confirm('Are you sure you want to cancel your registration?')) {
      return;
    }

    setCancellingId(id);
    setError(null);
    setMsg(null);

    try {
      await api.cancelRegistration(id);
      setMsg('Registration cancelled successfully.');
      fetchRegistrations();
    } catch (err) {
      setError(err.message || 'Failed to cancel registration');
    } finally {
      setCancellingId(null);
    }
  };

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'CONFIRMED':
        return { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', text: 'Confirmed' };
      case 'WAITLISTED':
        return { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', text: 'Waitlisted' };
      case 'OFFERED':
        return { bg: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', text: 'Offer Available' };
      case 'CHECKED_IN':
        return { bg: 'rgba(16, 185, 129, 0.25)', color: '#10b981', text: 'Checked In' };
      case 'CANCELLED':
        return { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', text: 'Cancelled' };
      case 'EXPIRED':
        return { bg: 'rgba(100, 116, 139, 0.2)', color: '#94a3b8', text: 'Offer Expired' };
      default:
        return { bg: 'rgba(255, 255, 255, 0.1)', color: '#fff', text: status };
    }
  };

  return (
    <div style={{ maxWidth: '840px', margin: '2rem auto', padding: '0 1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.85rem', fontWeight: 800 }}>My Registrations</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          View your confirmed seats, waitlist positions, and active offers.
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
          {error}
        </div>
      )}

      {msg && (
        <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#34d399', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
          {msg}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          Loading your registrations...
        </div>
      )}

      {!loading && registrations.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
          }}
        >
          <h3>No registrations yet</h3>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
            You have not registered for any events yet.
          </p>
          <Link
            to="/"
            style={{
              display: 'inline-block',
              marginTop: '1.25rem',
              background: 'var(--accent-primary)',
              color: '#fff',
              padding: '0.6rem 1.2rem',
              borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Explore Events
          </Link>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {registrations.map((reg) => {
          const badge = getStatusBadgeStyle(reg.status);
          const ev = reg.eventId;
          const isCancelling = cancellingId === reg._id;

          return (
            <div
              key={reg._id}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '1.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                  <span
                    style={{
                      background: badge.bg,
                      color: badge.color,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: '0.2rem 0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {badge.text}
                  </span>

                  {reg.status === 'WAITLISTED' && reg.position && (
                    <span
                      style={{
                        background: 'rgba(245, 158, 11, 0.25)',
                        color: '#fbbf24',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.6rem',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      Position #{reg.position}
                    </span>
                  )}
                </div>

                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                  <Link
                    to={`/events/${ev?._id || ev}`}
                    style={{ color: '#fff', textDecoration: 'none' }}
                  >
                    {ev?.title || 'Event Registration'}
                  </Link>
                </h3>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  {ev?.startsAt && (
                    <span>🕒 {new Date(ev.startsAt).toLocaleDateString()} &bull; </span>
                  )}
                  <span>Seq #{reg.seq}</span>
                  {reg.confirmedAt && (
                    <span> &bull; Confirmed on {new Date(reg.confirmedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>

              <div>
                {reg.status === 'WAITLISTED' && (
                  <button
                    onClick={() => handleCancel(reg._id)}
                    disabled={isCancelling}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      color: '#f87171',
                      padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: 600,
                      cursor: isCancelling ? 'not-allowed' : 'pointer',
                      opacity: isCancelling ? 0.6 : 1,
                    }}
                  >
                    {isCancelling ? 'Cancelling...' : 'Cancel Registration'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
