"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

type JaipurVariant = "hero" | "about" | "strip" | "campus";

type AmerLayout = {
  width: number;
  ridge: string;
  ridgeFront: string;
  hill: string;
  wall: { x: number; end: number; top: number; bottom: number; merlon: number; rise: number };
  palace: { x: number; y: number; w: number; h: number };
  gate: { x: number; y: number; w: number; h: number };
  towers: { x: number; y: number; w: number; bottom: number }[];
  chhatris: { x: number; y: number; s: number }[];
  windowGap: number;
  windowWidth: number;
};

type HawaTier = { left: number; right: number; y: number; height: number; count: number };

type HawaLayout = {
  width: number;
  center: number;
  bottom: number;
  tiers: HawaTier[];
  towers: { x: number; w: number; top: number; bottom: number }[];
  centralArch: { x: number; y: number; w: number; h: number };
  stroke: number;
};

type LakeLayout = {
  width: number;
  waterY: number;
  pavilion: { x: number; y: number; w: number; h: number };
  chhatris: { x: number; y: number; s: number }[];
  ripples: string[];
};

const AMER_DESKTOP: AmerLayout = {
  width: 1440,
  ridge:
    "M0 232 L50 202 104 216 168 180 236 204 300 166 372 198 448 158 520 192 596 170 664 202 742 168 820 198 900 172 980 204 1060 178 1140 206 1220 182 1300 210 1380 188 1440 212 V260 H0Z",
  ridgeFront:
    "M0 246 L72 224 150 238 230 214 310 236 392 210 476 234 560 212 646 238 734 214 822 240 910 216 998 242 1086 218 1174 242 1262 220 1350 244 1440 226 V260 H0Z",
  hill: "M18 236 Q96 156 218 138 Q342 114 468 164 Q540 194 612 236 Z",
  wall: { x: 84, end: 526, top: 174, bottom: 238, merlon: 15, rise: 9 },
  palace: { x: 216, y: 116, w: 212, h: 122 },
  gate: { x: 274, y: 148, w: 96, h: 90 },
  towers: [
    { x: 102, y: 140, w: 44, bottom: 238 },
    { x: 462, y: 134, w: 44, bottom: 238 },
  ],
  chhatris: [
    { x: 250, y: 108, s: 1 },
    { x: 320, y: 98, s: 1.16 },
    { x: 390, y: 108, s: 1 },
  ],
  windowGap: 14,
  windowWidth: 9,
};

const AMER_MOBILE: AmerLayout = {
  width: 720,
  ridge:
    "M0 232 L26 212 54 220 86 196 120 214 154 186 190 208 226 184 262 210 300 190 338 214 378 192 418 216 458 194 498 218 538 196 578 220 618 198 658 222 700 204 720 214 V260 H0Z",
  ridgeFront:
    "M0 246 L34 230 72 242 112 224 152 240 194 222 236 242 278 224 320 244 362 226 404 246 446 228 488 246 530 230 572 248 614 232 656 248 700 236 720 242 V260 H0Z",
  hill: "M8 236 Q48 178 108 158 Q174 142 240 180 Q276 204 312 236 Z",
  wall: { x: 38, end: 292, top: 176, bottom: 240, merlon: 9, rise: 6 },
  palace: { x: 92, y: 126, w: 150, h: 114 },
  gate: { x: 134, y: 154, w: 64, h: 86 },
  towers: [
    { x: 50, y: 150, w: 24, bottom: 240 },
    { x: 252, y: 146, w: 24, bottom: 240 },
  ],
  chhatris: [
    { x: 110, y: 118, s: 0.62 },
    { x: 166, y: 110, s: 0.72 },
    { x: 222, y: 118, s: 0.62 },
  ],
  windowGap: 9,
  windowWidth: 6,
};

const LAKE_DESKTOP: LakeLayout = {
  width: 1440,
  waterY: 236,
  pavilion: { x: 642, y: 176, w: 180, h: 62 },
  chhatris: [
    { x: 672, y: 166, s: 0.8 },
    { x: 732, y: 158, s: 0.96 },
    { x: 792, y: 166, s: 0.8 },
  ],
  ripples: [
    "M604 246H858",
    "M628 253H836",
    "M660 258H808",
  ],
};

