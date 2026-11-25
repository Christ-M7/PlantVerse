"use client";

import { motion, useInView, useMotionValue, useSpring } from "framer-motion";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useLang } from "@/lib/i18n/use-lang";

/** Animated circular progress ring (health %, AI confidence…) */
export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  color = "oklch(0.55 0.13 150)",
  trackColor = "oklch(0.8 0.03 130 / 0.35)",
  children,
  delay = 0,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: ReactNode;
  delay?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c - (c * value) / 100 }}
          viewport={{ once: true }}
          transition={{ duration: 1.4, delay, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Spring-animated number counter (locale-aware, survives React re-renders) */
export function AnimatedNumber({ value, suffix = "", className = "" }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const { num } = useLang();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 18 });

  useEffect(() => {
    if (inView) mv.set(value);
  }, [inView, value, mv]);

  useEffect(() => {
    return spring.on("change", (v) => {
      if (ref.current) ref.current.textContent = num(Math.round(v));
    });
  }, [spring, num]);

  /* Re-apply the settled spring value when the numeral locale flips (fa↔en),
     so React's declarative children don't leave a stale "0" on screen. */
  const reapply = useCallback(() => {
    if (ref.current) ref.current.textContent = num(Math.round(spring.get()));
  }, [num, spring]);
  useEffect(reapply, [reapply]);

  return (
    <span className={className}>
      <span ref={ref}>{num(0)}</span>
      {suffix}
    </span>
  );
}

/** Stagger-in container for grids */
export function StaggerGroup({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export const staggerItem = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};
