import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "活点地图 — 人机协作 变得简单",
  description: "让人和 Agent 共享同一张探索地图。",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