const LAKE_MOBILE: LakeLayout = {
  width: 720,
  waterY: 236,
  pavilion: { x: 318, y: 176, w: 112, h: 63 },
  chhatris: [
    { x: 338, y: 168, s: 0.48 },
    { x: 374, y: 160, s: 0.58 },
    { x: 410, y: 168, s: 0.48 },
  ],
  ripples: [
    "M302 246H446",
    "M320 253H430",
    "M342 258H408",
  ],
};

const HAWA_DESKTOP: HawaLayout = {
  width: 1440,
  center: 1164,
  bottom: 242,
  tiers: [
    { left: 1122, right: 1206, y: 66, height: 30, count: 3 },
    { left: 1090, right: 1238, y: 96, height: 28, count: 5 },
    { left: 1058, right: 1270, y: 124, height: 30, count: 7 },
    { left: 1026, right: 1302, y: 154, height: 32, count: 9 },
    { left: 994, right: 1334, y: 186, height: 56, count: 11 },
  ],
  towers: [
    { x: 934, w: 56, top: 126, bottom: 242 },
    { x: 1334, w: 56, top: 126, bottom: 242 },
  ],
  centralArch: { x: 1134, y: 198, w: 60, h: 44 },
  stroke: 2.6,
};

const HAWA_MOBILE: HawaLayout = {
  width: 720,
  center: 574,
  bottom: 242,
  tiers: [
    { left: 554, right: 594, y: 58, height: 24, count: 3 },
    { left: 540, right: 608, y: 82, height: 24, count: 5 },
    { left: 526, right: 622, y: 106, height: 26, count: 7 },
    { left: 512, right: 636, y: 132, height: 28, count: 9 },
    { left: 498, right: 650, y: 160, height: 82, count: 11 },
  ],
  towers: [
    { x: 438, w: 44, top: 138, bottom: 242 },
    { x: 650, w: 44, top: 138, bottom: 242 },
  ],
  centralArch: { x: 552, y: 190, w: 44, h: 52 },
  stroke: 1.8,
};

/**
 * High-contrast monochrome Jaipur horizon for the public chapter pages.
 *
 * Three solid-tone SVG planes — Aravalli/Amer Fort, Jal Mahal, and Hawa Mahal —
 * occupy their own compositor layers. Scroll and fine-pointer motion move them
 * at different rates, while reduced-motion visitors get the same static
 * engraving with no transforms. Desktop and phone compositions are authored
 * separately so both monuments stay readable at 1440px and 390px.
 */
