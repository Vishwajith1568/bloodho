import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
// Plex carries no Indic glyphs. Without these the Telugu and Hindi interface
// falls back to whatever the machine happens to have installed, and Telugu
// vowel signs shape incorrectly or not at all.
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/500.css';
import '@fontsource/noto-sans-devanagari/600.css';
import '@fontsource/noto-sans-telugu/400.css';
import '@fontsource/noto-sans-telugu/500.css';
import '@fontsource/noto-sans-telugu/600.css';
import './styles/tokens.css';
import './styles/shell.css';
import { SessionProvider, useSession, setLean } from './lib/api';
import { LangProvider } from './lib/i18n';
import SignIn from './portals/SignIn';
import RequesterPortal from './portals/requester';
import DonorPortal from './portals/donor';
import BankPortal from './portals/bank';
import AdminPortal from './portals/admin';

const HOME = { donor: '/donor', requester: '/request/new', bank: '/bank', admin: '/admin' };

function App() {
  const { account, loading } = useSession();
  const [lean, setLeanState] = useState(() => localStorage.getItem('bf_lean') === '1');

  useEffect(() => {
    document.body.classList.toggle('lean', lean);
    setLean(lean);
    localStorage.setItem('bf_lean', lean ? '1' : '0');
  }, [lean]);

  if (loading) return <div className="content"><div className="skel" style={{ width: 180 }} /></div>;
  if (!account) return <SignIn />;

  const props = { lean, onLean: setLeanState };
  return (
    <Routes>
      <Route path="/request/*" element={
        account.role === 'requester' ? <RequesterPortal {...props} /> : <Navigate to={HOME[account.role]} />} />
      <Route path="/donor/*" element={
        account.role === 'donor' ? <DonorPortal {...props} /> : <Navigate to={HOME[account.role]} />} />
      <Route path="/bank/*" element={
        account.role === 'bank' ? <BankPortal {...props} /> : <Navigate to={HOME[account.role]} />} />
      <Route path="/admin/*" element={
        account.role === 'admin' ? <AdminPortal {...props} /> : <Navigate to={HOME[account.role]} />} />
      <Route path="*" element={<Navigate to={HOME[account.role]} replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LangProvider><SessionProvider><App /></SessionProvider></LangProvider>
    </BrowserRouter>
  </StrictMode>
);
