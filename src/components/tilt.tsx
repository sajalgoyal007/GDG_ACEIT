"use client";

import { useRef } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

type TiltProps = {
  children: ReactNode;
  className?: string;
  /** Maximum rotation in degrees on each axis. */
  max?: number;
  /** Scale applied while the pointer is over the card. */
  scale?: number;
  style?: CSSProperties;
  /** Render as a semantic element instead of a div. */
  as?: "div" | "article" | "li";
};

/**
 * Pointer-driven 3D tilt. Only transform is animated, so the effect stays on the
 * compositor. Everything falls back to a static card when the visitor prefers
 * reduced motion.
 */
export function Tilt({ children, className, max = 8, scale = 1.015, style, as = "div" }: TiltProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const hover = useMotionValue(0);

  const spring = { stiffness: 230, damping: 26, mass: 0.55 };
  const smoothX = useSpring(pointerX, spring);
  const smoothY = useSpring(pointerY, spring);
  const smoothHover = useSpring(hover, { stiffness: 260, damping: 28, mass: 0.5 });
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [max, -max]);
  const rotateY = useTransform(smoothX, [-0.5, 0.5], [-max, max]);
  const scaleValue = useTransform(smoothHover, [0, 1], [1, scale]);

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    if (reduceMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function handleLeave() {
    pointerX.set(0);
    pointerY.set(0);
    hover.set(0);
  }

  if (reduceMotion) {
    const Element = as;
    return <Element className={className} style={style}>{children}</Element>;
  }

  const MotionElement = motion[as] as typeof motion.div;

  return (
    <MotionElement
      ref={ref}
      className={className}
      style={{ ...style, rotateX, rotateY, scale: scaleValue, transformStyle: "preserve-3d" }}
      onPointerEnter={() => hover.set(1)}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      {children}
    </MotionElement>
  );
}
