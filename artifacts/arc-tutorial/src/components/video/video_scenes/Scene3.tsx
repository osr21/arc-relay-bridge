import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { sceneTransitions } from '@/lib/video';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center p-12" {...sceneTransitions.zoomThrough}>
      
      <motion.div 
        className="w-[50vw] text-center"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        <div className="text-text-secondary text-[2vw] mb-6 font-display">Enter Amount</div>
        
        <div className="relative">
          <motion.div 
            className="text-[8vw] font-mono font-bold text-white tracking-tighter flex items-center justify-center gap-4"
          >
            <span className="text-text-muted">$</span>
            <motion.span
              initial={{ opacity: 0 }}
              animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
            >
              1,000
            </motion.span>
            <motion.span 
              className="text-[4vw] text-primary mt-4"
              initial={{ scale: 0, opacity: 0 }}
              animate={phase >= 2 ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ type: 'spring' }}
            >
              USDC
            </motion.span>
          </motion.div>
        </div>

        <motion.div 
          className="mt-12 w-full h-[2px] bg-white/10 relative overflow-hidden"
          initial={{ scaleX: 0 }}
          animate={phase >= 1 ? { scaleX: 1 } : { scaleX: 0 }}
        >
          <motion.div 
            className="absolute top-0 left-0 bottom-0 bg-primary w-1/3"
            initial={{ x: '-100%' }}
            animate={phase >= 2 ? { x: '200%' } : { x: '-100%' }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        </motion.div>

        <motion.div
          className="mt-12 inline-block bg-primary text-black font-display font-bold text-[2vw] px-12 py-4 rounded-full drop-shadow-[0_0_20px_rgba(0,240,255,0.4)]"
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 3 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          whileHover={{ scale: 1.05 }}
        >
          Bridge Funds
        </motion.div>
      </motion.div>

    </motion.div>
  );
}
