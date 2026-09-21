import { useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import Dashboard from './components/Dashboard.jsx';
import ChannelView from './components/ChannelView.jsx';
import Editor from './components/Editor.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

function DocumentPage({ user }) {
  const navigate = useNavigate();
  return (
    <main className="document-page">
      <button className="text-button" onClick={() => navigate(-1)}>← Back</button>
      <div className="document-layout">
        <Editor user={user} />
        <HistoryPanel user={user} />
      </div>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('collab_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  function handleLogin(nextUser, token) {
    localStorage.setItem('collab_token', token);
    localStorage.setItem('collab_user', JSON.stringify(nextUser));
    setUser(nextUser);
  }

  function handleLogout() {
    localStorage.removeItem('collab_token');
    localStorage.removeItem('collab_user');
    setUser(null);
  }

  return (
    <Routes>
      <Route path="/login" element={<Login onLogin={handleLogin} />} />
      <Route path="/register" element={<Register onLogin={handleLogin} />} />
      <Route element={<ProtectedRoute user={user} />}>
        <Route path="/dashboard" element={<Dashboard user={user} onLogout={handleLogout} />} />
        <Route path="/channel/:channelId" element={<ChannelView user={user} />} />
        <Route path="/document/:documentId" element={<DocumentPage user={user} />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}
