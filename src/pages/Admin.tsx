import {useEffect, useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {History, Search, ServerCog, ShieldCheck, UserRoundSearch} from 'lucide-react';

import {
  AdminApiError,
  fetchRoleAudit,
  searchAdminUser,
} from '../api/admin';
import {useAuth} from '../auth/AuthProvider';
import type {AdminUserSummary, RoleAuditPage} from '../types';

function displayIdentity(user: AdminUserSummary): string {
  if (!user.identity) {
    return 'Identity not currently known';
  }
  return user.identity.globalName ?? `@${user.identity.username}`;
}

export default function Admin() {
  const {admin} = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminUserSummary | null>(null);
  const [audit, setAudit] = useState<RoleAuditPage | null>(null);
  const [auditFailed, setAuditFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchRoleAudit(undefined, controller.signal)
      .then(setAudit)
      .catch(() => {
        if (!controller.signal.aborted) {
          setAuditFailed(true);
        }
      });
    return () => controller.abort();
  }, []);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    setResult(null);
    try {
      setResult(await searchAdminUser(query));
    } catch (error) {
      setSearchError(
        error instanceof AdminApiError && error.status === 400
          ? 'Enter a canonical positive Discord user ID.'
          : 'User lookup failed. Please try again.',
      );
    } finally {
      setSearching(false);
    }
  };

  if (!admin) {
    return null;
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-indigo-300">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Administrative access</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Panel</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Search by exact Discord ID, inspect Chalk, and manage roles within your current permissions.
          </p>
        </div>
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm">
          Signed in as <span className="font-bold capitalize text-indigo-300">{admin.role}</span>
        </div>
      </header>

      <Link
        to="/admin/servers"
        className="flex items-center justify-between rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5 transition hover:border-indigo-400/60"
      >
        <span className="flex items-center gap-3">
          <span className="rounded-xl bg-indigo-500/15 p-2 text-indigo-300"><ServerCog className="h-5 w-5" /></span>
          <span>
            <span className="block font-semibold">Guild Publishing</span>
            <span className="mt-1 block text-xs text-slate-400">Configure visibility, slugs, invites, and tags for authorized Discord servers.</span>
          </span>
        </span>
        <span className="text-sm font-semibold text-indigo-300">Open</span>
      </Link>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-800 bg-[#18181b] p-6 lg:col-span-2">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-300">
              <UserRoundSearch className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">Exact Discord ID lookup</h2>
              <p className="text-xs text-slate-500">This does not verify membership in a Discord server.</p>
            </div>
          </div>
          <form onSubmit={(event) => void handleSearch(event)} className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="admin-user-query">Discord user ID</label>
            <input
              id="admin-user-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Discord user ID"
              inputMode="numeric"
              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none transition focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={searching}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-60"
            >
              <Search className="h-4 w-4" />
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
          {searchError && <p className="mt-3 text-sm text-red-400">{searchError}</p>}
          {result && (
            <button
              type="button"
              onClick={() => navigate(`/admin/users/${result.userid}`)}
              className="mt-5 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left hover:border-indigo-500/60"
            >
              <span>
                <span className="block font-medium">{displayIdentity(result)}</span>
                <span className="mt-1 block font-mono text-xs text-slate-500">{result.userid}</span>
              </span>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold capitalize text-slate-300">
                {result.role}
              </span>
            </button>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#18181b] p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-400">Capabilities</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Adjust Chalk</span><span className="text-emerald-400">Yes</span></li>
            <li className="flex justify-between"><span>Manage testers</span><span className="text-emerald-400">Yes</span></li>
            <li className="flex justify-between"><span>Manage admins</span><span className={admin.capabilities.manageAdmin ? 'text-emerald-400' : 'text-slate-500'}>{admin.capabilities.manageAdmin ? 'Yes' : 'No'}</span></li>
            <li className="flex justify-between"><span>Manage owners</span><span className="text-slate-500">No</span></li>
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-[#18181b] p-6">
        <div className="mb-5 flex items-center gap-3">
          <History className="h-5 w-5 text-indigo-300" />
          <div>
            <h2 className="font-semibold">Recent role activity</h2>
            <p className="text-xs text-slate-500">Identity labels are best-known from active website sessions only.</p>
          </div>
        </div>
        {auditFailed ? (
          <p className="text-sm text-red-400">Role activity could not be loaded.</p>
        ) : !audit ? (
          <p className="text-sm text-slate-500">Loading role activity…</p>
        ) : audit.items.length === 0 ? (
          <p className="text-sm text-slate-500">No role changes have been recorded.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {audit.items.map((event) => (
              <div key={event.auditId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link to={`/admin/users/${event.targetUserId}`} className="font-mono text-sm text-indigo-300 hover:underline">
                    {event.targetUserId}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">{event.reason}</p>
                </div>
                <div className="text-xs text-slate-400">
                  <span className="capitalize">{event.oldRole}</span>
                  {' → '}
                  <span className="capitalize text-slate-200">{event.newRole}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
