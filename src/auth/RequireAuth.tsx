import {Navigate, Outlet, useLocation} from 'react-router-dom';

import {useAuth} from './AuthProvider';

export default function RequireAuth() {
  const {status, refresh} = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-slate-400">
        Checking your Discord session…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col gap-4 items-center justify-center text-slate-300">
        <p>We could not verify your session.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
        >
          Try again
        </button>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{from: location.pathname}} />;
  }

  return <Outlet />;
}
