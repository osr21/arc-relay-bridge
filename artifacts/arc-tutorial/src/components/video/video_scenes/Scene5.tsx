import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { sceneTransitions } from '@/lib/video';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center p-12" {...sceneTransitions.scaleFade}>
      
      <motion.div 
        className="w-[12vw] h-[12vw] rounded-full bg-success/20 flex items-center justify-center mb-8 border border-success/50 box-glow shadow-[0_0_50px_rgba(16,185,129,0.3)]"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <svg width="6vw" height="6vw" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-success"><path d="M20 6 9 17l-5-5"/></svg>
      </motion.div>

      <motion.h2 
        className="text-[4vw] font-display font-bold text-white mb-4"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      >
        Transaction Complete
      </motion.h2>

      <motion.p 
        className="text-[2vw] text-text-secondary mb-12"
        initial={{ opacity: 0 }}
        animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 0.3 }}
      >
        Native USDC arrived on Arc Testnet
      </motion.p>

      <motion.div 
        className="flex gap-8"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      >
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col items-center justify-center w-[20vw] backdrop-blur-sm">
          <div className="text-text-muted text-[1vw] uppercase tracking-widest mb-2">Time</div>
          <div className="text-primary font-mono text-[2vw] font-bold">1m 42s</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col items-center justify-center w-[20vw] backdrop-blur-sm">
          <div className="text-text-muted text-[1vw] uppercase tracking-widest mb-2">Explorer</div>
          <div className="text-primary font-mono text-[1.5vw] font-bold flex items-center gap-2">
            View tx ↗
          </div>
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-12 text-[1.5vw] text-text-muted font-display"
        initial={{ opacity: 0 }}
        animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 1 }}
      >
        arc.io
      </motion.div>

    </motion.div>
  );
}
