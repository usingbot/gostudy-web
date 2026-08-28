import { User, Lock } from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';

export default function Settings() {
  const {user} = useAuth();

  if (!user) {
    return null;
  }

  const avatarUrl = user.avatarHash
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatarHash}.png?size=128`
    : null;

  return (
    <div className="max-w-2xl space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50 mb-2">Settings</h1>
        <p className="text-slate-400 text-sm">Manage your profile and privacy preferences.</p>
      </div>

      <div className="space-y-6">
        <section className="bg-[#18181b] border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center gap-3 bg-slate-900/50">
            <User className="w-5 h-5 text-indigo-400" />
            <h2 className="font-semibold text-slate-200">Profile</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-4 pb-2">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Discord avatar"
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded-full"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-indigo-500/20 flex items-center justify-center text-xl font-bold text-indigo-300">
                  {user.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <p className="font-semibold text-slate-100">{user.globalName ?? user.username}</p>
                <p className="text-sm text-slate-400">@{user.username}</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
              <input 
                type="text" 
                disabled 
                value={user.username}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-slate-300 cursor-not-allowed" 
              />
              <p className="text-xs text-slate-500 mt-2">Synced automatically from Discord.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Discord user ID</label>
              <input
                type="text"
                disabled
                value={user.id}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-slate-300 cursor-not-allowed"
              />
            </div>
          </div>
        </section>

        <section className="bg-[#18181b] border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center gap-3 bg-slate-900/50">
            <Lock className="w-5 h-5 text-indigo-400" />
            <h2 className="font-semibold text-slate-200">Privacy & Display</h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-slate-200">Public Study Board</h3>
                <p className="text-sm text-slate-400">Allow others to see your collected rewards.</p>
              </div>
              <div className="w-12 h-6 bg-indigo-500 rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-slate-200">Activity Status</h3>
                <p className="text-sm text-slate-400">Show when you are currently studying.</p>
              </div>
              <div className="w-12 h-6 bg-slate-700 rounded-full relative cursor-pointer">
                <div className="absolute left-1 top-1 w-4 h-4 bg-slate-400 rounded-full" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
