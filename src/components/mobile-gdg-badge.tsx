import Image from "next/image";

/**
 * Lightweight miniature GDG "< >" badge for the compact mobile hero.
 * Pure CSS depth — no observers, no scroll-linked motion.
 */
export function MobileGdgBadge() {
  return (
    <span className="g-mobile-gdg-badge" aria-hidden="true">
      <span className="g-mobile-gdg-badge-depth" />
      <span className="g-mobile-gdg-badge-face">
        <span className="g-mobile-gdg-bracket">&lt;</span>
        <Image className="g-mobile-gdg-mark" src="/gdg-mark.png" alt="" width={22} height={22} />
        <span className="g-mobile-gdg-bracket">&gt;</span>
      </span>
    </span>
  );
}
