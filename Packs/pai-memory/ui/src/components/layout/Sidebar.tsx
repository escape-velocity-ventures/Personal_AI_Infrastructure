import { NavLink } from 'react-router-dom';
import {
  Brain,
  LayoutDashboard,
  Search,
  BookOpen,
  Network,
  GitBranch,
  Upload,
  Download,
  Settings,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/memories', icon: BookOpen, label: 'Memories' },
  { to: '/entities', icon: Network, label: 'Entities' },
  { to: '/sources', icon: GitBranch, label: 'Sources' },
  { to: '/import', icon: Upload, label: 'Import' },
  { to: '/export', icon: Download, label: 'Export' },
];

export function Sidebar() {
  return (
    <aside className="flex w-56 flex-col bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2 px-4 py-5">
        <Brain className="h-6 w-6 text-violet-400" />
        <span className="text-lg font-semibold tracking-tight">Engram</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}

        <Separator className="my-2 bg-zinc-800" />

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100'
            )
          }
        >
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
      </nav>
    </aside>
  );
}
