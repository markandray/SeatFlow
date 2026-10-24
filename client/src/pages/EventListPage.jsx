import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function EventListPage() {
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchEvents = (searchTerm = '') => {
    setLoading(true);
    api
      .getEvents({ search: searchTerm })
      .then((res) => {
        setEvents(res.events || []);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load events');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchEvents(search);
  };

  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1.5rem' }}>
      <section style={{ margin: '1.5rem 0 3rem', padding: '2.5rem', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, var(--bg-secondary), rgba(99,102,241,.18))', border: '1px solid var(--border-color)' }}>
        <p style={{ color: 'var(--accent-primary)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>SeatFlow</p>
        <h1 style={{ maxWidth: 680, fontSize: 'clamp(2rem, 5vw, 3.3rem)', lineHeight: 1.08, fontWeight: 850 }}>Campus events, with a fair way in.</h1>
        <div style={{ margin: '1rem 0 1.5rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <p>Find workshops, talks, and campus events.</p>
          <p>Join a first-in, first-out waitlist when seats fill.</p>
          <p>Get a timed offer when a seat opens up.</p>
        </div>
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
          <Link to="/signup" style={{ padding: '.7rem 1rem', background: 'var(--accent-primary)', color: '#fff', borderRadius: 'var(--radius-sm)', textDecoration: 'none', fontWeight: 700 }}>Sign up</Link>
          <a href="#events" style={{ padding: '.7rem 1rem', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', textDecoration: 'none', fontWeight: 700 }}>Browse events</a>
        </div>
      </section>

      <div id="events" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.85rem', fontWeight: 800 }}>Browse events</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Fair waitlists with automatic seat cascades for workshops and fest events.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '0.6rem 0.9rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: '#fff',
              minWidth: '220px',
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '0.6rem 1rem',
              background: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Search
          </button>
        </form>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          Loading events...
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#f87171',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
          }}
        >
          <h3>No events found</h3>
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Check back later or try adjusting your search keyword.
          </p>
        </div>
      )}

      {!loading && !error && events.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {events.map((ev) => (
          <Link
            key={ev._id}
            to={`/events/${ev._id}`}
            style={{
              display: 'block',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '1.5rem',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'var(--transition)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  background: ev.seatsLeft > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: ev.seatsLeft > 0 ? '#34d399' : '#fbbf24',
                }}
              >
                {ev.seatsLeft > 0 ? `${ev.seatsLeft} seats left` : 'Waitlist Active'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Cap: {ev.capacity}
              </span>
            </div>

            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              {ev.title}
            </h3>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineClamp: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {ev.description || 'No description provided.'}
            </p>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <div>📍 {ev.location || 'Campus'}</div>
              <div style={{ marginTop: '0.25rem' }}>
                🕒 {new Date(ev.startsAt).toLocaleDateString()} at{' '}
                {new Date(ev.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </Link>
        ))}
      </div>}
    </div>
  );
}
