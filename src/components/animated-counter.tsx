"use client";

import { useEffect, useState } from "react";
import { useMotionValueEvent, useReducedMotion, useSpring } from "motion/react";

type AnimatedCounterProps = {
  /** Final live value. Pass null to render an em dash. */
  value: number | null;
  suffix?: string;
  className?: string;
  /** The element that receives the metric typography styles. */
  as?: "span" | "strong";
};

/**
 * Spring-driven count-up for campaign metrics.
 *
 * The server renders a deterministic `0` (plus the final value for assistive
 * tech) so hydration never mismatches. On mount the spring counts from 0 to the
 * live value; reduced-motion visitors jump straight to the final number.
 */
export function AnimatedCounter({ value, suffix = "", className, as = "span" }: AnimatedCounterProps) {
  const reduceMotion = useReducedMotion();
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [display, setDisplay] = useState(0);
  const spring = useSpring(0, { stiffness: 90, damping: 20, mass: 0.9 });

  useMotionValueEvent(spring, "change", (latest) => {
    setDisplay(Math.round(latest));
  });

  useEffect(() => {
    if (numeric === null) return;
    if (reduceMotion) {
      spring.jump(numeric);
      return;
    }
    spring.set(numeric);
  }, [numeric, reduceMotion, spring]);

  const Element = as;

  if (numeric === null) {
    return <Element className={className}>—</Element>;
  }

  const finalText = `${numeric.toLocaleString("en-IN")}${suffix}`;

  return (
    <Element className={className}>
      <span aria-hidden="true">{display.toLocaleString("en-IN")}{suffix}</span>
      <span className="sr-only">{finalText}</span>
    </Element>
  );
}