export function JaipurHeritageBackdrop({ variant = "hero" }: { variant?: JaipurVariant }) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, "");
  const reduceMotion = useReducedMotion();
  const backdropRef = useRef<HTMLDivElement>(null);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, { stiffness: 64, damping: 22, mass: 0.6 });
  const smoothY = useSpring(pointerY, { stiffness: 64, damping: 22, mass: 0.6 });

  const { scrollYProgress } = useScroll({
    target: backdropRef,
    offset: ["start end", "end start"],
  });
  const scroll = useSpring(scrollYProgress, { stiffness: 80, damping: 26, mass: 0.5 });

  const farY = useTransform(scroll, [0, 1], [8, -16]);
  const midY = useTransform(scroll, [0, 1], [5, -10]);
  const nearY = useTransform(scroll, [0, 1], [-4, 8]);
  const farX = useTransform(smoothX, [-1, 1], [10, -10]);
  const midX = useTransform(smoothX, [-1, 1], [16, -16]);
  const nearX = useTransform(smoothX, [-1, 1], [-12, 12]);
  const farRotate = useTransform(smoothY, [-1, 1], [-0.8, 0.8]);
  const midRotate = useTransform(smoothY, [-1, 1], [-1.2, 1.2]);
  const nearRotate = useTransform(smoothY, [-1, 1], [0.9, -0.9]);

  useEffect(() => {
    if (reduceMotion || variant === "strip") return;
    const backdrop = backdropRef.current;
    const host = backdrop?.parentElement;
    if (!backdrop || !host) return;

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!finePointer.matches) return;

    const handleMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerX.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
      pointerY.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const reset = () => {
      pointerX.set(0);
      pointerY.set(0);
    };

    host.addEventListener("pointermove", handleMove);
    host.addEventListener("pointerleave", reset);
    return () => {
      host.removeEventListener("pointermove", handleMove);
      host.removeEventListener("pointerleave", reset);
    };
  }, [pointerX, pointerY, reduceMotion, variant]);

  if (variant === "strip") {
    return (
      <div ref={backdropRef} className="g-jaipur-backdrop g-jaipur-backdrop-strip" aria-hidden="true">
        <div className="g-jaipur-strip-art">
          <HawaPanorama uid={uid} />
        </div>
      </div>
    );
  }

  return (
    <div ref={backdropRef} className={`g-jaipur-backdrop g-jaipur-${variant}`} aria-hidden="true">
      <motion.div
        className="g-jaipur-layer g-jaipur-far"
        style={reduceMotion ? undefined : { x: farX, y: farY, rotateX: farRotate }}
      >
        <AravalliPanorama uid={uid} />
      </motion.div>
      <motion.div
        className="g-jaipur-layer g-jaipur-mid"
        style={reduceMotion ? undefined : { x: midX, y: midY, rotateX: midRotate }}
      >
        <LakePanorama uid={uid} />
      </motion.div>
      <motion.div
        className="g-jaipur-layer g-jaipur-near"
        style={reduceMotion ? undefined : { x: nearX, y: nearY, rotateX: nearRotate }}
      >
        <HawaPanorama uid={uid} />
      </motion.div>
      <span className="g-jaipur-horizon" />
    </div>
  );
}

/** Monochrome-to-Google-color chapter mark used in the home and about heroes. */
export function JaipurChapterBadge({
  className = "",
  label = "Jaipur · Pink City Chapter",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span className={`g-jaipur-badge ${className}`.trim()}>
      <span className="g-jaipur-badge-dots" aria-hidden="true">
        <i className="g-jaipur-dot-blue" />
        <i className="g-jaipur-dot-red" />
        <i className="g-jaipur-dot-yellow" />
        <i className="g-jaipur-dot-green" />
      </span>
      <span className="g-jaipur-badge-label">{label}</span>
    </span>
  );
}

/** Cusped Jharokha arch that frames the 3D "< >" sculpture. */
export function JharokhaHalo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`g-jharokha-halo ${className}`.trim()}
      viewBox="0 0 360 440"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M40 428V198C40 130 86 96 148 76C158 48 168 30 180 18C192 30 202 48 212 76C274 96 320 130 320 198V428"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M62 428V202C62 144 102 112 156 94C164 70 172 56 180 44C188 56 196 70 204 94C258 112 298 144 298 202V428"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.72"
      />
      <path
        d="M40 402H62M298 402H320M40 198H62M298 198H320M40 428V402M298 428V402"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.6"
      />
      <path d="M180 18V3" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="180" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.2" />
      <g stroke="currentColor" strokeWidth="0.7" opacity="0.32">
        <path d="M180 98L104 160M180 98L132 176M180 98L228 176M180 98L256 160" />
        <path d="M76 240H284M76 290H284M76 340H284" opacity="0.45" />
      </g>
      <path d="M0 428H360" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
    </svg>
  );
}

/* --------------------------------------------------------------------------
   Panorama primitives
   -------------------------------------------------------------------------- */

function Panorama({
  uid,
  name,
  desktop,
  mobile,
}: {
  uid: string;
  name: string;
  desktop: ReactNode;
  mobile: ReactNode;
}) {
  return (
    <>
      <svg
        className="g-jaipur-art g-jaipur-art-desktop"
        viewBox="0 0 1440 260"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
        data-jaipur-art={`${name}-desktop-${uid}`}
      >
        {desktop}
      </svg>
      <svg
        className="g-jaipur-art g-jaipur-art-mobile"
        viewBox="0 0 720 260"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
        data-jaipur-art={`${name}-mobile-${uid}`}
      >
        {mobile}
      </svg>
    </>
  );
}

