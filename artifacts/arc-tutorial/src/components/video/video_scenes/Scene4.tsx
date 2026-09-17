import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { sceneTransitions } from '@/lib/video';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000), // Approve
      setTimeout(() => setPhase(2), 3500), // Burn
      setTimeout(() => setPhase(3), 6500), // Attest
      setTimeout(() => setPhase(4), 10000), // Mint
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const steps = [
    { id: 1, name: 'Approve', desc: 'Confirm USDC access' },
    { id: 2, name: 'Burn', desc: 'Destroy USDC on Sepolia' },
    { id: 3, name: 'Attest', desc: 'Circle Iris verifies burn (~1-3m)' },
    { id: 4, name: 'Mint', desc: 'Native USDC created on Arc' }
  ];

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center p-12" {...sceneTransitions.wipe}>
      <motion.h2 
        className="text-[4vw] font-display font-bold mb-16 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Executing Bridge
      </motion.h2>

      <div className="w-[70vw] relative">
        {/* Progress Line */}
        <div className="absolute top-[2vw] left-[4vw] right-[4vw] h-[2px] bg-white/10 z-0">
          <motion.div 
            className="absolute top-0 left-0 bottom-0 bg-primary"
            initial={{ width: '0%' }}
            animate={{ width: phase === 0 ? '0%' : phase === 1 ? '25%' : phase === 2 ? '50%' : phase === 3 ? '75%' : '100%' }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
          />
        </div>

        <div className="flex justify-between relative z-10">
          {steps.map((step, idx) => {
            const isActive = phase === step.id;
            const isDone = phase > step.id;
            
            return (
              <div key={idx} className="flex flex-col items-center w-1/4">
                <motion.div 
                  className={`w-[4vw] h-[4vw] rounded-full flex items-center justify-center text-[1.5vw] font-bold border-2 transition-colors duration-500
                    ${isDone ? 'bg-primary border-primary text-black drop-shadow-[0_0_10px_rgba(0,240,255,0.5)]' : 
                      isActive ? 'bg-bg-dark border-primary text-primary drop-shadow-[0_0_15px_rgba(0,240,255,0.8)]' : 
                      'bg-bg-dark border-white/20 text-white/50'}`}
                  initial={{ scale: 0.8 }}
                  animate={{ scale: isActive ? 1.2 : 1 }}
                  transition={{ type: 'spring' }}
                >
                  {isDone ? '✓' : step.id}
                </motion.div>
                
                <motion.div 
                  className="mt-6 text-center"
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: isActive || isDone ? 1 : 0.5 }}
                >
                  <div className={`text-[1.8vw] font-display font-bold ${isActive ? 'text-white' : 'text-text-secondary'}`}>
                    {step.name}
                  </div>
                  <div className="text-[1.2vw] text-text-muted mt-2 max-w-[12vw] mx-auto leading-snug">
                    {step.desc}
                  </div>
                </motion.div>

                {isActive && (
                  <motion.div 
                    className="absolute top-[8vw] w-[15vw]"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-primary"
                        initial={{ width: '0%' }}
                        animate={{ width: '100%' }}
                        transition={{ duration: idx === 2 ? 3 : 2 }} // attestation is slower
                      />
                    </div>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
