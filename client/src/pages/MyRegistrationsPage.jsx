import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import usePolling from '../hooks/usePolling';

const activeStatuses = ['WAITLISTED', 'OFFERED', 'CONFIRMED'];

export default function MyRegistrationsPage() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [, setClock] = useState(Date.now());

  const fetchRegistrations = useCallback(async () => {
    try {
      const data = await api.getMyRegistrations();
      setRegistrations(data.registrations || []);
      setFetchedAt(Date.now());
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load registrations');
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(fetchRegistrations, 5000);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleAction = async (id, action) => {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      if (action === 'claim') await api.claimOffer(id);
      else if (action === 'decline') await api.declineOffer(id);
      else await api.cancelRegistration(id);
      setMessage(action === 'claim' ? 'Offer claimed. Your seat is confirmed.' : 'Registration updated.');
      await fetchRegistrations();
    } catch (err) {
      setError(err.message || 'Could not update registration');
      await fetchRegistrations();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ maxWidth: '840px', margin: '2rem auto', padding: '0 1.5rem' }}>
      <h1 style={{ fontSize: '1.85rem', fontWeight: 800 }}>My Registrations</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Waitlist positions and offers refresh every five seconds while this tab is visible.
      </p>

      {error && <div role="alert" style={{ color: '#f87171', padding: '0.8rem 0' }}>{error}</div>}
      {message && <div role="status" style={{ color: '#34d399', padding: '0.8rem 0' }}>{message}</div>}
      {loading && <p>Loading your registrations…</p>}
      {!loading && registrations.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
          <h3>No registrations yet</h3>
          <Link to="/">Explore events</Link>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {registrations.map((reg) => {
          const event = reg.eventId;
          const remaining = reg.offerExpiresAt && reg.serverTime
            ? Math.max(0, Date.parse(reg.offerExpiresAt) - Date.parse(reg.serverTime) - (Date.now() - fetchedAt))
            : null;
          const countdown = remaining === null
            ? ''
            : `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
          const isBusy = Boolean(busyId);

          return (
            <section key={reg._id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h3>
                    <Link to={`/events/${event?._id || event}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                      {event?.title || 'Event registration'}
                    </Link>
                  </h3>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {reg.status === 'WAITLISTED' && `Waitlisted · position #${reg.position ?? '?'}`}
                    {reg.status === 'OFFERED' && `Offer available · expires in ${countdown}`}
                    {reg.status === 'CONFIRMED' && 'Confirmed'}
                    {!activeStatuses.includes(reg.status) && reg.status}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {reg.status === 'OFFERED' && (
                    <>
                      <button disabled={isBusy || remaining === 0} onClick={() => handleAction(reg._id, 'claim')}>Claim</button>
                      <button disabled={isBusy} onClick={() => handleAction(reg._id, 'decline')}>Decline</button>
                    </>
                  )}
                  {activeStatuses.includes(reg.status) && (
                    <button disabled={isBusy} onClick={() => handleAction(reg._id, 'cancel')}>
                      {reg.status === 'WAITLISTED' ? 'Cancel' : 'Cancel registration'}
                    </button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
