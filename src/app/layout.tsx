import type { Metadata, Viewport } from "next";
import { AuthLinkNotice } from "@/components/auth-link-notice";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://gdg-aceit.vercel.app"),
  applicationName: "GDG On Campus ACEIT",
  title: { default: "GDG On Campus ACEIT — Learn with Communities 2026", template: "%s · GDG On Campus ACEIT" },
  description: "A student developer community at Arya College of Engineering & IT, learning together and building practical skills in 2026.",
  icons: { icon: "/gdg-mark.png", shortcut: "/gdg-mark.png", apple: "/gdg-mark.png" },
  openGraph: {
    type: "website",
    siteName: "GDG On Campus ACEIT",
    title: "GDG On Campus ACEIT — Learn with Communities 2026",
    description: "Learn together, explore developer technologies, and build practical projects with the ACEIT student developer community.",
    url: "https://gdg-aceit.vercel.app",
    images: [{ url: "/gdg-mark.png", width: 400, height: 400, alt: "Google Developer Groups mark" }],
  },
  twitter: { card: "summary", title: "GDG On Campus ACEIT — Learn with Communities 2026", description: "A student developer community learning together and building practical skills." },
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f7fb" }, { media: "(prefers-color-scheme: dark)", color: "#0b1020" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('gdg-aceit-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}` }} /></head><body><ThemeProvider><AuthLinkNotice />{children}</ThemeProvider></body></html>;
}
