import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './store/context';
import { AuthProvider } from './store/auth';
import Landing from './components/Landing';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import PreferencesEditor from './components/PreferencesEditor';
import ContextViewer from './components/ContextViewer';
import ConversionPipeline from './components/ConversionPipeline';
import VendorExport from './components/VendorExport';
import ContextsManager from './components/ContextsManager';
import BubblesManager from './components/BubblesManager';
import ChatWithContext from './components/ChatWithContext';
import DatabaseSettings from './components/DatabaseSettings';
import RoadmapPage from './components/RoadmapPage';
import './App.css';

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Landing />} />
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/preferences" element={<PreferencesEditor />} />
              <Route path="/conversations" element={<ContextViewer />} />
              <Route path="/pipeline" element={<ConversionPipeline />} />
              <Route path="/export" element={<VendorExport />} />
              <Route path="/contexts" element={<ContextsManager />} />
              <Route path="/bubbles" element={<BubblesManager />} />
              <Route path="/chat" element={<ChatWithContext />} />
              <Route path="/database" element={<DatabaseSettings />} />
              <Route path="/roadmap" element={<RoadmapPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </AuthProvider>
  );
}
