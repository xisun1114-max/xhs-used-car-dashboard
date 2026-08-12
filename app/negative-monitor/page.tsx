import type { Metadata } from "next";
import { SiteNav } from "../site-nav";
import { NegativeMonitorClient } from "./negative-monitor-client";

export const metadata: Metadata = { title: "负评监测延续｜评论监测工作台", description: "跟进需要延长监测周期的投放笔记。" };

export default function NegativeMonitorPage() {
  return <><SiteNav active="negative" /><NegativeMonitorClient /></>;
}