function archPath(x: number, y: number, w: number, h: number) {
  const r = w / 2;
  return `M${x} ${y + h} V${y + r} Q${x} ${y} ${x + r} ${y} Q${x + w} ${y} ${x + w} ${y + r} V${y + h} Z`;
}

function crenellatedRect(
  x: number,
  top: number,
  width: number,
  bottom: number,
  merlon: number,
  rise: number,
) {
  let path = `M${x} ${bottom} V${top}`;
  for (let cursor = x; cursor < x + width; cursor += merlon * 2) {
    path += ` V${top - rise} H${Math.min(cursor + merlon, x + width)} V${top}`;
    if (cursor + merlon * 2 < x + width) {
      path += ` H${Math.min(cursor + merlon * 2, x + width)}`;
    }
  }
  return `${path} H${x + width} V${bottom} Z`;
}

function rowOfArches(
  startX: number,
  y: number,
  count: number,
  spacing: number,
  width: number,
  height: number,
) {
  return Array.from({ length: count }, (_, index) =>
    archPath(startX + index * spacing + (spacing - width) / 2, y, width, height),
  );
}

function Chhatri({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="g-jaipur-tone-2" d="M-11 18V9H-15V5H15V9H11V18Z" />
      <path className="g-jaipur-tone-1" d="M-13 6C-13 -4 -7 -11 0 -18C7 -11 13 -4 13 6Z" />
      <path className="g-jaipur-stroke-3" d="M0 -18V-27" strokeWidth="1.6" />
      <circle className="g-jaipur-tone-1" cx="0" cy="-29" r="2.4" />
    </g>
  );
}

function amerWindowPaths(layout: AmerLayout) {
  const { palace, gate, windowGap, windowWidth } = layout;
  const leftX = palace.x + 10;
  const leftWidth = Math.max(0, gate.x - leftX - 8);
  const rightX = gate.x + gate.w + 8;
  const rightWidth = Math.max(0, palace.x + palace.w - rightX - 10);
  const rows = [
    { y: palace.y + 18, h: palace.h * 0.26 },
    { y: palace.y + palace.h * 0.55, h: palace.h * 0.24 },
  ];

  return rows.flatMap(({ y, h }) => [
    ...rowOfArches(
      leftX,
      y,
      Math.max(1, Math.floor(leftWidth / windowGap)),
      windowGap,
      windowWidth,
      h,
    ),
    ...rowOfArches(
      rightX,
      y,
      Math.max(1, Math.floor(rightWidth / windowGap)),
      windowGap,
      windowWidth,
      h,
    ),
  ]);
}

