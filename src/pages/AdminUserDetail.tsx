import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {Link, useParams} from 'react-router-dom';
import {
  ArrowLeft,
  BadgeMinus,
  BadgePlus,
  Coins,
  History,
  Shield,
  UserRound,
  X,
} from 'lucide-react';

import {
  adjustChalk,
  AdminApiError,
  changeAdminUserRole,
  fetchAdminUser,
} from '../api/admin';
import type {
  AdminUserDetail as AdminUserDetailData,
  ChalkMutationResult,
  UserRole,
} from '../types';

type AdjustmentKind = 'grant' | 'deduct';

interface AdjustmentSubmission {
  amount: string;
  reason: string;
  requestId: string;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not yet created';
}

function transactionLabel(type: string): string {
  return type.replaceAll('_', ' ');
}

function AdjustmentDialog({
  kind,
  userId,
  onClose,
  onApplied,
}: {
  kind: AdjustmentKind;
  userId: string;
  onClose: () => void;
  onApplied: (result: ChalkMutationResult) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockedSubmission, setLockedSubmission] = useState<AdjustmentSubmission | null>(null);
  const submissionRef = useRef<AdjustmentSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChalkMutationResult | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || result) {
      return;
    }

    const submission = submissionRef.current ?? {
      amount,
      reason,
      requestId: crypto.randomUUID(),
    };
    submissionRef.current = submission;
    setLockedSubmission(submission);
    setSubmitting(true);
    setError(null);

    try {
      const response = await adjustChalk(kind, userId, submission);
      submissionRef.current = null;
      setResult(response);
      await onApplied(response);
    } catch (requestError) {
      const apiError = requestError instanceof AdminApiError ? requestError : null;
      const outcomeUnknown = !apiError || apiError.status === 0 || apiError.status >= 500;
      if (!outcomeUnknown) {
        submissionRef.current = null;
        setLockedSubmission(null);
      }
      if (apiError?.code === 'INSUFFICIENT_CHALK') {
        setError('This deduction would make the balance negative.');
      } else if (apiError?.code === 'IDEMPOTENCY_CONFLICT') {
        setError('That request ID was already used with different details. Start a new adjustment.');
      } else if (outcomeUnknown) {
        setError('The result is unknown. Retry to safely reuse the same request ID.');
      } else {
        setError('The adjustment was rejected. Review the amount and reason.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const title = kind === 'grant' ? 'Grant Chalk' : 'Deduct Chalk';
  const locked = lockedSubmission !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="chalk-dialog-title"
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#18181b] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-5">
          <h2 id="chalk-dialog-title" className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4 p-5">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
            Confirm target: <span className="font-mono font-bold">{userId}</span>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Amount</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={locked || Boolean(result)}
              inputMode="numeric"
              placeholder="10"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-500 disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Reason</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={locked || Boolean(result)}
              maxLength={500}
              rows={3}
              placeholder="Required audit reason"
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-500 disabled:opacity-60"
            />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {result && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              {result.replayed ? 'The original adjustment was safely replayed.' : 'The adjustment was applied.'}
              {' '}Current balance: {result.account.balance} Chalk.
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button
                type="submit"
                disabled={submitting}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${kind === 'grant' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-rose-600 hover:bg-rose-500'}`}
              >
                {submitting ? 'Submitting…' : locked ? 'Retry safely' : `Confirm ${kind}`}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function RoleControl({
  user,
  onChanged,
}: {
  user: AdminUserDetailData;
  onChanged: () => Promise<void>;
}) {
  const [role, setRole] = useState<UserRole>(user.manageableRoles[0] ?? 'user');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setRole(user.manageableRoles[0] ?? 'user');
  }, [user.manageableRoles]);

  if (user.manageableRoles.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No role changes are available for this user under your current permissions.
      </p>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await changeAdminUserRole(user.userid, {
        expectedRole: user.role,
        role,
        reason,
      });
      setMessage(result.changed ? 'Role changed and audited.' : 'The requested role was already active.');
      await onChanged();
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 'ROLE_CHANGED') {
        setMessage('The role changed elsewhere. The user details have been refreshed.');
        await onChanged();
      } else if (error instanceof AdminApiError && error.code === 'ROLE_NOT_ALLOWED') {
        setMessage('Your current role does not permit that transition.');
      } else {
        setMessage('Role change failed safely.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1.5 block text-slate-400">New role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 capitalize outline-none focus:border-indigo-500"
          >
            {user.manageableRoles.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block text-slate-400">Reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Required audit reason"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-indigo-500"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-60"
      >
        {submitting ? 'Saving…' : 'Change role'}
      </button>
      {message && <p className="text-sm text-slate-300">{message}</p>}
    </form>
  );
}

export default function AdminUserDetail() {
  const {userid = ''} = useParams();
  const [user, setUser] = useState<AdminUserDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState<AdjustmentKind | null>(null);

  const loadUser = useCallback(async () => {
    setError(null);
    try {
      setUser(await fetchAdminUser(userid));
    } catch (requestError) {
      setError(
        requestError instanceof AdminApiError && requestError.status === 400
          ? 'That Discord user ID is invalid.'
          : 'User details could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [userid]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  if (loading) {
    return <div className="flex min-h-[400px] items-center justify-center text-slate-400">Loading admin user details…</div>;
  }

  if (!user || error) {
    return (
      <div className="space-y-5">
        <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-indigo-300 hover:underline"><ArrowLeft className="h-4 w-4" />Back to Admin</Link>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center text-red-300">{error ?? 'User details unavailable.'}</div>
      </div>
    );
  }

  const identity = user.identity;
  const avatarUrl = identity?.avatarHash
    ? `https://cdn.discordapp.com/avatars/${user.userid}/${identity.avatarHash}.png?size=128`
    : null;

  return (
    <div className="space-y-6 pb-10">
      <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-indigo-300 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Admin
      </Link>

      <header className="flex flex-col gap-5 rounded-2xl border border-slate-800 bg-[#18181b] p-6 sm:flex-row sm:items-center">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Discord avatar" className="h-20 w-20 rounded-2xl" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-800 text-slate-400"><UserRound className="h-9 w-9" /></div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">{identity ? `@${identity.username}` : 'Identity not currently known'}</p>
          <h1 className="truncate text-2xl font-bold">{identity?.globalName ?? identity?.username ?? 'Unknown Discord identity'}</h1>
          <p className="mt-2 break-all font-mono text-sm text-indigo-300">{user.userid}</p>
        </div>
        <span className="self-start rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-sm font-semibold capitalize text-indigo-300">{user.role}</span>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['Balance', user.chalkAccount.balance],
          ['Lifetime credited', user.chalkAccount.lifetimeCredited],
          ['Lifetime debited', user.chalkAccount.lifetimeDebited],
        ].map(([label, value]) => (
          <section key={label} className="rounded-2xl border border-slate-800 bg-[#18181b] p-5">
            <div className="mb-3 flex items-center gap-2 text-amber-300"><Coins className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-widest">{label}</span></div>
            <p className="break-all text-3xl font-black">{value}</p>
            <p className="mt-2 text-xs text-slate-500">Chalk</p>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-[#18181b] p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Chalk administration</h2>
            <p className="mt-1 text-xs text-slate-500">Account last updated: {formatTimestamp(user.chalkAccount.updatedAt)}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdjustment('grant')} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"><BadgePlus className="h-4 w-4" />Grant</button>
            <button type="button" onClick={() => setAdjustment('deduct')} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-500"><BadgeMinus className="h-4 w-4" />Deduct</button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#18181b] p-6">
        <div className="mb-5 flex items-center gap-2"><Shield className="h-5 w-5 text-indigo-300" /><h2 className="font-semibold">Role management</h2></div>
        <RoleControl user={user} onChanged={loadUser} />
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#18181b] p-6">
        <div className="mb-5 flex items-center gap-2"><History className="h-5 w-5 text-indigo-300" /><h2 className="font-semibold">Recent Chalk transactions</h2></div>
        {user.chalkHistory.items.length === 0 ? (
          <p className="text-sm text-slate-500">No Chalk transactions have been recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr><th className="pb-3">ID</th><th className="pb-3">Type</th><th className="pb-3">Amount</th><th className="pb-3">Balance</th><th className="pb-3">Actor</th><th className="pb-3">Reason</th><th className="pb-3">Time</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {user.chalkHistory.items.map((transaction) => (
                  <tr key={transaction.transactionId}>
                    <td className="py-3 font-mono text-xs text-slate-500">{transaction.transactionId}</td>
                    <td className="py-3 capitalize">{transactionLabel(transaction.transactionType)}</td>
                    <td className={`py-3 font-semibold ${transaction.amount.startsWith('-') ? 'text-rose-400' : 'text-emerald-400'}`}>{transaction.amount}</td>
                    <td className="py-3">{transaction.balanceAfter}</td>
                    <td className="py-3 font-mono text-xs">{transaction.actorUserId ?? 'system'}</td>
                    <td className="max-w-[240px] truncate py-3 text-slate-400" title={transaction.reason ?? undefined}>{transaction.reason ?? '—'}</td>
                    <td className="py-3 text-xs text-slate-500">{formatTimestamp(transaction.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adjustment && (
        <AdjustmentDialog
          kind={adjustment}
          userId={user.userid}
          onClose={() => setAdjustment(null)}
          onApplied={async () => loadUser()}
        />
      )}
    </div>
  );
}
