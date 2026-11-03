import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";

import "../globals.css";

import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n/client";
import { LOCALES } from "@/i18n/config";
import { getI18n } from "@/i18n/server";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { dict } = getI18n((await params).lang);
  return {
    title: { default: dict.meta.title, template: `%s · ${dict.meta.appName}` },
    description: dict.meta.description,
    robots: { index: false, follow: false },
    alternates: { languages: { en: "/en", ar: "/ar" } },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a19" },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const i18n = getI18n((await params).lang);
  return (
    <html lang={i18n.locale} dir={i18n.dir} className={`${inter.variable} ${plexArabic.variable} antialiased`}>
      <body>
        <I18nProvider locale={i18n.locale} dict={i18n.dict}>
          <ToastProvider>
            <AppShell i18n={i18n}>{children}</AppShell>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
