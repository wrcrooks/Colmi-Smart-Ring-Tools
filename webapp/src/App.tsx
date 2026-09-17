import { NavLink, Route, Routes } from "react-router-dom";
import { ConnectionBar } from "./components/ConnectionBar";
import { DashboardPage } from "./pages/DashboardPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Colmi Ring Tools</h1>
        <nav className="app-nav">
          <NavLink to="/" end className={navClassName}>
            Dashboard
          </NavLink>
          <NavLink to="/history" className={navClassName}>
            History
          </NavLink>
          <NavLink to="/settings" className={navClassName}>
            Settings
          </NavLink>
        </nav>
      </header>

      <ConnectionBar />

      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
