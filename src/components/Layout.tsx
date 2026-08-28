import { Link, useLocation, Outlet } from 'react-router-dom';
import { Home, Backpack, Grid2X2, Settings, LogOut } from 'lucide-react';

export default function Layout() {
  const location = useLocation();

  const navItems = [
    { name: 'Home', path: '/dashboard', icon: Home },
    { name: 'Inventory', path: '/inventory', icon: Backpack },
    { name: 'Study Board', path: '/board', icon: Grid2X2, disabled: true },
    { name: 'Settings', path: '/settings', icon: Settings },
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
              return item.disabled ? (
                <div key={item.name} className="flex items-center justify-center md:justify-start gap-3 px-3 py-2 rounded-md text-slate-500 cursor-not-allowed group text-sm font-medium">
                  <item.icon className="w-5 h-5 shrink-0 opacity-50" />
                  <span className="hidden md:block font-medium">{item.name}</span>
                  <span className="hidden md:block ml-auto text-[10px] bg-slate-800 px-1.5 py-0.5 rounded uppercase tracking-wider">Soon</span>
                </div>
              ) : (
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
          <Link to="/" className="flex items-center justify-center md:justify-start gap-3 px-3 py-2 rounded-md text-slate-400 hover:bg-slate-800 transition-colors group text-sm font-medium">
            <LogOut className="w-5 h-5 shrink-0 opacity-70 group-hover:scale-110 transition-transform" />
            <span className="hidden md:block">Log out</span>
          </Link>
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
