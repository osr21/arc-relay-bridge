import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { sceneTransitions } from '@/lib/video';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex items-center justify-center" {...sceneTransitions.clipPolygon}>
      <div className="absolute inset-0 flex flex-col items-center justify-center p-12">
        {/* Logo / Icon */}
        <motion.div 
          className="w-32 h-32 mb-8 relative"
          initial={{ scale: 0, opacity: 0, rotate: -90 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.2 }}
        >
          <svg viewBox="0 0 100 100" fill="none" className="w-full h-full text-primary drop-shadow-[0_0_15px_rgba(0,240,255,0.5)]">
            <motion.path 
              d="M50 10 L90 30 L90 70 L50 90 L10 70 L10 30 Z" 
              stroke="currentColor" 
              strokeWidth="4" 
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.5, ease: "easeInOut" }}
            />
            <motion.circle cx="50" cy="50" r="15" fill="currentColor"
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ duration: 0.5, delay: 1 }}
            />
          </svg>
        </motion.div>

        <motion.h1 
          className="text-[6vw] font-display font-bold leading-tight text-center tracking-tight"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.5 }}
        >
          Arc Relay Bridge
        </motion.h1>

        <motion.div 
          className="flex gap-6 mt-8"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ staggerChildren: 0.2, delayChildren: 0.2 }}
        >
          {['Cross-chain USDC.', 'No wrapping.', 'No pools.'].map((text, i) => (
            <motion.span 
              key={i} 
              className="text-[2vw] text-text-secondary font-medium px-4 py-2 bg-white/5 rounded-full border border-white/10"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.5, delay: i * 0.2 }}
            >
              {text}
            </motion.span>
          ))}
        </motion.div>

        <motion.p 
          className="mt-12 text-[1.8vw] text-primary font-mono tracking-widest uppercase"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 1 }}
        >
          Powered by Circle CCTP V2
        </motion.p>
      </div>
    </motion.div>
  );
}
