"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { Tilt } from "@/components/tilt";

type EmblemVariant = "hero" | "compact";

/**
 * Signature GDG "< >" sculpture.
 *
 * Pointer tilt (Tilt), scroll-linked rotation/parallax (useScroll) and ambient
 * CSS levitation live on separate transform layers so they compose instead of
 * fighting each other. All movement is transform/opacity only, and every
 * motion effect is skipped when the visitor prefers reduced motion.
 */
export function GdgEmblem({ className = "", variant = "hero" }: { className?: string; variant?: EmblemVariant }) {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ["start end", "end start"],
  });
  const scroll = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.6 });

  const scrollRotateX = useTransform(scroll, [0, 1], [-7, 7]);
  const scrollRotateY = useTransform(scroll, [0, 1], [12, -12]);
  const scrollY = useTransform(scroll, [0, 1], [26, -26]);

  const cloudY = useTransform(scroll, [0, 1], [20, -28]);
  const cloudRotate = useTransform(scroll, [0, 1], [-6, 6]);
  const aiY = useTransform(scroll, [0, 1], [-24, 20]);
  const aiRotate = useTransform(scroll, [0, 1], [5, -5]);
  const arcadeY = useTransform(scroll, [0, 1], [26, -22]);
  const arcadeRotate = useTransform(scroll, [0, 1], [6, -6]);
  const communityY = useTransform(scroll, [0, 1], [-18, 24]);
  const communityRotate = useTransform(scroll, [0, 1], [-5, 5]);

  return (
    <div ref={wrapRef} className={`g-emblem-wrap g-emblem-${variant} ${className}`.trim()}>
      <Tilt max={variant === "hero" ? 15 : 10} scale={1.03} className="g-emblem-tilt">
        <motion.div
          className="g-emblem-scroll"
          style={reduceMotion ? undefined : { rotateX: scrollRotateX, rotateY: scrollRotateY, y: scrollY }}
        >
          <div className="g-emblem" aria-hidden="true">
            <span className="g-emblem-halo" />
            <span className="g-emblem-grid" />

            <span className="g-emblem-orbit g-orbit-blue" />
            <span className="g-emblem-orbit g-orbit-red" />
            <span className="g-emblem-orbit g-orbit-yellow" />
            <span className="g-emblem-orbit-dot g-orbit-dot-blue" />
            <span className="g-emblem-orbit-dot g-orbit-dot-green" />

            <span className="g-emblem-shape g-shape-blue" />
            <span className="g-emblem-shape g-shape-red" />
            <span className="g-emblem-shape g-shape-yellow" />
            <span className="g-emblem-shape g-shape-green" />

            <span className="g-emblem-bracket g-bracket-left">&lt;</span>
            <span className="g-emblem-bracket g-bracket-right">&gt;</span>
            <span className="g-emblem-slash">/</span>

            <span className="g-emblem-core">
              <span className="g-emblem-core-kicker">GOOGLE DEVELOPER GROUPS</span>
              <strong>GDG</strong>
              <span className="g-emblem-core-sub">ON CAMPUS · ACEIT</span>
              <span className="g-emblem-core-rule" />
            </span>

            <motion.span
              className="g-hero-chip g-hero-chip-blue g-emblem-orbital"
              style={reduceMotion ? undefined : { y: cloudY, rotate: cloudRotate, z: 84 }}
            >
              Cloud
            </motion.span>
            <motion.span
              className="g-hero-chip g-hero-chip-red g-emblem-orbital"
              style={reduceMotion ? undefined : { y: aiY, rotate: aiRotate, z: 96 }}
            >
              AI
            </motion.span>
            <motion.span
              className="g-hero-chip g-hero-chip-yellow g-emblem-orbital"
              style={reduceMotion ? undefined : { y: arcadeY, rotate: arcadeRotate, z: 76 }}
            >
              Arcade
            </motion.span>
            <motion.span
              className="g-hero-chip g-hero-chip-green g-emblem-orbital"
              style={reduceMotion ? undefined : { y: communityY, rotate: communityRotate, z: 104 }}
            >
              Community
            </motion.span>
          </div>
        </motion.div>
      </Tilt>
    </div>
  );
}
