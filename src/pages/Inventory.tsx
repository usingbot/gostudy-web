import { motion } from 'motion/react';
import { mockRewards } from '../data';
import { renderIcon } from '../components/IconMap';
import { Backpack } from 'lucide-react';

export default function Inventory() {
  return (
    <div className="space-y-8 pb-10">
      
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800 pb-6">
        <div className="w-12 h-12 bg-[#18181b] border border-slate-800 rounded-xl flex items-center justify-center text-indigo-400">
          <Backpack className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50">Your Inventory</h1>
          <p className="text-slate-400 text-sm">All the items you've earned from verified study sessions.</p>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4"
      >
        {mockRewards.map((reward, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            key={reward.id}
            className="group relative bg-[#18181b] border border-slate-800 rounded-2xl p-4 flex flex-col items-center text-center cursor-pointer hover:border-indigo-500/50 hover:bg-slate-900/50 transition-all"
          >
            {/* Minimal decoration */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 mt-2 transition-transform group-hover:scale-110 bg-slate-800 text-slate-300 group-hover:bg-indigo-500/10 group-hover:text-indigo-400">
              {renderIcon(reward.iconName, 'w-8 h-8')}
            </div>
            
            <h3 className="font-semibold text-sm text-slate-100 mb-1">{reward.name}</h3>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 bg-slate-900 px-2 py-1 rounded-md mt-1 border border-slate-800">
              Owned: {reward.quantity}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
