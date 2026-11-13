"use client";

import { useEffect, useId, useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

type JaipurVariant = "hero" | "about" | "strip";

/**
 * Monochrome Jaipur heritage atmosphere for the public chapter pages.
 *
 * Three hand-authored SVG planes — Aravalli/Amer Fort, Albert Hall + Jal Mahal,
 * and the Hawa Mahal facade — sit on separate transform layers. Scroll progress
 * and (on fine pointers) cursor position move each plane at a different rate,
 * which reads as depth while staying on the compositor. Every transform is
 * skipped for visitors who prefer reduced motion; the architecture still shows
 * as a static engraving.
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

  const farY = useTransform(scroll, [0, 1], [16, -44]);
  const midY = useTransform(scroll, [0, 1], [32, -72]);
  const nearY = useTransform(scroll, [0, 1], [54, -104]);
  const farScale = useTransform(scroll, [0, 1], [1.06, 1.12]);
  const midScale = useTransform(scroll, [0, 1], [1.03, 1.08]);
  const nearScale = useTransform(scroll, [0, 1], [1, 1.035]);

  const farX = useTransform(smoothX, [-1, 1], [14, -14]);
  const midX = useTransform(smoothX, [-1, 1], [24, -24]);
  const nearX = useTransform(smoothX, [-1, 1], [38, -38]);
  const farRotate = useTransform(smoothY, [-1, 1], [-1.4, 1.4]);
  const midRotate = useTransform(smoothY, [-1, 1], [-2.2, 2.2]);
  const nearRotate = useTransform(smoothY, [-1, 1], [-3, 3]);

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
        <svg className="g-jaipur-strip-band" viewBox="0 0 1440 46" preserveAspectRatio="none">
          <defs>
            <JaaliPattern id={`${uid}-strip`} size={42} />
          </defs>
          <rect width="1440" height="46" fill={`url(#${uid}-strip)`} />
        </svg>
        <div className="g-jaipur-strip-art">
          <NearArt uid={uid} />
        </div>
      </div>
    );
  }

  return (
    <div ref={backdropRef} className={`g-jaipur-backdrop g-jaipur-${variant}`} aria-hidden="true">
      <JaaliCorner id={`${uid}-jaali-tl`} className="g-jaipur-jaali g-jaipur-jaali-tl" />
      <JaaliCorner id={`${uid}-jaali-br`} className="g-jaipur-jaali g-jaipur-jaali-br" />

      <motion.div
        className="g-jaipur-layer g-jaipur-far"
        style={reduceMotion ? undefined : { x: farX, y: farY, scale: farScale, rotateX: farRotate }}
      >
        <FarArt uid={uid} />
      </motion.div>
      <motion.div
        className="g-jaipur-layer g-jaipur-mid"
        style={reduceMotion ? undefined : { x: midX, y: midY, scale: midScale, rotateX: midRotate }}
      >
        <MidArt uid={uid} />
      </motion.div>
      <motion.div
        className="g-jaipur-layer g-jaipur-near"
        style={reduceMotion ? undefined : { x: nearX, y: nearY, scale: nearScale, rotateX: nearRotate }}
      >
        <NearArt uid={uid} />
      </motion.div>

      <span className="g-jaipur-horizon" />
    </div>
  );
}

/** Monochrome-to-Google-color chapter mark used in the home and about heroes. */
export function JaipurChapterBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`g-jaipur-badge ${className}`.trim()}>
      <span className="g-jaipur-badge-dots" aria-hidden="true">
        <i className="g-jaipur-dot-blue" />
        <i className="g-jaipur-dot-red" />
        <i className="g-jaipur-dot-yellow" />
        <i className="g-jaipur-dot-green" />
      </span>
      <span className="g-jaipur-badge-label">
        Jaipur <span aria-hidden="true">·</span> Pink City Chapter
      </span>
      <span className="g-jaipur-badge-rule" aria-hidden="true" />
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
   SVG engraving primitives
   -------------------------------------------------------------------------- */

