import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { UnreadProvider } from './context/UnreadContext';
import { CallProvider } from './context/CallContext';
import IncomingCallModal from './components/Calls/IncomingCallModal';
import ActiveCallModal from './components/Calls/ActiveCallModal';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import { MeetingProvider } from './context/MeetingContext';
import { MeetingPage } from './pages/MeetingPage';

const LoadingScreen: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div className="onboarding-page">
    <div className="auth-ambient" />
    <div className="onboarding-container">
      <h1>{message}</h1>
      <p className="onboarding-desc">Hang tight, we’re getting things ready.</p>
    </div>
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isReady } = useAuth();
  if (!isReady) return <LoadingScreen message="Preparing your workspace..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isReady } = useAuth();
  if (!isReady) return <LoadingScreen message="Preparing your session..." />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route
        path="/meet/:meetingCode"
        element={
          <ProtectedRoute>
            <MeetingProvider>
              <MeetingPage />
            </MeetingProvider>
          </ProtectedRoute>
        }
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <WorkspaceProvider>
              <UnreadProvider>
                <CallProvider>
                  <MeetingProvider>
                    <DashboardPage />
                    <IncomingCallModal />
                    <ActiveCallModal />
                  </MeetingProvider>
                </CallProvider>
              </UnreadProvider>
            </WorkspaceProvider>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