function AravalliPanorama({ uid }: { uid: string }) {
  const render = (layout: AmerLayout, suffix: "desktop" | "mobile") => {
    const maskId = `${uid}-amer-${suffix}`;
    const gateArch = archPath(
      layout.gate.x + Math.round(layout.gate.w * 0.16),
      layout.gate.y + 16,
      Math.round(layout.gate.w * 0.68),
      layout.gate.h - 10,
    );
    return (
      <>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={layout.width} height="260">
            <rect width={layout.width} height="260" fill="#fff" />
            <path d={gateArch} fill="#000" />
            {amerWindowPaths(layout).map((path, index) => (
              <path key={index} d={path} fill="#000" />
            ))}
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          <path className="g-jaipur-tone-3" d={layout.ridge} />
          <path className="g-jaipur-tone-2" d={layout.ridgeFront} />
          <path className="g-jaipur-tone-3" d={layout.hill} />
          <path
            className="g-jaipur-tone-2"
            d={crenellatedRect(
              layout.wall.x,
              layout.wall.top,
              layout.wall.end - layout.wall.x,
              layout.wall.bottom,
              layout.wall.merlon,
              layout.wall.rise,
            )}
          />
          <path
            className="g-jaipur-tone-1"
            d={`M${layout.palace.x} ${layout.palace.y + layout.palace.h} V${layout.palace.y} H${layout.palace.x + layout.palace.w} V${layout.palace.y + layout.palace.h} Z`}
          />
          <path
            className="g-jaipur-tone-1"
            d={crenellatedRect(
              layout.gate.x,
              layout.gate.y,
              layout.gate.w,
              layout.gate.y + layout.gate.h,
              Math.max(8, Math.round(layout.gate.w / 5)),
              suffix === "desktop" ? 8 : 5,
            )}
          />
          {layout.towers.map((tower, index) => (
            <path
              key={index}
              className="g-jaipur-tone-1"
              d={crenellatedRect(
                tower.x,
                tower.y,
                tower.w,
                tower.bottom,
                Math.max(7, Math.round(tower.w / 3)),
                suffix === "desktop" ? 7 : 4,
              )}
            />
          ))}
        </g>
        <path className="g-jaipur-stroke-3" d={gateArch} fill="none" strokeWidth={suffix === "desktop" ? 2.2 : 1.4} />
        <path
          className="g-jaipur-stroke-3"
          d={archPath(
            layout.gate.x + Math.round(layout.gate.w * 0.27),
            layout.gate.y + 26,
            Math.round(layout.gate.w * 0.46),
            layout.gate.h - 20,
          )}
          fill="none"
          strokeWidth={suffix === "desktop" ? 1.4 : 1}
        />
        {layout.chhatris.map((chhatri, index) => (
          <Chhatri key={index} {...chhatri} />
        ))}
        <path
          className="g-jaipur-stroke-2"
          d={`M${layout.palace.x} ${layout.palace.y + 20} H${layout.palace.x + layout.palace.w}`}
          strokeWidth={suffix === "desktop" ? 2 : 1.3}
        />
        <path
          className="g-jaipur-stroke-2"
          d={`M${layout.palace.x} ${layout.palace.y + 66} H${layout.palace.x + layout.palace.w}`}
          strokeWidth={suffix === "desktop" ? 1.4 : 1}
        />
      </>
    );
  };

  return (
    <Panorama
      uid={uid}
      name="amer"
      desktop={render(AMER_DESKTOP, "desktop")}
      mobile={render(AMER_MOBILE, "mobile")}
    />
  );
}

function LakePanorama({ uid }: { uid: string }) {
  const render = (layout: LakeLayout) => (
    <>
      <path className="g-jaipur-tone-3" d={`M0 ${layout.waterY} H${layout.width} V260 H0 Z`} />
      <path
        className="g-jaipur-tone-2"
        d={`M${layout.pavilion.x} ${layout.pavilion.y + layout.pavilion.h} V${layout.pavilion.y} H${layout.pavilion.x + layout.pavilion.w} V${layout.pavilion.y + layout.pavilion.h} Z`}
      />
      <path
        className="g-jaipur-tone-1"
        d={`M${layout.pavilion.x - 8} ${layout.pavilion.y + layout.pavilion.h} V${layout.pavilion.y + 12} H${layout.pavilion.x + layout.pavilion.w + 8} V${layout.pavilion.y + layout.pavilion.h} Z`}
      />
      <g className="g-jaipur-tone-3">
        {Array.from({ length: 5 }, (_, index) => {
          const spacing = layout.pavilion.w / 5;
          return (
            <path
              key={index}
              d={archPath(
                layout.pavilion.x + index * spacing + spacing * 0.22,
                layout.pavilion.y + 26,
                spacing * 0.56,
                layout.pavilion.h - 32,
              )}
            />
          );
        })}
      </g>
      {layout.chhatris.map((chhatri, index) => (
        <Chhatri key={index} {...chhatri} />
      ))}
      <g className="g-jaipur-stroke-3" strokeWidth="1.6">
        {layout.ripples.map((ripple, index) => (
          <path key={index} d={ripple} fill="none" />
        ))}
      </g>
    </>
  );

  return (
    <Panorama
      uid={uid}
      name="jal"
      desktop={render(LAKE_DESKTOP)}
      mobile={render(LAKE_MOBILE)}
    />
  );
}

