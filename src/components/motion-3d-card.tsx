"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";

type Motion3DCardProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Render as a semantic element instead of a div. */
  as?: "div" | "article" | "li";
  /** Maximum rotation in degrees on each axis. */
  max?: number;
  /** translateZ pop while the pointer is over the card. */
  lift?: number;
  /** Render the cursor-tracked specular sheen layer. */
  sheen?: boolean;
};

const tiltSpring = { stiffness: 260, damping: 24 };
const sheenSpring = { stiffness: 260, damping: 28 };

/**
 * Reusable pointer-driven 3D card surface.
 *
 * Desktop pointers get a GPU compositor-only tilt plus a cursor-tracked
 * specular sheen. Touch devices and visitors who prefer reduced motion keep the
 * same static card and existing entrance transitions, with no pointer effects.
 */
export function Motion3DCard({
  children,
  className = "",
  style,
  as = "div",
  max = 7,
  lift = 14,
  sheen = true,
}: Motion3DCardProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [finePointer, setFinePointer] = useState(false);

  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.5);
  const active = useMotionValue(0);

  const smoothX = useSpring(pointerX, tiltSpring);
  const smoothY = useSpring(pointerY, tiltSpring);
  const smoothActive = useSpring(active, sheenSpring);

  const rotateX = useTransform(smoothY, [0, 1], [max, -max]);
  const rotateY = useTransform(smoothX, [0, 1], [-max, max]);
  const scale = useTransform(smoothActive, [0, 1], [1, 1.012]);
  const translateZ = useTransform(smoothActive, [0, 1], [0, lift]);

  const sheenX = useTransform(smoothX, [0, 1], ["0%", "100%"]);
  const sheenY = useTransform(smoothY, [0, 1], ["0%", "100%"]);
  const sheenBackground = useMotionTemplate`radial-gradient(320px circle at ${sheenX} ${sheenY}, color-mix(in srgb, var(--tone, var(--google-blue)) 26%, transparent), transparent 64%)`;
  const sheenOpacity = useTransform(smoothActive, [0, 1], [0, 0.9]);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setFinePointer(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const interactive = finePointer && !reduceMotion;

  function handleEnter(event: PointerEvent<HTMLDivElement>) {
    if (!interactive || event.pointerType === "touch") return;
    active.set(1);
  }

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    if (!interactive || !ref.current || event.pointerType === "touch") return;
    const rect = ref.current.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width);
    pointerY.set((event.clientY - rect.top) / rect.height);
    active.set(1);
  }

  function handleLeave() {
    pointerX.set(0.5);
    pointerY.set(0.5);
    active.set(0);
  }

  const MotionElement = motion[as] as typeof motion.div;

  return (
    <MotionElement
      ref={ref}
      className={`g-3d-card ${className}`.trim()}
      style={{
        ...style,
        rotateX,
        rotateY,
        scale,
        z: translateZ,
        transformPerspective: 1100,
        transformStyle: "preserve-3d",
      }}
      onPointerEnter={handleEnter}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerCancel={handleLeave}
    >
      {sheen && (
        <motion.span
          className="g-3d-sheen"
          aria-hidden="true"
          style={{ background: sheenBackground, opacity: sheenOpacity }}
        />
      )}
      {children}
    </MotionElement>
  );
}
