import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import EventListPage from './pages/EventListPage';
import EventDetailPage from './pages/EventDetailPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import MyRegistrationsPage from './pages/MyRegistrationsPage';
import CreateEventPage from './pages/CreateEventPage';
import OrganizerDashboardPage from './pages/OrganizerDashboardPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="app-container">
          <Navbar />
          <main style={{ flex: 1, paddingBottom: '3rem' }}>
            <Routes>
              <Route path="/" element={<EventListPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/my-registrations" element={<MyRegistrationsPage />} />
              <Route path="/organizer/create" element={<CreateEventPage />} />
              <Route path="/organizer" element={<OrganizerDashboardPage />} />
            </Routes>
          </main>
          <footer className="footer">
            SeatFlow &copy; {new Date().getFullYear()} &bull; Fair Event Registration with Deterministic Waitlist
          </footer>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
