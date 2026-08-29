import {Navigate, Outlet} from 'react-router-dom';

import {useAuth} from './AuthProvider';

export default function RequireAdmin() {
  const {admin, adminStatus, refreshAdmin} = useAuth();

  if (adminStatus === 'loading' || adminStatus === 'idle') {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-slate-400">
        Checking admin access…
      </div>
    );
  }

  if (adminStatus === 'error') {
    return (
      <div className="min-h-[400px] flex flex-col gap-4 items-center justify-center text-slate-300">
        <p>We could not verify admin access.</p>
        <button
          type="button"
          onClick={() => void refreshAdmin()}
          className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!admin?.capabilities.accessAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