function JaaliPattern({ id, size }: { id: string; size: number }) {
  const half = size / 2;
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
      <path
        d={`M${half} 1 L${half + 4} ${half - 6} L${size - 1} ${half} L${half + 4} ${half + 6} L${half} ${size - 1} L${half - 4} ${half + 6} L1 ${half} L${half - 4} ${half - 6} Z`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.7"
      />
      <circle cx={half} cy={half} r="1.8" fill="currentColor" opacity="0.55" />
      <path
        d={`M0 ${half}H4M${size - 4} ${half}H${size}M${half} 0V4M${half} ${size - 4}V${size}`}
        stroke="currentColor"
        strokeWidth="0.7"
        opacity="0.4"
      />
    </pattern>
  );
}

function JaaliCorner({ id, className }: { id: string; className: string }) {
  return (
    <svg className={className} viewBox="0 0 240 240" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <JaaliPattern id={id} size={40} />
      </defs>
      <rect width="240" height="240" fill={`url(#${id})`} />
    </svg>
  );
}

function FarArt({ uid }: { uid: string }) {
  return (
    <svg viewBox="0 0 1440 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-ridge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.62" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Aravalli ridge */}
      <path
        d="M0 352L54 318L108 336L168 296L228 322L292 274L352 306L414 268L478 302L542 262L606 300L668 264L734 298L800 258L864 294L930 270L996 304L1060 276L1126 306L1192 282L1258 310L1322 288L1382 314L1440 300V420H0Z"
        fill={`url(#${uid}-ridge)`}
      />
      <path
        d="M0 386L88 356L172 374L258 340L346 368L436 336L528 366L620 342L712 370L806 344L896 372L990 348L1084 376L1178 350L1272 378L1360 354L1440 380V420H0Z"
        fill="currentColor"
        opacity="0.26"
      />

      {/* Amer Fort hill */}
      <path
        d="M836 372Q922 294 1032 310Q1140 292 1274 372Z"
        fill="currentColor"
        opacity="0.3"
      />

      {/* Amer Fort ramparts */}
      <g stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M872 330L880 300H894V290H902V300H918V292H926V300H944V288H952V300H972V291H980V300H998V292H1006V300H1024V289H1032V300H1050V292H1058V300H1074V288H1082V300H1096L1102 330Z"
          fill="currentColor"
          fillOpacity="0.28"
          opacity="0.85"
        />
        <path d="M912 330L922 348H1060L1072 330" opacity="0.55" />
        <path d="M944 348V356M1000 348V358M1052 348V356" opacity="0.4" />
      </g>

      {/* Amer palace block */}
      <g stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
        <path d="M958 300V240H1108V300Z" fill="currentColor" fillOpacity="0.16" opacity="0.9" />
        <path
          d="M956 240V229H966V221H974V229H986V221H994V229H1008V219H1016V229H1028V221H1036V229H1048V219H1056V229H1068V221H1076V229H1090V219H1098V229H1110V240"
          fill="currentColor"
          fillOpacity="0.42"
          opacity="0.9"
        />
        <path d="M976 300V270Q983 258 990 270V300M1008 300V262Q1016 248 1024 262V300M1042 300V266Q1050 252 1058 266V300M1076 300V272Q1083 260 1090 272V300" opacity="0.7" />
        <path d="M958 288H1108" opacity="0.35" />
      </g>

      {/* Chhatris */}
      <g fill="currentColor" opacity="0.62">
        {[982, 1033, 1084].map((x) => (
          <g key={x}>
            <path d={`M${x - 9} 230V220H${x - 14}V216H${x + 14}V220H${x + 9}V230Z`} />
            <path d={`M${x - 13} 217C${x - 13} 203 ${x - 6} 197 ${x} 185C${x + 6} 197 ${x + 13} 203 ${x + 13} 217Z`} />
            <path d={`M${x} 185V174`} stroke="currentColor" strokeWidth="1.3" />
            <circle cx={x} cy={171} r="2.6" />
          </g>
        ))}
      </g>

      {/* Watchtower */}
      <g stroke="currentColor" strokeWidth="1.1" fill="none" opacity="0.65">
        <path d="M1116 330V258H1150V330" fill="currentColor" fillOpacity="0.14" />
        <path d="M1114 258V249H1121V243H1127V249H1134V243H1140V249H1146V243H1152V258" fill="currentColor" fillOpacity="0.3" />
        <path d="M1124 330V286Q1133 274 1142 286V330" opacity="0.6" />
      </g>

      {/* Flag and birds */}
      <path d="M1033 174V148" stroke="currentColor" strokeWidth="1.3" opacity="0.7" />
      <path d="M1033 148L1057 156L1033 164Z" fill="currentColor" opacity="0.6" />
      <g stroke="currentColor" strokeWidth="1" fill="none" opacity="0.3">
        <path d="M240 152q8-8 16 0q8-8 16 0" />
        <path d="M304 126q6-6 12 0q6-6 12 0" />
        <path d="M1226 146q7-7 14 0q7-7 14 0" />
      </g>
    </svg>
  );
}

