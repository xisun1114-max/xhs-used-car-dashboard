import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const parent = resolve(root, "..");
const sourceFolder = (await readdir(parent)).find((name) => name.startsWith("used-car-workbench-module-") && !name.includes("comment"));
if (!sourceFolder) throw new Error("找不到小红书日常看板数据目录");
const dashboardRoot = resolve(parent, sourceFolder, "public");
const output = resolve(root, "public", "data", "risk-alerts.json");

const context = vm.createContext({ window: {} });
for (const file of ["dashboard_data.js", "dashboard_records_1.js", "dashboard_records_2.js"]) {
  vm.runInContext(await readFile(resolve(dashboardRoot, file), "utf8"), context);
}

const source = context.window.__DASHBOARD_DATA__;
const records = source.records || [];
const dayMs = 86_400_000;
const referenceDate = new Date(`${source.dateMax}T00:00:00+08:00`);
const dateKey = (value) => value ? new Date(`${value}T00:00:00+08:00`) : null;
const daysAgo = (value) => {
  const date = dateKey(value);
  return date ? Math.round((referenceDate - date) / dayMs) : 9999;
};
const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const blankMetrics = () => ({ spend: 0, action_clicks: 0, impressions: 0, clicks: 0 });
const addMetrics = (target, row) => {
  target.spend += Number(row["消耗"]) || 0;
  target.action_clicks += Number(row["组件按钮点击量"]) || 0;
  target.impressions += Number(row["展现量"]) || 0;
  target.clicks += Number(row["点击量"]) || 0;
};
const finalize = (value) => ({
  ...value,
  action_cost: value.action_clicks ? value.spend / value.action_clicks : 0,
  ctr: value.impressions ? value.clicks / value.impressions : 0,
});

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
      account: row["投放账户"] || "未标注",
      total: blankMetrics(), recent3: blankMetrics(), recent7: blankMetrics(), previous7: blankMetrics(),
      spend_dates: new Set(), delivery_dates: new Set(),
    });
  }
  const note = byNote.get(noteId);
  addMetrics(note.total, row);
  const age = daysAgo(row["日期"]);
  if (age >= 0 && age <= 2) addMetrics(note.recent3, row);
  if (age >= 0 && age <= 6) addMetrics(note.recent7, row);
  if (age >= 7 && age <= 13) addMetrics(note.previous7, row);
  if (row["日期"] && row["日期"] !== "未知") {
    note.delivery_dates.add(row["日期"]);
    if ((Number(row["消耗"]) || 0) > 0) note.spend_dates.add(row["日期"]);
  }
}

const notes = [...byNote.values()].map((note) => {
  const spendDates = [...note.spend_dates].sort();
  const lastSpendDate = spendDates.at(-1) || "";
  const noSpendDays = daysAgo(lastSpendDate);
  return {
    note_id: note.note_id, title: note.title, link: note.link, creator: note.creator,
    publish_date: note.publish_date, category: note.category, direction: note.direction, account: note.account,
    first_spend_date: spendDates[0] || "", last_spend_date: lastSpendDate,
    delivery_days: note.delivery_dates.size, no_spend_days: noSpendDays,
    delivery_status: noSpendDays <= 2 ? "投放中" : noSpendDays <= 7 ? "疑似拉停" : "已拉停",
    total: finalize(note.total), recent3: finalize(note.recent3), recent7: finalize(note.recent7), previous7: finalize(note.previous7),
  };
});

function makeBenchmarks(windowName) {
  const active = notes.filter((note) => note.delivery_status === "投放中" && note[windowName].spend >= 100 && note[windowName].action_clicks > 0);
  const groups = new Map();
  for (const note of active) {
    for (const key of [`${note.category}||${note.direction}`, `${note.category}||*`]) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(note[windowName].action_cost);
    }
  }
  return (note) => {
    const exact = groups.get(`${note.category}||${note.direction}`) || [];
    const category = groups.get(`${note.category}||*`) || [];
    const values = exact.length >= 4 ? exact : category;
    const scope = exact.length >= 4 ? `${note.category} / ${note.direction}` : note.category;
    const multiplier = values.length >= 8 ? 1.5 : values.length >= 4 ? 1.65 : 1.8;
    const value = median(values);
    return { value, samples: values.length, multiplier, threshold: value * multiplier, scope };
  };
}

