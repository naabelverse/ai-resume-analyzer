"use client";

import { motion, useReducedMotion } from "framer-motion";

import { deriveVerdict, VERDICT_LABEL, VERDICT_TONE } from "@/types";

const SIZE = 180;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ScoreGaugeProps {
  score: number;
}

/**
 * The box is a fixed 180x180 and the number is absolutely centred inside it,
 * so the sweep animation cannot shift layout (no CLS from the gauge).
 */
export function ScoreGauge({ score }: ScoreGaugeProps) {
  const reduceMotion = useReducedMotion();

  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const targetOffset = CIRCUMFERENCE * (1 - clamped / 100);

  /*
    Derived here, not accepted as a prop.

    `AnalysisResult` carries a `verdict`, and on the AI and degraded paths it
    is already `deriveVerdict(overallScore)`. But anything that authors a
    result by hand can carry one that disagrees with its own number — the demo
    fixture did exactly that for section statuses, which is what `4a99c2e`
    fixed by deriving at the point of display. Not taking the prop at all
    applies the same fix one level up: there is no way to hand this component
    a grade that its own number contradicts.

    From `clamped`, not `score`, so the band matches the number actually on
    screen. A 74.6 renders "75" and has to be graded as the 75 a reader sees,
    not as the 74 it came in as.
  */
  const verdict = deriveVerdict(clamped);

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
            /*
              Same key as the label below, so the ring and the words are one
              judgement rendered twice rather than two that happen to agree.
            */
            stroke={VERDICT_TONE[verdict]}
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
