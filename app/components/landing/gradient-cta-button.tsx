'use client';

import { motion } from 'motion/react';
import { ShaderGradient } from './shader-gradient';

// Mini viewfinder / screen capture animation (from Vidova)
function ViewfinderIcon() {
  return (
    <div className="relative w-7 h-7 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" className="w-7 h-7 absolute" aria-hidden>
        <motion.path
          d="M4 8V6a2 2 0 012-2h2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          animate={{ pathLength: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d="M16 4h2a2 2 0 012 2v2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          animate={{ pathLength: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
        />
        <motion.path
          d="M20 16v2a2 2 0 01-2 2h-2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          animate={{ pathLength: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
        <motion.path
          d="M8 20H6a2 2 0 01-2-2v-2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          animate={{ pathLength: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
        />
      </svg>
      <motion.div
        className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[8px] border-l-current ml-0.5"
        animate={{ scale: [1, 1.15, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />
    </div>
  );
}

interface GradientCtaButtonProps {
  children: React.ReactNode;
  className?: string;
}

// Props that conflict between React's HTML events and Framer Motion's handlers
const MOTION_CONFLICT_PROPS = [
  'onDrag',
  'onDragStart',
  'onDragEnd',
  'onAnimationStart',
  'onAnimationEnd',
  'onAnimationIteration',
] as const;
type MotionButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  (typeof MOTION_CONFLICT_PROPS)[number]
>;
type MotionAnchorProps = Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  (typeof MOTION_CONFLICT_PROPS)[number]
>;

export function GradientCtaButtonAsButton({
  children,
  className = '',
  ...props
}: GradientCtaButtonProps & MotionButtonProps) {
  return (
    <motion.button
      type="button"
      className={`relative h-9 pl-2.5 pr-4 flex items-center gap-1.5 rounded-full text-white font-medium text-sm cursor-pointer overflow-hidden shadow-lg ${className}`}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      {...props}
    >
      <ShaderGradient className="absolute inset-0 w-full h-full" />
      <span className="relative z-10 flex items-center gap-1.5">
        <ViewfinderIcon />
        {children}
      </span>
    </motion.button>
  );
}

export function GradientCtaButtonAsLink({
  children,
  href,
  className = '',
  ...props
}: GradientCtaButtonProps & MotionAnchorProps & { href: string }) {
  return (
    <motion.a
      href={href}
      className={`relative h-9 pl-2.5 pr-4 flex items-center gap-1.5 rounded-full text-white font-medium text-sm cursor-pointer overflow-hidden shadow-lg ${className}`}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      {...props}
    >
      <ShaderGradient className="absolute inset-0 w-full h-full" />
      <span className="relative z-10 flex items-center gap-1.5">
        <ViewfinderIcon />
        {children}
      </span>
    </motion.a>
  );
}
