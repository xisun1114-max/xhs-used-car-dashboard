import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const dashboardRoot = resolve(root, "..", "used-car-workbench-module-小红书日常看板", "public");
const output = resolve(root, "public", "data", "risk-alerts.json");

const context = vm.createContext({ window: {} });
for (const file of ["dashboard_data.js", "dashboard_records_1.js", "dashboard_records_2.js"]) {
  vm.runInContext(await readFile(resolve(dashboardRoot, file), "utf8"), context);
}

const source = context.window.__DASHBOARD_DATA__;
const records = source.records;
const dayMs = 86_400_000;
const asDate = (value) => value ? new Date(`${value}T00:00:00+08:00`) : null;
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const byNote = new Map();
for (const row of records) {
  const noteId = String(row["笔记/素材ID"] || "").trim();
  if (!noteId) continue;
  if (!byNote.has(noteId)) {
    byNote.set(noteId, {
      note_id: noteId,
      title: row["内容标题"] || row["创意名称"] || "未命名笔记",
      link: row["笔记/素材链接"] || "",
      creator: row["达人昵称"] || "未标注",
      publish_date: row["发布日期"] || "",
      category: row["选题分类"] || "未标注",
      direction: row["选题方向"] || "未标注",
      spend: 0,
      action_clicks: 0,
      impressions: 0,
      clicks: 0,
      spend_dates: new Set(),
      delivery_dates: new Set(),
    });
  }
  const note = byNote.get(noteId);
  note.spend += Number(row["消耗"]) || 0;
  note.action_clicks += Number(row["组件按钮点击量"]) || 0;
  note.impressions += Number(row["展现量"]) || 0;
  note.clicks += Number(row["点击量"]) || 0;
  if (row["日期"] && row["日期"] !== "未知") {
    note.delivery_dates.add(row["日期"]);
    if ((Number(row["消耗"]) || 0) > 0) note.spend_dates.add(row["日期"]);
  }
}

const referenceDate = asDate(source.dateMax);
const notes = [...byNote.values()].map((note) => {
  const spendDates = [...note.spend_dates].sort();
  const lastSpendDate = spendDates.at(-1) || "";
  const lastDate = asDate(lastSpendDate);
  const noSpendDays = referenceDate && lastDate ? Math.max(0, Math.floor((referenceDate - lastDate) / dayMs)) : 9999;
  const deliveryStatus = noSpendDays <= 2 ? "投放中" : noSpendDays <= 7 ? "疑似拉停" : "已拉停";
  return {
    ...note,
    first_spend_date: spendDates[0] || "",
    last_spend_date: lastSpendDate,
    delivery_days: note.delivery_dates.size,
    no_spend_days: noSpendDays,
    delivery_status: deliveryStatus,
    action_cost: note.action_clicks ? note.spend / note.action_clicks : 0,
    ctr: note.impressions ? note.clicks / note.impressions : 0,
    spend_dates: undefined,
    delivery_dates: undefined,
  };
});

const medians = new Map();
for (const category of new Set(notes.map((note) => note.category))) {
  medians.set(category, median(notes
    .filter((note) => note.delivery_status === "投放中" && note.category === category && note.action_clicks > 0)
    .map((note) => note.action_cost)));
}

const alerts = notes.map((note) => {
  const categoryMedian = medians.get(note.category) || 0;
  const reason = note.action_clicks === 0
    ? "消费≥¥300且行动按钮点击量为0"
    : categoryMedian && note.action_cost > categoryMedian * 1.5
      ? `行动按钮点击成本高于投放中「${note.category}」中位数1.5倍`
      : "";
  return {
    ...note,
    category_median_cost: categoryMedian,
    threshold_cost: categoryMedian * 1.5,
    risk_ratio: categoryMedian && note.action_clicks ? note.action_cost / categoryMedian : null,
    risk_reason: reason,
  };
}).filter((note) => note.spend >= 300 && note.risk_reason)
  .sort((a, b) => b.spend - a.spend);

const counts = Object.fromEntries(["投放中", "疑似拉停", "已拉停"].map((status) => [status, alerts.filter((item) => item.delivery_status === status).length]));
const payload = {
  generated_at: source.generatedAt,
  data_date: source.dateMax,
  source_name: source.sourceName,
  rule: "累计消费≥¥300，且行动按钮点击成本高于所属选题分类投放中笔记中位数1.5倍；或消费≥¥300且行动按钮点击量为0。",
  summary: {
    total: alerts.length,
    active: counts["投放中"],
    suspected_stop: counts["疑似拉停"],
    stopped: counts["已拉停"],
    spend: alerts.reduce((sum, item) => sum + item.spend, 0),
  },
  alerts,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, ...payload.summary }, null, 2));
