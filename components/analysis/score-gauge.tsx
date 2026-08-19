"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { VERDICT_LABEL, type Verdict } from "@/types";

const SIZE = 180;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ScoreGaugeProps {
  score: number;
  verdict: Verdict;
}

/**
 * The box is a fixed 180x180 and the number is absolutely centred inside it,
 * so the sweep animation cannot shift layout (no CLS from the gauge).
 */
export function ScoreGauge({ score, verdict }: ScoreGaugeProps) {
  const gradientId = useId();
  const reduceMotion = useReducedMotion();

  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const targetOffset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div
      className="relative shrink-0"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={`Resume score ${clamped} out of 100. ${VERDICT_LABEL[verdict]}.`}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>

        {/* Rotate so the sweep starts at 12 o'clock. */}
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--gauge-track)"
            strokeWidth={STROKE}
          />
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            /*
              `initial` must not depend on useReducedMotion(): that hook
              returns null on the server and on the first client render, so
              branching here renders different markup on each side and trips a
              hydration mismatch. Always start empty and vary only the
              duration — at 0s the arc lands on its final value immediately.
            */
            initial={{ strokeDashoffset: CIRCUMFERENCE }}
            animate={{ strokeDashoffset: targetOffset }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
            }
          />
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-[family-name:var(--font-display)] text-metric text-ink tabular-nums">
          {clamped}
        </span>
        <span className="mt-2 text-note font-medium text-ink-soft">
          {VERDICT_LABEL[verdict]}
        </span>
      </div>
    </div>
  );
}
