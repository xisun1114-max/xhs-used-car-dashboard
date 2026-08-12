import fs from "node:fs/promises";

const sourcePath = "C:/Users/admin/Documents/看板/.work_neg_monitor/confirmation_data.json";
const outputDir = "C:/Users/admin/Documents/看板/comment-monitor-dashboard/static/data";
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const payload = {
  generated_at: source.generated_at,
  metrics: source.feishu_metrics,
  tasks: source.feishu_details,
};
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(`${outputDir}/dashboard.json`, JSON.stringify(payload), "utf8");
console.log(JSON.stringify({ tasks: payload.tasks.length, metrics: payload.metrics, output: `${outputDir}/dashboard.json` }, null, 2));
