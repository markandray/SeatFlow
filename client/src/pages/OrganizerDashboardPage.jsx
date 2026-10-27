import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import usePolling from '../hooks/usePolling';

const inputStyle = {
  width: '100%',
  padding: '0.55rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
};

function toLocalInput(value) {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}

export default function OrganizerDashboardPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [attendees, setAttendees] = useState(null);
  const [audit, setAudit] = useState(null);
  const [auditPage, setAuditPage] = useState(1);
  const [panelLoading, setPanelLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState(null);
  const [cancelDialogEvent, setCancelDialogEvent] = useState(null);

  const loadEvents = useCallback(async () => {
    try {
      const result = await api.getOrganizerEvents();
      setEvents(result.events || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load organizer events');
    } finally {
      setLoading(false);
    }
  }, []);
  usePolling(loadEvents, 5000, user?.role === 'organizer');

  const selectedEvent = useMemo(() => events.find((event) => event._id === selectedId), [events, selectedId]);

  const loadPanels = async (eventId, page = auditPage) => {
    setPanelLoading(true);
    setError(null);
    try {
      const [attendeeResult, auditResult] = await Promise.all([
        api.getEventAttendees(eventId),
        api.getEventAudit(eventId, page),
      ]);
      setAttendees(attendeeResult);
      setAudit(auditResult);
      setAuditPage(page);
    } catch (err) {
      setError(err.message || 'Could not load event details');
    } finally {
      setPanelLoading(false);
    }
  };

  const runAction = async (key, action, success) => {
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await loadEvents();
      if (selectedId) await loadPanels(selectedId, auditPage);
      return true;
    } catch (err) {
      setError(err.message || 'Request failed');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const openEvent = async (event) => {
    setSelectedId(event._id);
    setAttendees(null);
    setAudit(null);
    await loadPanels(event._id, 1);
  };

  const startEdit = (event) => {
    setEditingId(event._id);
    setEditValues({
      title: event.title,
      description: event.description || '',
      location: event.location || '',
      capacity: event.capacity,
      startsAt: toLocalInput(event.startsAt),
      registrationDeadline: toLocalInput(event.registrationDeadline),
    });
  };

  const saveEdit = async (eventId) => {
    const values = { ...editValues, capacity: Number(editValues.capacity) };
    const saved = await runAction(`edit-${eventId}`, () => api.updateEvent(eventId, {
        ...values,
        startsAt: new Date(values.startsAt).toISOString(),
        registrationDeadline: new Date(values.registrationDeadline).toISOString(),
      }), 'Event updated.');
    if (saved) {
      setEditingId(null);
      setEditValues(null);
    }
  };

  if (!user || user.role !== 'organizer') {
    return <div style={{ maxWidth: 760, margin: '3rem auto', padding: '0 1.5rem' }}><h1>Organizer access required</h1><p>Sign in with an organizer account to manage events.</p></div>;
  }

  return (
    <div style={{ maxWidth: 1100, margin: '2rem auto', padding: '0.75rem 1.5rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.85rem', fontWeight: 800 }}>Organizer Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage your events, attendees, and audit history.</p>
        </div>
        <Link to="/organizer/create" style={{ padding: '0.65rem 1rem', background: 'var(--accent-primary)', color: '#fff', borderRadius: 'var(--radius-sm)', textDecoration: 'none', fontWeight: 700 }}>Create event</Link>
      </div>

      {error && <div role="alert" style={{ margin: '1rem 0', color: '#f87171', background: 'rgba(239,68,68,.1)', padding: '0.85rem', borderRadius: 'var(--radius-sm)' }}>{error}</div>}
      {message && <div role="status" style={{ margin: '1rem 0', color: '#34d399', background: 'rgba(16,185,129,.1)', padding: '0.85rem', borderRadius: 'var(--radius-sm)' }}>{message}</div>}
      {loading && <p>Loading your events…</p>}
      {!loading && events.length === 0 && <div style={{ marginTop: '1.5rem', padding: '2rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>You have not created any events yet.</div>}

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.25rem' }}>
        {events.map((event) => (
          <section key={event._id} style={{ padding: '1.25rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            {editingId === event._id && event.status === 'CANCELLED' ? (
              <div role="status" style={{ display: 'grid', gap: '.5rem' }}>
                <strong>Cancelled events cannot be edited</strong>
                <Link to="/organizer">Back to dashboard</Link>
              </div>
            ) : editingId === event._id ? (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {['title', 'description', 'location', 'capacity', 'startsAt', 'registrationDeadline'].map((field) => (
                  <label key={field} style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {field === 'startsAt' ? 'Starts at' : field === 'registrationDeadline' ? 'Registration deadline' : field[0].toUpperCase() + field.slice(1)}
                    <input
                      style={inputStyle}
                      type={field === 'startsAt' || field === 'registrationDeadline' ? 'datetime-local' : field === 'capacity' ? 'number' : 'text'}
                      min={field === 'capacity' ? 1 : undefined}
                      value={editValues[field]}
                      onChange={(e) => setEditValues((current) => ({ ...current, [field]: e.target.value }))}
                      disabled={busyKey === `edit-${event._id}`}
                    />
                  </label>
                ))}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="button-primary" disabled={busyKey === `edit-${event._id}`} onClick={() => saveEdit(event._id)}>Save changes</button>
                  <button className="button-secondary" disabled={busyKey === `edit-${event._id}`} onClick={() => { setEditingId(null); setEditValues(null); }}>Discard</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ fontSize: '1.2rem' }}>{event.title}</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>
                      {event.status === 'CANCELLED' ? <span className="status-badge status-badge-cancelled">Cancelled</span> : event.status}
                      {' · '}{new Date(event.startsAt).toLocaleString()}
                    </p>
                    <p style={{ color: 'var(--text-secondary)' }}>
                      Confirmed {event.counts.confirmed} · Checked in {event.counts.checkedIn} · Offered {event.counts.offered} · Waitlisted {event.counts.waitlisted} · Seats left {event.seatsLeft}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {event.status !== 'CANCELLED' && <button className="button-secondary" disabled={Boolean(busyKey)} onClick={() => startEdit(event)}>Edit</button>}
                    {event.status === 'DRAFT' && <button className="button-primary" disabled={Boolean(busyKey)} onClick={() => runAction(`publish-${event._id}`, () => api.publishEvent(event._id), 'Event published.')}>Publish</button>}
                    {event.status !== 'CANCELLED' && <button className="button-danger" disabled={Boolean(busyKey)} onClick={() => setCancelDialogEvent(event)}>Cancel event</button>}
                    {(event.status === 'PUBLISHED' || event.status === 'CANCELLED') && <button className="button-secondary" disabled={panelLoading} onClick={() => openEvent(event)}>Attendees & audit</button>}
                  </div>
                </div>
              </>
            )}
          </section>
        ))}
      </div>

      {selectedEvent && (
        <section style={{ marginTop: '2rem', padding: '1.25rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
            <h2>{selectedEvent.title}: attendees and audit log</h2>
            <button className="button-secondary" disabled={panelLoading} onClick={() => { setSelectedId(null); setAttendees(null); setAudit(null); }}>Close</button>
          </div>
          {panelLoading && <p>Refreshing attendees and audit log…</p>}
          {attendees && (
            <>
              <p style={{ color: 'var(--text-secondary)' }}>
                Confirmed {attendees.counts.confirmed} · Checked in {attendees.counts.checkedIn} · Offered {attendees.counts.offered} · Waitlisted {attendees.counts.waitlisted} · Seats left {attendees.counts.seatsLeft}
              </p>
              {Object.entries(attendees.groups).length === 0 && <p>No registrations yet.</p>}
              {Object.entries(attendees.groups).map(([status, registrations]) => (
                <div key={status} style={{ marginTop: '1rem' }}>
                  <h3>{status} ({registrations.length})</h3>
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {registrations.map((registration) => {
                      const tooEarly = new Date(selectedEvent.startsAt) > new Date();
                      return (
                        <div key={registration._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '0.65rem', borderBottom: '1px solid var(--border-color)' }}>
                          <span>{registration.userId?.name} · {registration.userId?.email}</span>
                          <span style={{ display: 'flex', gap: '0.5rem' }}>
                            {selectedEvent.status !== 'CANCELLED' && status === 'CONFIRMED' && <button className="button-secondary" disabled={Boolean(busyKey)} onClick={() => runAction(`checkin-${registration._id}`, () => api.checkInRegistration(registration._id), 'Attendee checked in.')}>Check in</button>}
                            {selectedEvent.status !== 'CANCELLED' && status === 'CONFIRMED' && (
                              <span title={tooEarly ? 'No-show can be recorded after the event starts' : undefined}>
                                <button
                                  className="button-secondary"
                                  title={tooEarly ? 'No-show can be recorded after the event starts' : 'Mark attendee as no-show'}
                                  disabled={Boolean(busyKey) || tooEarly}
                                  onClick={() => runAction(`noshow-${registration._id}`, () => api.markNoShow(registration._id), 'Attendee marked no-show.')}
                                >Mark no-show</button>
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}

          {audit && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3>Audit log</h3>
              {audit.logs.length === 0 && <p>No audit entries yet.</p>}
              {audit.logs.map((entry) => (
                <div key={entry._id} style={{ padding: '0.65rem 0', borderBottom: '1px solid var(--border-color)' }}>
                  <strong>{entry.action}</strong> · {entry.actorId?.name || 'System'} · {new Date(entry.createdAt).toLocaleString()}
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center' }}>
                <button className="button-secondary" disabled={audit.page <= 1 || panelLoading} onClick={() => loadPanels(selectedEvent._id, audit.page - 1)}>Previous</button>
                <span>Page {audit.page} of {Math.max(1, audit.totalPages)}</span>
                <button className="button-secondary" disabled={audit.page >= audit.totalPages || panelLoading} onClick={() => loadPanels(selectedEvent._id, audit.page + 1)}>Next</button>
              </div>
            </div>
          )}
        </section>
      )}

      {cancelDialogEvent && (
        <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(2, 6, 23, .72)' }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="cancel-event-title" style={{ width: 'min(440px, 100%)', padding: '1.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: '0 20px 50px rgba(0, 0, 0, .45)' }}>
            <h2 id="cancel-event-title" style={{ fontSize: '1.2rem', marginBottom: '.5rem' }}>Cancel event?</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Cancel “{cancelDialogEvent.title}” and notify all registered students?</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
              <button className="button-secondary" disabled={Boolean(busyKey)} onClick={() => setCancelDialogEvent(null)}>Keep event</button>
              <button className="button-danger" disabled={Boolean(busyKey)} onClick={() => {
                const eventToCancel = cancelDialogEvent;
                setCancelDialogEvent(null);
                runAction(`cancel-${eventToCancel._id}`, () => api.cancelEvent(eventToCancel._id), 'Event cancelled.');
              }}>Confirm cancellation</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
