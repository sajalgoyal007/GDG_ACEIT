import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import { AuthLinkNotice } from "@/components/auth-link-notice";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/**
 * Public-facing geometric type system: Plus Jakarta Sans carries display and UI
 * copy, JetBrains Mono handles eyebrow pills, rank figures and telemetry.
 * Both are exposed as CSS variables so admin surfaces keep their existing stack.
 */
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/** Optional GA4 measurement ID. Vercel Web Analytics needs no configuration. */
const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim();

export const metadata: Metadata = {
  metadataBase: new URL("https://gdg-aceit.vercel.app"),
  applicationName: "GDG On Campus ACEIT",
  title: { default: "GDG On Campus ACEIT — Cloud & AI Campaign 2026", template: "%s · GDG On Campus ACEIT" },
  description: "Student builders at Arya College of Engineering & IT, Kukas, Jaipur learning cloud, AI, and open-source engineering together.",
  icons: { icon: "/gdg-mark.png", shortcut: "/gdg-mark.png", apple: "/gdg-mark.png" },
  openGraph: {
    type: "website",
    siteName: "GDG On Campus ACEIT",
    title: "GDG On Campus ACEIT — Cloud & AI Campaign 2026",
    description: "Learn together, explore developer technologies, and build practical projects with the ACEIT student developer community.",
    url: "https://gdg-aceit.vercel.app",
    images: [{ url: "/gdg-mark.png", width: 400, height: 400, alt: "Google Developer Groups mark" }],
  },
  twitter: { card: "summary", title: "GDG On Campus ACEIT — Cloud & AI Campaign 2026", description: "A student developer community learning together and building practical skills." },
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#0d1117" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('gdg-aceit-theme');t=(t==='light'||t==='dark'||t==='system')?t:'light';var r=document.documentElement;r.dataset.theme=(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))?'dark':'light';r.dataset.themePreference=t}catch(e){var r=document.documentElement;r.dataset.theme='light';r.dataset.themePreference='light'}`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthLinkNotice />
          {children}
        </ThemeProvider>
        <Analytics />
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </body>
    </html>
  );
}
