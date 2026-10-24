import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section style={{ maxWidth: 680, margin: '5rem auto', padding: '0 1.5rem', textAlign: 'center' }}>
      <p style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>404</p>
      <h1>Page not found</h1>
      <p style={{ color: 'var(--text-secondary)' }}>That page may have moved, or the address may be incorrect.</p>
      <Link to="/" style={{ display: 'inline-block', marginTop: '1rem', color: 'var(--accent-primary)' }}>Browse events</Link>
    </section>
  );
}
