import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { Home, Backpack, Grid2X2, Settings, LogOut, ShieldCheck, ShoppingBag } from 'lucide-react';
import {useState} from 'react';
import {useAuth} from '../auth/AuthProvider';
import {shouldShowAdminNavigation} from '../auth/admin-capabilities';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const {admin, logout} = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setLogoutFailed(false);
    try {
      await logout();
      navigate('/login', {replace: true});
    } catch {
      setLogoutFailed(true);
      setIsLoggingOut(false);
    }
  };

  const navItems = [
    { name: 'Home', path: '/dashboard', icon: Home },
    { name: 'Inventory', path: '/inventory', icon: Backpack },
    { name: 'Shop', path: '/shop', icon: ShoppingBag },
    { name: 'Study Board', path: '/board', icon: Grid2X2 },
    { name: 'Settings', path: '/settings', icon: Settings },
    ...(shouldShowAdminNavigation(admin)
      ? [{name: 'Admin', path: '/admin', icon: ShieldCheck}]
      : []),
  ];

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-100 overflow-hidden font-sans">
      {/* Sidebar for Desktop / Mobile */}
      <aside className="w-20 md:w-64 bg-[#0c0c0e] border-r border-slate-800 flex flex-col justify-between shrink-0 transition-all p-4 md:p-6">
        <div>
          <div className="flex items-center justify-center md:justify-start gap-3 mb-10">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white shrink-0 hidden md:flex">G</div>
            <h1 className="text-xl font-bold tracking-tight hidden md:block">Go Study</h1>
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white shrink-0 md:hidden">G</div>
          </div>
          
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={`flex items-center justify-center md:justify-start gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-indigo-500/10 text-indigo-400' 
                      : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <item.icon className="w-5 h-5 shrink-0 opacity-70 group-hover:scale-110 transition-transform" />
                  <span className="hidden md:block">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-800">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
            className="w-full flex items-center justify-center md:justify-start gap-3 px-3 py-2 rounded-md text-slate-400 hover:bg-slate-800 transition-colors group text-sm font-medium disabled:cursor-wait disabled:opacity-60"
          >
            <LogOut className="w-5 h-5 shrink-0 opacity-70 group-hover:scale-110 transition-transform" />
            <span className="hidden md:block">{isLoggingOut ? 'Logging out…' : 'Log out'}</span>
          </button>
          {logoutFailed && (
            <p className="hidden md:block mt-2 px-3 text-xs text-red-400">Logout failed. Please try again.</p>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-gradient-to-br from-[#09090b] via-[#09090b] to-[#1e1b4b10] flex flex-col">
        <div className="w-full h-full p-6 md:p-8 flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
