import { useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, Link } from 'react-router-dom';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import Dashboard from './components/Dashboard.jsx';
import ChannelView from './components/ChannelView.jsx';
import Editor from './components/Editor.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Tooltip from './components/Tooltip.jsx';

function DocumentPage({ user, onLogout }) {
  const [documentUnavailable, setDocumentUnavailable] = useState(false);
  const [rightRailWidth, setRightRailWidth] = useState(() => {
    const saved = Number(localStorage.getItem('collab_right_rail_width'));
    return Number.isFinite(saved) && saved >= 290 && saved <= 560 ? saved : 380;
  });
  const documentLayoutRef = useRef(null);

  function resizeRightRail(event) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const layoutRight = documentLayoutRef.current?.getBoundingClientRect().right;
    if (!layoutRight) return;
    const nextWidth = Math.min(560, Math.max(290, Math.round(layoutRight - event.clientX)));
    setRightRailWidth(nextWidth);
    localStorage.setItem('collab_right_rail_width', String(nextWidth));
  }

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="document-layout" ref={documentLayoutRef} style={{ '--right-rail-width': `${rightRailWidth}px` }}>
        <Editor user={user} onDocumentUnavailable={setDocumentUnavailable} />
        {!documentUnavailable && <div
          className="layout-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize document tools panel"
          tabIndex={0}
          onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={resizeRightRail}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const nextWidth = Math.min(560, Math.max(290, rightRailWidth + (event.key === 'ArrowLeft' ? 20 : -20)));
            setRightRailWidth(nextWidth);
            localStorage.setItem('collab_right_rail_width', String(nextWidth));
          }}
        />}
        {!documentUnavailable && <HistoryPanel user={user} />}
      </div>
    </Layout>
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
    <>
    <Tooltip />
    <Routes>
      <Route path="/login" element={<Login onLogin={handleLogin} />} />
      <Route path="/register" element={<Register onLogin={handleLogin} />} />
      <Route element={<ProtectedRoute user={user} />}>
        <Route path="/dashboard" element={
          <Layout user={user} onLogout={handleLogout}>
            <Dashboard user={user} />
          </Layout>
        } />
        <Route path="/channel/:channelId" element={
          <Layout user={user} onLogout={handleLogout}>
            <ChannelView user={user} />
          </Layout>
        } />
        <Route path="/document/:documentId" element={<DocumentPage user={user} onLogout={handleLogout} />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
    </>
  );
}
