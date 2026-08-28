import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Star} from 'lucide-react';
import {motion} from 'motion/react';

import {ApiError, fetchDashboard} from '../api/productData';
import {useAuth} from '../auth/AuthProvider';
import {renderRewardAsset} from '../components/IconMap';
import type {DashboardData} from '../types';

function formatVerifiedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatMilestoneTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export default function Dashboard() {
  const {user, refresh} = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadFailed(false);
    fetchDashboard(controller.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          void refresh();
          return;
        }
        setLoadFailed(true);
      });
    return () => controller.abort();
  }, [refresh, requestVersion]);

  const progressPercent = data ? (data.progressSeconds / 3600) * 100 : 0;
  const displayName = user?.globalName ?? user?.username ?? 'student';

  return (
    <div className="flex-1 flex flex-col w-full h-full min-h-0">
      <header className="flex flex-col md:flex-row justify-between md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold">Study Dashboard</h2>
          <p className="text-slate-500 text-sm">Welcome back, {displayName}! Keep up the great work today.</p>
        </div>
        <div className="flex gap-4">
          <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-lg shadow-lg shadow-indigo-500/20 transition-all">Open Discord</button>
        </div>
      </header>

      {loadFailed ? (
        <div className="flex-1 min-h-[500px] rounded-2xl border border-slate-800 bg-[#18181b] flex flex-col items-center justify-center gap-4 text-slate-400">
          <p>We could not load your study data.</p>
          <button
            type="button"
            onClick={() => setRequestVersion((version) => version + 1)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="flex-1 min-h-[500px] rounded-2xl border border-slate-800 bg-[#18181b] flex items-center justify-center text-slate-400">
          Loading your verified study data…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 md:grid-rows-6 gap-4 flex-1 h-full min-h-[500px]">
          <div className="md:col-span-8 md:row-span-3 bg-[#18181b] rounded-2xl p-6 border border-slate-800 flex flex-col justify-between relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Current Goal</h3>
              <p className="text-3xl font-light text-white mb-6">
                Next reward in <span className="font-bold text-indigo-400">{formatMilestoneTime(data.secondsToNextMilestone)}</span>
              </p>
              <div className="space-y-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400 font-medium">Progress toward next 60m milestone</span>
                  <span className="font-bold">{formatMilestoneTime(data.progressSeconds)} / 60m</span>
                </div>
                <div className="h-3 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <motion.div
                    initial={{width: 0}}
                    animate={{width: `${progressPercent}%`}}
                    transition={{duration: 1, ease: 'easeOut'}}
                    className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full"
                  />
                </div>
              </div>
            </div>
            <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl" />
          </div>

          <div className="md:col-span-4 md:row-span-3 bg-[#18181b] rounded-2xl p-6 border border-slate-800 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-500 mb-4 border border-amber-500/30">
              <Star className="w-8 h-8" fill="currentColor" />
            </div>
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Verified</h3>
            <p className="text-5xl font-black text-white">{data.completedHours}h</p>
            <p className="text-slate-500 text-xs mt-2">{formatVerifiedTime(data.verifiedSeconds)} verified study time</p>
          </div>

          <div className="md:col-span-12 md:row-span-3 bg-[#18181b] rounded-2xl p-6 border border-slate-800 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Recent Inventory</h3>
              <Link to="/inventory" className="text-xs text-indigo-400 font-bold hover:underline">View All</Link>
            </div>
            {data.recentInventory.length === 0 ? (
              <div className="flex-1 rounded-xl border border-dashed border-slate-800 flex items-center justify-center text-sm text-slate-500 text-center px-6">
                Your first verified hour will add a reward here.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
                {data.recentInventory.map((item, index) => (
                  <motion.div
                    whileHover={{scale: 1.02}}
                    key={item.hourRewardId}
                    title={item.description ?? item.displayName}
                    className={`rounded-xl p-4 border flex flex-col items-center justify-center group cursor-default transition-all ${
                      index === 0
                        ? 'bg-indigo-900/20 border-indigo-500/30 hover:border-indigo-500/50'
                        : 'bg-slate-900/50 border-slate-800 hover:border-indigo-500/50'
                    }`}
                  >
                    <div className={`mb-2 transition-all ${index === 0 ? 'text-indigo-400' : 'text-slate-400 group-hover:text-indigo-400'}`}>
                      {renderRewardAsset(item.assetKey, 'w-8 h-8')}
                    </div>
                    <p className={`text-[10px] font-bold uppercase text-center line-clamp-1 ${index === 0 ? 'text-indigo-400' : 'text-slate-500'}`}>{item.displayName}</p>
                    <span className={`text-[10px] mt-2 px-2 py-0.5 rounded ${index === 0 ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300'}`}>Hour {item.milestoneHour}</span>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
