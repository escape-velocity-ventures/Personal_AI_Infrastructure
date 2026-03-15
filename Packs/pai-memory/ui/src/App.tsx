import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SearchPage } from './pages/SearchPage';
import { MemoriesPage } from './pages/MemoriesPage';
import { EntitiesPage } from './pages/EntitiesPage';
import { SourcesPage } from './pages/SourcesPage';
import { ImportPage } from './pages/ImportPage';
import { ExportPage } from './pages/ExportPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  if (!isAuthenticated) return <LoginPage />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/memories" element={<MemoriesPage />} />
        <Route path="/entities" element={<EntitiesPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AppShell>
  );
}
