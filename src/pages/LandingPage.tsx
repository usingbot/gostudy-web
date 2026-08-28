import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ShieldCheck, Video, Users } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-slate-50 font-sans selection:bg-indigo-500/30">
      {/* Nav */}
      <nav className="flex items-center justify-between p-6 md:px-12 max-w-7xl mx-auto border-b border-slate-800">
        <div className="text-xl font-bold tracking-tighter text-indigo-400">Go Study</div>
        <Link 
          to="/login" 
          className="bg-slate-50 text-[#09090b] px-5 py-2 rounded-full font-medium text-sm hover:bg-slate-200 transition-colors"
        >
          Login
        </Link>
      </nav>

      {/* Hero */}
      <main className="max-w-7xl mx-auto px-6 py-20 flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 text-indigo-400 text-sm font-medium mb-8 border border-indigo-500/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            Discord Beta is live
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-tight">
            Study together. <br/>
            <span className="text-slate-500">Stay accountable.</span>
          </h1>
          
          <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Join Discord camera-verified voice channels, accumulate focused study time, and earn digital rewards for your future Study Board.
          </p>

          <Link 
            to="/login"
            className="inline-flex items-center justify-center bg-indigo-500 text-white px-8 py-4 rounded-full font-semibold text-lg hover:bg-indigo-600 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-indigo-500/20"
          >
            Get Started
          </Link>
        </motion.div>

        {/* Features Grid */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="grid md:grid-cols-3 gap-6 mt-32 max-w-5xl mx-auto w-full text-left"
        >
          <div className="bg-[#18181b] border border-slate-800 p-8 rounded-3xl">
            <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 text-indigo-400">
              <Video className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Camera Verification</h3>
            <p className="text-slate-400 leading-relaxed">
              Our bot ensures everyone in the study room is actually present and working. No free-riders.
            </p>
          </div>

          <div className="bg-[#18181b] border border-slate-800 p-8 rounded-3xl">
            <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Earn Verified Hours</h3>
            <p className="text-slate-400 leading-relaxed">
              Every 60 verified minutes earns a reward. Your camera-on time is cumulative—pause whenever you need.
            </p>
          </div>

          <div className="bg-[#18181b] border border-slate-800 p-8 rounded-3xl">
            <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 text-violet-400">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Collect Rewards</h3>
            <p className="text-slate-400 leading-relaxed">
              Unlock exclusive digital items to show off on your Study Board for hitting milestones.
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
