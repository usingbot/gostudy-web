import {Navigate, Outlet} from 'react-router-dom';

import {useAuth} from './AuthProvider';

export default function RequireGuildPublishing() {
  const {admin, adminStatus, refreshAdmin} = useAuth();

  if (adminStatus === 'loading' || adminStatus === 'idle') {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-slate-400">
        Checking server access…
      </div>
    );
  }

  if (adminStatus === 'error') {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-slate-300">
        <p>We could not verify server access.</p>
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

  if (!admin?.capabilities.accessAdmin && !admin?.canManageGuildPublishing) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