function MidArt({ uid }: { uid: string }) {
  return (
    <svg viewBox="0 0 1440 360" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <pattern id={`${uid}-mid-arch`} width="46" height="54" patternUnits="userSpaceOnUse">
          <path
            d="M6 52V25Q6 12 23 12Q40 12 40 25V52"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            opacity="0.75"
          />
          <path
            d="M12 52V27Q12 18 23 18Q34 18 34 27V52"
            fill="currentColor"
            opacity="0.16"
          />
          <path d="M23 12V4" stroke="currentColor" strokeWidth="0.8" opacity="0.55" />
          <path d="M5 52H41" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
        </pattern>
        <linearGradient id={`${uid}-dome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* Albert Hall Museum */}
      <g stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinejoin="round">
        <rect x="244" y="304" width="384" height="14" opacity="0.7" />
        <rect x="260" y="232" width="352" height="72" fill="currentColor" fillOpacity="0.06" />
        <rect x="336" y="198" width="200" height="106" fill="currentColor" fillOpacity="0.08" />
        <path d="M252 232H620M270 246H602M330 212H542" opacity="0.5" />
        <path d="M252 304H620" opacity="0.5" />
        <rect x="266" y="250" width="340" height="54" fill={`url(#${uid}-mid-arch)`} stroke="none" opacity="0.85" />
        <rect x="336" y="198" width="200" height="106" fill="none" />
        <path d="M392 304V262Q392 232 436 232Q480 232 480 262V304" strokeWidth="1.5" />
        <path d="M404 304V266Q404 244 436 244Q468 244 468 266V304" opacity="0.7" />
        <path d="M412 304V270Q412 254 436 254Q460 254 460 270V304" opacity="0.45" />
        <path d="M356 246V232M516 246V232" opacity="0.5" />
        <path d="M280 250V232M310 250V232M562 250V232M592 250V232" opacity="0.35" />
      </g>

      {/* Albert Hall towers */}
      <g stroke="currentColor" fill="none" strokeWidth="1.1" opacity="0.85">
        <path d="M282 232V176H308V232" fill="currentColor" fillOpacity="0.08" />
        <path d="M280 176V168H288V162H302V168H310V176" fill="currentColor" fillOpacity="0.28" />
        <path d="M284 162C284 148 290 142 295 132C300 142 306 148 306 162Z" fill="currentColor" fillOpacity="0.2" />
        <path d="M295 132V120" />
        <circle cx="295" cy="117" r="2.2" />
        <path d="M566 232V176H592V232" fill="currentColor" fillOpacity="0.08" />
        <path d="M564 176V168H572V162H586V168H594V176" fill="currentColor" fillOpacity="0.28" />
        <path d="M568 162C568 148 574 142 579 132C584 142 590 148 590 162Z" fill="currentColor" fillOpacity="0.2" />
        <path d="M579 132V120" />
        <circle cx="579" cy="117" r="2.2" />
      </g>

      {/* Albert Hall dome */}
      <g stroke="currentColor" strokeWidth="1.2" fill="none">
        <path d="M404 198V178H468V198" fill="currentColor" fillOpacity="0.12" />
        <path d="M398 178H474" opacity="0.6" />
        <path
          d="M400 180C400 154 416 140 436 104C456 140 472 154 472 180Z"
          fill={`url(#${uid}-dome)`}
        />
        <path d="M436 104V86" />
        <circle cx="436" cy="82" r="3.2" />
        <path d="M428 90H444" opacity="0.6" />
        <path d="M418 158Q436 146 454 158" opacity="0.4" />
        <path d="M412 170Q436 156 460 170" opacity="0.35" />
      </g>

      {/* Jal Mahal */}
      <g stroke="currentColor" strokeWidth="1.1" fill="none" opacity="0.9">
        <path d="M1004 300V262H1324V300" fill="currentColor" fillOpacity="0.06" />
        <path d="M1016 300V268H1312V300" fill={`url(#${uid}-mid-arch)`} stroke="none" opacity="0.8" />
        <path d="M1000 300H1328" opacity="0.6" />
        <path d="M1004 262V252H1324V262" fill="currentColor" fillOpacity="0.24" />
      </g>

      {/* Jal Mahal chhatris */}
      <g stroke="currentColor" strokeWidth="1" fill="none" opacity="0.8">
        {[1034, 1164, 1294].map((x) => (
          <g key={x}>
            <path d={`M${x - 18} 252V242H${x - 23}V237H${x + 23}V242H${x + 18}V252`} fill="currentColor" fillOpacity="0.18" />
            <path d={`M${x - 22} 238C${x - 22} 222 ${x - 11} 214 ${x} 200C${x + 11} 214 ${x + 22} 222 ${x + 22} 238Z`} fill="currentColor" fillOpacity="0.12" />
            <path d={`M${x} 200V188`} />
            <circle cx={x} cy={184} r="2.2" />
            <path d={`M${x - 9} 252V246M${x + 9} 252V246`} opacity="0.45" />
          </g>
        ))}
      </g>

      {/* Water reflection + ripples */}
      <g transform="translate(0,600) scale(1,-1)" opacity="0.14" fill="currentColor" stroke="none">
        <path d="M1004 300V262H1324V300Z" />
        <path d="M1012 238C1012 222 1023 214 1034 200C1045 214 1056 222 1056 238Z" />
        <path d="M1142 238C1142 222 1153 214 1164 200C1175 214 1186 222 1186 238Z" />
        <path d="M1272 238C1272 222 1283 214 1294 200C1305 214 1316 222 1316 238Z" />
      </g>
      <g stroke="currentColor" strokeWidth="0.9" opacity="0.32">
        <path d="M992 316H1340M1016 326H1316M988 338H1338M1034 350H1298" />
        <path d="M60 320H520M110 332H470M40 346H500" opacity="0.55" />
      </g>
    </svg>
  );
}

function NearArt({ uid }: { uid: string }) {
  return (
    <svg viewBox="0 0 1440 340" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <pattern id={`${uid}-jharokha`} width="42" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M4 38V17Q4 6 16 6H26Q38 6 38 17V38Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.05"
            opacity="0.85"
          />
          <path
            d="M6.5 38V18Q6.5 8.5 16 8.5H26Q35.5 8.5 35.5 18V38"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.55"
            opacity="0.5"
          />
          <path d="M16 38V28Q21 20 26 28V38" fill="currentColor" opacity="0.28" />
          <path d="M21 6V1.5" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
          <path d="M3 38H39" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
          <circle cx="21" cy="14" r="1.5" fill="currentColor" opacity="0.55" />
        </pattern>
        <pattern id={`${uid}-merlon`} width="30" height="24" patternUnits="userSpaceOnUse">
          <path
            d="M2 24V14Q2 5 15 5Q28 5 28 14V24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.7"
          />
          <path d="M15 5V0" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        </pattern>
        <pattern id={`${uid}-lattice`} width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M9 1L17 9L9 17L1 9Z" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.5" />
          <circle cx="9" cy="9" r="1" fill="currentColor" opacity="0.5" />
        </pattern>
      </defs>

      {/* Hawa Mahal side towers */}
      <g stroke="currentColor" strokeWidth="1.1" fill="none" opacity="0.9">
        <path d="M104 320V124H152V320Z" fill="currentColor" fillOpacity="0.07" />
        <path d="M100 124V114H110V106H118V114H138V106H146V114H156V124" fill="currentColor" fillOpacity="0.24" />
        <path d="M106 105C106 88 115 80 128 62C141 80 150 88 150 105Z" fill="currentColor" fillOpacity="0.14" />
        <path d="M128 62V48" />
        <circle cx="128" cy="44" r="2.6" />
        <path d="M104 148H152M104 178H152M104 208H152M104 238H152M104 268H152M104 296H152" opacity="0.32" />
        <rect x="112" y="152" width="32" height="140" fill={`url(#${uid}-lattice)`} stroke="none" opacity="0.6" />

        <path d="M686 320V124H734V320Z" fill="currentColor" fillOpacity="0.07" />
        <path d="M682 124V114H692V106H700V114H720V106H728V114H738V124" fill="currentColor" fillOpacity="0.24" />
        <path d="M690 105C690 88 699 80 712 62C725 80 734 88 734 105Z" fill="currentColor" fillOpacity="0.14" />
        <path d="M712 62V48" />
        <circle cx="712" cy="44" r="2.6" />
        <path d="M686 148H734M686 178H734M686 208H734M686 238H734M686 268H734M686 296H734" opacity="0.32" />
        <rect x="694" y="152" width="32" height="140" fill={`url(#${uid}-lattice)`} stroke="none" opacity="0.6" />
      </g>

      {/* Hawa Mahal main facade */}
      <g stroke="currentColor" strokeWidth="1.1" fill="none">
        <path d="M152 320V140H686V320Z" fill="currentColor" fillOpacity="0.05" />
        <rect x="152" y="130" width="534" height="16" fill={`url(#${uid}-merlon)`} stroke="none" opacity="0.9" />
        <path d="M146 146H692" opacity="0.55" />

        {/* Five-storey jharokha lattice */}
        <rect x="158" y="152" width="522" height="160" fill={`url(#${uid}-jharokha)`} stroke="none" opacity="0.9" />
        <path d="M152 192H686M152 232H686M152 272H686" opacity="0.5" />
        <path d="M152 312H686" opacity="0.65" />

        {/* Central grand jharokha */}
        <path d="M372 320V206Q372 170 419 170Q466 170 466 206V320Z" fill="currentColor" fillOpacity="0.08" />
        <path d="M366 320V204Q366 160 419 160Q472 160 472 204V320" strokeWidth="1.6" />
        <path d="M378 320V208Q378 176 419 176Q460 176 460 208V320" opacity="0.7" />
        <path d="M390 320V214Q390 190 419 190Q448 190 448 214V320" opacity="0.55" />
        <rect x="388" y="246" width="62" height="74" fill={`url(#${uid}-lattice)`} stroke="none" opacity="0.65" />
        <path d="M384 246H454M380 238H458" opacity="0.6" />

        {/* Ground arcade */}
        <path d="M164 320V300H674V320" fill="currentColor" fillOpacity="0.2" stroke="none" />
        <path d="M176 320V306Q176 296 186 296Q196 296 196 306V320M212 320V306Q212 296 222 296Q232 296 232 306V320M248 320V306Q248 296 258 296Q268 296 268 306V320M284 320V306Q284 296 294 296Q304 296 304 306V320M320 320V306Q320 296 330 296Q340 296 340 306V320M478 320V306Q478 296 488 296Q498 296 498 306V320M514 320V306Q514 296 524 296Q534 296 534 306V320M550 320V306Q550 296 560 296Q570 296 570 306V320M586 320V306Q586 296 596 296Q606 296 616 306V320M622 320V306Q622 296 632 296Q642 296 652 306V320" opacity="0.6" />
      </g>

      {/* Crown chhatris */}
      <g stroke="currentColor" strokeWidth="1" fill="none" opacity="0.85">
        {[300, 419, 538].map((x) => (
          <g key={x}>
            <path d={`M${x - 17} 130V120H${x - 22}V115H${x + 22}V120H${x + 17}V130`} fill="currentColor" fillOpacity="0.2" />
            <path d={`M${x - 21} 116C${x - 21} 101 ${x - 10} 94 ${x} 80C${x + 10} 94 ${x + 21} 101 ${x + 21} 116Z`} fill="currentColor" fillOpacity="0.13" />
            <path d={`M${x} 80V68`} />
            <circle cx={x} cy={64} r="2.3" />
          </g>
        ))}
      </g>

      {/* Finial aura + birds */}
      <g stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.22">
        <path d="M419 40V22M405 30H433M419 22L427 12M419 22L411 12" />
        <path d="M620 84q7-7 14 0q7-7 14 0M566 58q6-6 12 0q6-6 12 0" />
      </g>
    </svg>
  );
}
