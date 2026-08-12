import type { Metadata } from "next";
import { RiskAlertClient } from "./risk-alert-client";
import "./risk-alert.css";

export const metadata: Metadata = {
  title: "高成本预警协作看板",
  description: "小红书聚光投流高成本笔记的多人协作处理工作台",
};

export default function RiskAlertsPage() {
  return <RiskAlertClient />;
}
