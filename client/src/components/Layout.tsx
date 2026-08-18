import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Wrench, ClipboardList, CalendarDays, Wallet, FileBarChart, Settings as SettingsIcon,
  Menu, LogOut, Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/equipment', label: 'Equipment', icon: Wrench },
  { to: '/rentals', label: 'Rentals', icon: ClipboardList },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/payments', label: 'Payments', icon: Wallet },
];

const OWNER_NAV_ITEMS = [
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = user?.role === 'owner'
    ? [...NAV_ITEMS, ...OWNER_NAV_ITEMS]
    : NAV_ITEMS;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      <div
        className={`mobile-nav-overlay ${mobileNavOpen ? 'active' : ''}`}
        onClick={() => setMobileNavOpen(false)}
      />
      <div className="app-shell">
        <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
          <div className="sidebar-head">
            <div className="brand-mark"><Zap size={22} /></div>
            <div>
              <p className="eyebrow">Rental ERP</p>
              <h2>PowerOps</h2>
            </div>
          </div>
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setMobileNavOpen(false)}
              >
                <item.icon size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-footer">
            <p>Signed in as {user?.full_name} &middot; {user?.role}</p>
            <button type="button" className="ghost-button" onClick={handleLogout}>
              <LogOut size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
              Logout
            </button>
          </div>
        </aside>
        <main className="main-panel">
          <header className="topbar">
            <div className="topbar-title-wrap">
              <button
                type="button"
                className="mobile-nav-toggle"
                aria-label="Toggle navigation"
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                <Menu size={20} />
              </button>
              <div>
                <p className="eyebrow">Operations Center</p>
                <h1>{navItems.find((item) => item.to === location.pathname)?.label ?? 'Rental ERP'}</h1>
              </div>
            </div>
            <div className="topbar-actions">
              <div className="user-chip">{user?.full_name} &bull; {user?.role === 'owner' ? 'Owner' : 'Staff'}</div>
            </div>
          </header>
          <section className="content-area">
            <Outlet />
          </section>
        </main>
      </div>
    </>
  );
}
