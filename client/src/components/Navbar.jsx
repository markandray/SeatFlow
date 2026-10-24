import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import usePolling from '../hooks/usePolling';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [notificationError, setNotificationError] = useState(null);

  const loadNotifications = useCallback(async () => {
    if (user?.role !== 'student') return;
    try {
      const result = await api.getNotifications();
      setNotifications(result.notifications || []);
      setUnreadCount(result.unreadCount || 0);
      setNotificationError(null);
    } catch (err) {
      setNotificationError(err.message || 'Could not load notifications');
    }
  }, [user?.role]);
  usePolling(loadNotifications, 10000, user?.role === 'student');

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const markRead = async (notification) => {
    if (!notification.readAt) await api.markNotificationRead(notification._id);
    await loadNotifications();
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

        {user?.role === 'student' && (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
              aria-expanded={bellOpen}
              onClick={() => setBellOpen((open) => !open)}
              style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.65rem', cursor: 'pointer' }}
            >
              🔔 {unreadCount > 0 && <span>{unreadCount}</span>}
            </button>
            {bellOpen && (
              <div style={{ position: 'absolute', right: 0, top: '2.8rem', zIndex: 20, width: 'min(360px, 85vw)', maxHeight: '70vh', overflowY: 'auto', padding: '1rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: '0 12px 30px rgba(0,0,0,.35)' }}>
                <strong>Notifications</strong>
                {notificationError && <p role="alert" style={{ color: '#f87171' }}>{notificationError}</p>}
                {!notificationError && notifications.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No notifications yet.</p>}
                {notifications.map((notification) => (
                  <button
                    type="button"
                    key={notification._id}
                    onClick={() => markRead(notification)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 0', background: 'transparent', border: 0, borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', opacity: notification.readAt ? 0.7 : 1 }}
                  >
                    <span>{notification.readAt ? '○ ' : '● '}{notification.message}</span>
                    <small style={{ display: 'block', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{new Date(notification.createdAt).toLocaleString()}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {user && user.role === 'organizer' && (
          <>
            <Link to="/organizer" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Dashboard</Link>
            <Link to="/organizer/create" style={{ background: 'var(--accent-primary)', color: '#fff', padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-sm)', textDecoration: 'none', fontWeight: 600 }}>
              + Create Event
            </Link>
          </>
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
