import React, { useState, useEffect } from 'react';
import api from './services/api';

export default function App() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    api
      .getHealth()
      .then((data) => {
        if (isMounted) {
          setHealth(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="app-container">
      <header className="navbar">
        <a href="/" className="brand">
          <span>⚡ SeatFlow</span>
          <span className="brand-badge">Session 1</span>
        </a>
      </header>

      <main className="main-content">
        <div className="hero-card">
          <h1 className="hero-title">SeatFlow Foundation</h1>
          <p className="hero-subtitle">
            Capacity-safe event registration platform with deterministic FIFO waitlist and automated time-limited seat cascade.
          </p>

          {loading && (
            <div className="status-badge">
              <span className="status-dot"></span>
              Checking API Health...
            </div>
          )}

          {error && (
            <div className="status-badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
              API Offline ({error})
            </div>
          )}

          {health && (
            <div className="status-badge online">
              <span className="status-dot"></span>
              API Health: {health.status.toUpperCase()}
            </div>
          )}

          <div className="info-grid">
            <div className="info-item">
              <div className="info-label">Architecture</div>
              <div className="info-value">MVC + Services</div>
            </div>
            <div className="info-item">
              <div className="info-label">Auth Engine</div>
              <div className="info-value">JWT + Bcrypt</div>
            </div>
            <div className="info-item">
              <div className="info-label">Concurrency</div>
              <div className="info-value">Atomic Guarantees</div>
            </div>
            <div className="info-item">
              <div className="info-label">Server Time</div>
              <div className="info-value">
                {health?.serverTime ? new Date(health.serverTime).toLocaleTimeString() : 'Connecting...'}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        SeatFlow &copy; {new Date().getFullYear()} — Built with Express, MongoDB, & React
      </footer>
    </div>
  );
}
