import type { Metadata } from "next";
import { AuthLinkNotice } from "@/components/auth-link-notice";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "GDG On Campus ACEIT | Learn with Communities 2026",
  description: "Community leaderboard for GDG On Campus ACEIT’s Learn with Communities 2026 campaign.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('gdg-aceit-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}` }} /></head><body><ThemeProvider><AuthLinkNotice />{children}</ThemeProvider></body></html>;
}