function hawaFacadePath(layout: HawaLayout) {
  const tiers = layout.tiers;
  let path = `M${tiers[0].left} ${tiers[0].y}`;
  tiers.forEach((tier, index) => {
    path += ` H${tier.right}`;
    const nextY = index === tiers.length - 1 ? layout.bottom : tiers[index + 1].y;
    path += ` V${nextY}`;
  });
  path += ` H${tiers[tiers.length - 1].left}`;
  for (let index = tiers.length - 1; index >= 0; index -= 1) {
    path += ` V${tiers[index].y} H${tiers[index].left}`;
  }
  return `${path} Z`;
}

function hawaWindowPaths(layout: HawaLayout) {
  return layout.tiers.flatMap((tier) => {
    const usable = tier.right - tier.left - 12;
    const spacing = usable / tier.count;
    const width = Math.max(4, spacing * 0.6);
    const height = Math.min(tier.height * 0.64, 20);
    return rowOfArches(
      tier.left + 6 + (spacing - width) / 2,
      tier.y + 5,
      tier.count,
      spacing,
      width,
      height,
    );
  });
}

function HawaPanorama({ uid }: { uid: string }) {
  const render = (layout: HawaLayout, suffix: "desktop" | "mobile") => {
    const maskId = `${uid}-hawa-${suffix}`;
    const facade = hawaFacadePath(layout);
    const centralArch = archPath(
      layout.centralArch.x,
      layout.centralArch.y,
      layout.centralArch.w,
      layout.centralArch.h,
    );
    return (
      <>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={layout.width} height="260">
            <rect width={layout.width} height="260" fill="#fff" />
            {hawaWindowPaths(layout).map((path, index) => (
              <path key={index} d={path} fill="#000" />
            ))}
            <path d={centralArch} fill="#000" />
          </mask>
        </defs>
        {layout.towers.map((tower, index) => (
          <path
            key={index}
            className="g-jaipur-tone-2"
            d={crenellatedRect(
              tower.x,
              tower.top,
              tower.w,
              tower.bottom,
              suffix === "desktop" ? 11 : 7,
              suffix === "desktop" ? 7 : 4,
            )}
          />
        ))}
        <path className="g-jaipur-tone-1" d={facade} mask={`url(#${maskId})`} />
        <g className="g-jaipur-stroke-2" fill="none" strokeWidth={layout.stroke}>
          {layout.tiers.map((tier, index) => {
            const y = index === layout.tiers.length - 1 ? layout.bottom : layout.tiers[index + 1].y;
            return <path key={index} d={`M${tier.left} ${y - 3} Q${layout.center} ${y - 13} ${tier.right} ${y - 3}`} />;
          })}
        </g>
        <path className="g-jaipur-stroke-3" d={centralArch} fill="none" strokeWidth={layout.stroke} />
        <path
          className="g-jaipur-stroke-3"
          d={`M${layout.center - layout.centralArch.w * 0.62} ${layout.bottom - 8} H${layout.center + layout.centralArch.w * 0.62}`}
          strokeWidth={layout.stroke}
        />
        {layout.towers.map((tower, index) => (
          <g key={`lattice-${index}`} className="g-jaipur-stroke-3" strokeWidth={suffix === "desktop" ? 1.2 : 0.9}>
            <path d={`M${tower.x + tower.w * 0.3} ${tower.top + 16} V${tower.bottom}`} />
            <path d={`M${tower.x + tower.w * 0.7} ${tower.top + 16} V${tower.bottom}`} />
            <path d={`M${tower.x + 4} ${tower.top + 34} H${tower.x + tower.w - 4}`} />
            <path d={`M${tower.x + 4} ${tower.top + 70} H${tower.x + tower.w - 4}`} />
          </g>
        ))}
      </>
    );
  };

  return (
    <Panorama
      uid={uid}
      name="hawa"
      desktop={render(HAWA_DESKTOP, "desktop")}
      mobile={render(HAWA_MOBILE, "mobile")}
    />
  );
}
