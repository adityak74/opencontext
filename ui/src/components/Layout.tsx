import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Settings, MessageSquare, GitBranch, Download, LogOut, Brain, Layers, MessageCircle, Database, Map } from 'lucide-react';
import { useAuth } from '../store/auth';
import { Button } from '@/components/ui/button';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/preferences', icon: Settings, label: 'Preferences' },
  { to: '/conversations', icon: MessageSquare, label: 'Conversations' },
  { to: '/pipeline', icon: GitBranch, label: 'Pipeline' },
  { to: '/export', icon: Download, label: 'Export' },
  { to: '/contexts', icon: Brain, label: 'Contexts' },
  { to: '/bubbles', icon: Layers, label: 'Bubbles' },
  { to: '/chat', icon: MessageCircle, label: 'Start Chat' },
  { to: '/database', icon: Database, label: 'Database' },
  { to: '/roadmap', icon: Map, label: 'Roadmap' },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-3">
        <img src="/opencontext-logo.png" alt="open-context" className="w-6 h-6 rounded-sm" />
        <span className="text-sm font-semibold tracking-tight text-foreground flex-1">open-context</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-muted-foreground hover:text-foreground gap-1.5 ml-auto"
        >
          <LogOut size={14} />
          <span className="text-xs">Sign out</span>
        </Button>
      </header>

      <div className="flex flex-1">
        <nav className="w-48 min-w-48 border-r border-border px-2 py-3 flex flex-col gap-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`
              }
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
