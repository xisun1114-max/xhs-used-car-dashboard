import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "供应商笔记评论维护工作台",
  description: "供应商笔记每日评论区维护与多人协作看板",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