const benchmark3 = makeBenchmarks("recent3");
const benchmark7 = makeBenchmarks("recent7");
const alerts = [];
for (const note of notes) {
  const base3 = benchmark3(note);
  const base7 = benchmark7(note);
  const currentCost = note.recent7.action_cost;
  const previousCost = note.previous7.action_cost;
  const costChange = previousCost && currentCost ? currentCost / previousCost - 1 : null;
  const currentRisk = note.recent7.spend >= 300 && (
    note.recent7.action_clicks === 0 || (base7.threshold > 0 && currentCost > base7.threshold)
  );
  const shortRisk = note.recent3.spend >= 150 && (
    note.recent3.action_clicks === 0 || (base3.threshold > 0 && note.recent3.action_cost > base3.threshold)
  );
  const previousRisk = note.previous7.spend >= 300 && note.previous7.action_clicks > 0 && base7.threshold > 0 && previousCost > base7.threshold;
  const improved = previousRisk && !currentRisk && note.recent7.spend >= 100;
  if (!currentRisk && !shortRisk && !improved) continue;

  let trend = "持续高成本";
  let priority = "P1";
  if (improved) { trend = "近期改善"; priority = "P3"; }
  else if (note.recent7.action_clicks === 0 || note.recent3.action_clicks === 0) { trend = "近期零转化"; priority = "P0"; }
  else if (costChange != null && costChange >= 0.3) { trend = "近期恶化"; priority = "P0"; }
  else if (shortRisk && !currentRisk) { trend = "近3日突增"; priority = "P0"; }
  const reasons = [];
  if (note.recent7.spend >= 300 && note.recent7.action_clicks === 0) reasons.push(`近7日消耗¥${note.recent7.spend.toFixed(2)}，组件点击为0`);
  if (base7.threshold && currentCost > base7.threshold) reasons.push(`近7日成本¥${currentCost.toFixed(2)}，高于动态阈值¥${base7.threshold.toFixed(2)}`);
  if (shortRisk) reasons.push("近3日窗口已触发预警");
  if (costChange != null && costChange >= 0.3) reasons.push(`较前7日上升${Math.round(costChange * 100)}%`);
  if (improved) reasons.push("前7日高成本，近7日已回落，建议继续观察");

  alerts.push({
    ...note,
    data_date: source.dateMax,
    spend: note.total.spend, action_clicks: note.total.action_clicks, action_cost: note.total.action_cost,
    spend_3d: note.recent3.spend, action_clicks_3d: note.recent3.action_clicks, action_cost_3d: note.recent3.action_cost,
    spend_7d: note.recent7.spend, action_clicks_7d: note.recent7.action_clicks, action_cost_7d: note.recent7.action_cost,
    spend_prev_7d: note.previous7.spend, action_clicks_prev_7d: note.previous7.action_clicks, action_cost_prev_7d: note.previous7.action_cost,
    cost_change_7d: costChange,
    category_median_cost: base7.value, threshold_cost: base7.threshold, benchmark_samples: base7.samples,
    benchmark_scope: base7.scope, benchmark_multiplier: base7.multiplier,
    risk_ratio: base7.value && note.recent7.action_clicks ? note.recent7.action_cost / base7.value : null,
    risk_reason: reasons.join("；"), risk_trend: trend, risk_priority: priority,
    total: undefined, recent3: undefined, recent7: undefined, previous7: undefined,
  });
}

const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
alerts.sort((a, b) => priorityOrder[a.risk_priority] - priorityOrder[b.risk_priority] || b.spend_7d - a.spend_7d);
const payload = {
  generated_at: source.generatedAt,
  data_date: source.dateMax,
  source_name: source.sourceName,
  rule: "按同一时间窗口、同一选题分类/方向的投放中笔记动态计算中位数；近7日消耗≥300元或近3日消耗≥150元，且组件成本超过动态阈值（样本越少阈值越严格），或有消耗但组件点击为0时预警。前7日高成本但近期已改善的笔记保留观察。",
  summary: {
    total: alerts.length,
    active: alerts.filter((item) => item.delivery_status === "投放中").length,
    suspected_stop: alerts.filter((item) => item.delivery_status === "疑似拉停").length,
    stopped: alerts.filter((item) => item.delivery_status === "已拉停").length,
    worsening: alerts.filter((item) => ["近期恶化", "近3日突增", "近期零转化"].includes(item.risk_trend)).length,
    improved: alerts.filter((item) => item.risk_trend === "近期改善").length,
    spend_7d: alerts.filter((item) => item.delivery_status !== "已拉停").reduce((sum, item) => sum + item.spend_7d, 0),
  },
  alerts,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, ...payload.summary }, null, 2));
