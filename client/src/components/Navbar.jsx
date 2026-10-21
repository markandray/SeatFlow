import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <span>⚡ SeatFlow</span>
        <span className="brand-badge">Session 2</span>
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <Link to="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
          Events
        </Link>

        {user && user.role === 'student' && (
          <Link
            to="/my-registrations"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            My Registrations
          </Link>
        )}

        {user && user.role === 'organizer' && (
          <Link
            to="/organizer/create"
            style={{
              background: 'var(--accent-primary)',
              color: '#fff',
              padding: '0.4rem 0.8rem',
              borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            + Create Event
          </Link>
        )}

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {user.name} ({user.role})
            </span>
            <button
              onClick={handleLogout}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                padding: '0.35rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              Logout
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Link
              to="/login"
              style={{
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Login
            </Link>
            <Link
              to="/signup"
              style={{
                background: 'var(--accent-primary)',
                color: '#fff',
                padding: '0.35rem 0.8rem',
                borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Sign Up
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
