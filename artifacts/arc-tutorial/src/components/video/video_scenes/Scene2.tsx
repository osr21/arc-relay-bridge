import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { sceneTransitions } from '@/lib/video';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const chains = ['Arc Testnet', 'Ethereum Sepolia', 'Base Sepolia', 'Avalanche Fuji'];

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center p-12" {...sceneTransitions.slideUp}>
      
      <motion.div 
        className="w-[60vw] bg-bg-light/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8 box-glow"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        {/* Wallet Connect */}
        <div className="flex justify-between items-center mb-12 border-b border-white/10 pb-6">
          <div className="text-[1.5vw] font-display font-medium">Step 1</div>
          <motion.div 
            className="flex items-center gap-3 bg-secondary/20 text-secondary px-6 py-3 rounded-full border border-secondary/30"
            initial={{ backgroundColor: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}
            animate={phase >= 1 ? { backgroundColor: 'rgba(79,70,229,0.2)', color: '#818cf8', borderColor: 'rgba(79,70,229,0.5)' } : {}}
            transition={{ duration: 0.5 }}
          >
            <div className="w-3 h-3 rounded-full bg-success"></div>
            <span className="font-mono text-[1.2vw]">MetaMask Connected</span>
          </motion.div>
        </div>

        {/* Chain Selection */}
        <div className="flex justify-between items-center relative">
          
          <motion.div 
            className="flex-1 bg-black/40 border border-white/10 rounded-xl p-6 relative overflow-hidden"
            initial={{ x: -30, opacity: 0 }}
            animate={phase >= 2 ? { x: 0, opacity: 1 } : { x: -30, opacity: 0 }}
          >
            <div className="text-text-muted text-[1.2vw] mb-4">Source Chain</div>
            <div className="text-[2vw] font-display font-bold text-white">Ethereum Sepolia</div>
          </motion.div>

          <motion.div 
            className="w-16 h-16 flex items-center justify-center z-10 mx-6 rounded-full bg-bg-light border border-white/20"
            initial={{ scale: 0, rotate: -180 }}
            animate={phase >= 3 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </motion.div>

          <motion.div 
            className="flex-1 bg-black/40 border border-primary/30 rounded-xl p-6 relative overflow-hidden"
            initial={{ x: 30, opacity: 0 }}
            animate={phase >= 3 ? { x: 0, opacity: 1 } : { x: 30, opacity: 0 }}
          >
            <div className="text-text-muted text-[1.2vw] mb-4">Destination Chain</div>
            <div className="text-[2vw] font-display font-bold text-primary drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">Arc Testnet</div>
          </motion.div>
        </div>

        {/* Network tags */}
        <motion.div 
          className="flex justify-center gap-4 mt-12"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
        >
          {chains.map((chain, i) => (
            <div key={i} className="text-[1vw] text-text-muted px-3 py-1 border border-white/5 rounded-full">
              {chain}
            </div>
          ))}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
