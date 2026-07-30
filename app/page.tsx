import type { Metadata } from "next";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = {
  title: "供应商笔记评论维护工作台",
  description: "每日筛选高消耗、高评论供应商笔记，协同完成人工审核、铺设、防车商、回复与复查。",
};

export default function Home() {
  return <DashboardClient />;
}
