import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// Layout components
import Layout from './components/layout/Layout';
import Navbar from './components/layout/Navbar';
import Sidebar from './components/layout/Sidebar';

// Page components
import Dashboard from './components/pages/Dashboard';
import ContractEditor from './components/pages/ContractEditor';
import ContractList from './components/pages/ContractList';
import ContractDetails from './components/pages/ContractDetails';
import DeploymentList from './components/pages/DeploymentList';
import DeploymentDetails from './components/pages/DeploymentDetails';
import Analytics from './components/pages/Analytics';
import Settings from './components/pages/Settings';
import Profile from './components/pages/Profile';
import Organizations from './components/pages/Organizations';

// Auth components
import AuthGuard from './components/auth/AuthGuard';
import LoginPage from './components/auth/LoginPage';

// Error components
import ErrorBoundary from './components/common/ErrorBoundary';
import NotFound from './components/common/NotFound';

// Utils
import { initializeAnalytics } from './utils/analytics';
import { setupErrorTracking } from './utils/errorTracking';
import { Storage } from './utils/storage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      cacheTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const App: React.FC = () => {
  useEffect(() => {
    initializeAnalytics();
    setupErrorTracking();

    // Load user preferences
    const theme = Storage.get('theme_settings');
    if (theme) {
      document.documentElement.className = theme.darkMode ? 'dark' : 'light';
      document.documentElement.style.fontSize = `${theme.fontSize}px`;
    }

    // Clean up on unmount
    return () => {
      queryClient.clear();
    };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <WalletProvider>
            <NotificationProvider>
              <BrowserRouter>
                <div className="min-h-screen bg-background dark:bg-background-dark">
                  <Routes>
                    {/* Public routes */}
                    <Route path="/login" element={<LoginPage />} />

                    {/* Protected routes */}
                    <Route element={<AuthGuard><Layout /></AuthGuard>}>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      
                      <Route path="/dashboard" element={
                        <ErrorBoundary>
                          <Dashboard />
                        </ErrorBoundary>
                      } />

                      <Route path="/contracts">
                        <Route index element={
                          <ErrorBoundary>
                            <ContractList />
                          </ErrorBoundary>
                        } />
                        <Route path="new" element={
                          <ErrorBoundary>
                            <ContractEditor />
                          </ErrorBoundary>
                        } />
                        <Route path=":id" element={
                          <ErrorBoundary>
                            <ContractDetails />
                          </ErrorBoundary>
                        } />
                        <Route path=":id/edit" element={
                          <ErrorBoundary>
                            <ContractEditor />
                          </ErrorBoundary>
                        } />
                      </Route>

                      <Route path="/deployments">
                        <Route index element={
                          <ErrorBoundary>
                            <DeploymentList />
                          </ErrorBoundary>
                        } />
                        <Route path=":id" element={
                          <ErrorBoundary>
                            <DeploymentDetails />
                          </ErrorBoundary>
                        } />
                      </Route>

                      <Route path="/analytics" element={
                        <ErrorBoundary>
                          <Analytics />
                        </ErrorBoundary>
                      } />

                      <Route path="/organizations" element={
                        <ErrorBoundary>
                          <Organizations />
                        </ErrorBoundary>
                      } />

                      <Route path="/profile" element={
                        <ErrorBoundary>
                          <Profile />
                        </ErrorBoundary>
                      } />

                      <Route path="/settings" element={
                        <ErrorBoundary>
                          <Settings />
                        </ErrorBoundary>
                      } />
                    </Route>

                    {/* 404 route */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>

                  {/* Global navigation */}
                  <Navbar />
                  <Sidebar />
                </div>
              </BrowserRouter>
            </NotificationProvider>
          </WalletProvider>
        </ThemeProvider>
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
