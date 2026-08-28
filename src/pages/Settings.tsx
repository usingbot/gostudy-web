import { User, Lock } from 'lucide-react';

export default function Settings() {
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
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
              <input 
                type="text" 
                disabled 
                value="StudyGod42" 
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-slate-300 cursor-not-allowed" 
              />
              <p className="text-xs text-slate-500 mt-2">Synced automatically from Discord.</p>
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
