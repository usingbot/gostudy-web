import {BookOpen, Compass, LayoutDashboard, LogIn} from 'lucide-react';
import {Link, NavLink, Outlet} from 'react-router-dom';

import {useAuth} from '../auth/AuthProvider';

export default function PublicLayout() {
  const {status} = useAuth();
  const isAuthenticated = status === 'authenticated';

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-50 selection:bg-indigo-500/30">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#09090b]/85 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 md:px-8" aria-label="Public navigation">
          <Link to="/" className="flex items-center gap-3 font-bold tracking-tight text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-950/40">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>Go Study</span>
          </Link>

          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
            <NavLink
              to="/"
              end
              className={({isActive}) => `rounded-full px-4 py-2 text-sm font-medium transition ${isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Home
            </NavLink>
            <NavLink
              to="/servers"
              className={({isActive}) => `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${isActive ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-white'}`}
            >
              <Compass className="h-4 w-4" aria-hidden="true" /> Servers
            </NavLink>
          </div>

          <Link
            to={isAuthenticated ? '/dashboard' : '/login'}
            className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-sm font-semibold text-[#09090b] transition hover:bg-slate-200"
          >
            {isAuthenticated
              ? <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              : <LogIn className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">
              {isAuthenticated ? 'Dashboard' : status === 'loading' ? 'Account' : 'Log in'}
            </span>
          </Link>
        </nav>
      </header>

      <Outlet />

      <footer className="border-t border-white/10 px-6 py-8 text-center text-sm text-slate-500">
        Study-first communities, discovered through Go Study.
      </footer>
    </div>
  );
}
