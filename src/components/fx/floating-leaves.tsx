"use client";

import { useMemo } from "react";

/**
 * Ambient floating-leaf particle field — the "living" PlantVerse backdrop.
 * Pure CSS keyframes (pv-leaf-fall in globals.css), randomized per leaf.
 */
export function FloatingLeaves({ count = 7, className = "" }: { count?: number; className?: string }) {
  const leaves = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: `${(i * 97) % 100}%`,
        delay: `${-(i * 3.7) % 22}s`,
        duration: `${16 + ((i * 7) % 12)}s`,
        size: 14 + ((i * 13) % 16),
        drift: `${((i % 2 === 0 ? 1 : -1) * (3 + (i % 4) * 2)).toFixed(1)}vw`,
        opacity: 0.35 + ((i % 3) * 0.15),
        hue: i % 3,
      })),
    [count]
  );

  const colors = [
    "oklch(0.65 0.11 145 / %OP%)",
    "oklch(0.75 0.09 120 / %OP%)",
    "oklch(0.55 0.13 155 / %OP%)",
  ];

  return (
    <div aria-hidden className={`pointer-events-none fixed inset-0 overflow-hidden z-0 ${className}`}>
      {leaves.map((l) => (
        <svg
          key={l.id}
          viewBox="0 0 24 24"
          className="absolute top-0"
          style={{
            left: l.left,
            width: l.size,
            height: l.size,
            opacity: l.opacity,
            animation: `pv-leaf-fall ${l.duration} linear infinite`,
            animationDelay: l.delay,
            ["--pv-drift" as string]: l.drift,
            filter: "blur(0.4px)",
          }}
        >
          <path
            d="M12 2C7 5 3 9 4 15c.6 3.4 3 6 8 7 5-1 7.4-3.6 8-7 1-6-3-10-8-13z"
            fill={colors[l.hue].replace("%OP%", "0.9")}
          />
          <path d="M12 4v16" stroke="oklch(0.3 0.05 150 / 0.5)" strokeWidth="0.8" fill="none" />
        </svg>
      ))}
    </div>
  );
}
