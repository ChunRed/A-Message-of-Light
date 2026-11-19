import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Noto_Sans_TC } from "next/font/google";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-noto-sans-tc",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "一則光的訊息 | A Message of Light",
  description: "一則光的訊息 — 極簡手繪互動寫信體驗",
  applicationName: "一則光的訊息",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "光的訊息",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#FFFFFF",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${notoSansTC.variable} ${ibmPlexMono.variable}`}
    >
      <body className="bg-white font-sans text-[#222222] antialiased selection:bg-[#222222] selection:text-[#FAF9F6]">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
