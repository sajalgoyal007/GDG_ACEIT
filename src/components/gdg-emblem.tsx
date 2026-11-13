"use client";

import { Tilt } from "@/components/tilt";

type EmblemVariant = "hero" | "compact";

/**
 * Signature GDG "< >" sculpture. Every moving part is transform/opacity only so
 * the composition stays on the compositor. Tilt handles pointer parallax and
 * falls back to a static sculpture when reduced motion is requested.
 */
export function GdgEmblem({ className = "", variant = "hero" }: { className?: string; variant?: EmblemVariant }) {
  return (
    <Tilt max={variant === "hero" ? 15 : 10} scale={1.03} className={`g-emblem-wrap g-emblem-${variant} ${className}`.trim()}>
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
      </div>
    </Tilt>
  );
}
