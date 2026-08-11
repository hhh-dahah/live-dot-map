import type { Metadata } from "next";
import { Caveat, Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "活点地图 · 人机协作 变得简单",
  description: "让人和 Agent 共享同一张探索地图。",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${outfit.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
