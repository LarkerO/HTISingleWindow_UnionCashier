import { AnimatePresence, motion } from 'motion/react';
import { ChevronUp, CircleAlert } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { springs, usePrefersReducedMotion } from '@/lib/motion';

export default function PaymentFeedback({ state, text }: { state: 'ready' | 'processing' | 'success' | 'failed'; text: string }) {
  const reduced = usePrefersReducedMotion();
  return <div className={'payment-feedback feedback-' + state} role="status" aria-live="polite" aria-atomic="true">
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={state} className="feedback-symbol" initial={{ opacity: 0, scale: 0.75 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.75 }} transition={springs.snappy} aria-hidden="true">
        {state === 'ready' && <motion.div animate={reduced ? {} : { y: [6, -6, 6], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.65, repeat: Infinity }}><ChevronUp size={30} /><ChevronUp size={30} className="second-chevron" /></motion.div>}
        {state === 'processing' && <Spinner variant="ring" size={36} tone="info" label="正在处理付款" />}
        {state === 'failed' && <motion.div animate={reduced ? {} : { x: [0, -4, 4, -2, 0] }}><CircleAlert size={34} /></motion.div>}
        {state === 'success' && <motion.svg width="42" height="42" viewBox="0 0 42 42" fill="none"><motion.circle cx="21" cy="21" r="19" fill="currentColor" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={springs.bouncy} /><motion.path d="m12 21 6 6 12-12" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.12 }} /></motion.svg>}
      </motion.div>
    </AnimatePresence>
    <p>{text}</p>
    {state === 'ready' && <span className="feedback-detail">将当前卡片向上滑动，确认本次付款</span>}
  </div>;
}
