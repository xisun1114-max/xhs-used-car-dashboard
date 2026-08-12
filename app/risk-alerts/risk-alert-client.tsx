"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Resolution = "pending" | "processing" | "resolved" | "ignored";
type Alert = {
  note_id: string; data_date: string; title: string; link: string; creator: string; publish_date: string;
  category: string; direction: string; account: string; delivery_status: string; first_spend_date: string;
  last_spend_date: string; delivery_days: number; no_spend_days: number; spend: number; action_clicks: number;
  action_cost: number; spend_3d: number; action_clicks_3d: number; action_cost_3d: number;
  spend_7d: number; action_clicks_7d: number; action_cost_7d: number; spend_prev_7d: number;
  action_clicks_prev_7d: number; action_cost_prev_7d: number; cost_change_7d: number | null;
  category_median_cost: number; threshold_cost: number; benchmark_samples: number; benchmark_scope: string;
  benchmark_multiplier: number; risk_ratio: number | null; risk_reason: string; risk_trend: string;
  risk_priority: string; owner: string; resolution: Resolution; action_type: string; notes: string;
  version: number; updated_at: string;
};
type Activity = { id: number; note_id: string; actor: string; detail: string; created_at: string };
type Payload = { generated_at?: string; data_date?: string; source_name?: string; rule?: string; alerts: Alert[]; activity?: Activity[] };

declare global { interface Window { XLSX?: { utils: Record<string, (...args: unknown[]) => unknown>; writeFile: (book: unknown, name: string) => void } } }

const resolutionText: Record<Resolution, string> = { pending: "待处理", processing: "处理中", resolved: "已处理", ignored: "无需处理" };
const actionChoices = ["", "暂停投放", "降低预算", "调整定向", "优化素材", "检查组件", "继续观察", "无需调整"];
const money = (value: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value || 0);
const percent = (value: number | null) => value == null ? "无可比数据" : `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
const classForStatus = (value: string) => value === "投放中" ? "active" : value === "疑似拉停" ? "suspected" : "stopped";

export function RiskAlertClient() {
  const [data, setData] = useState<Payload>({ alerts: [] });
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [showName, setShowName] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [status, setStatus] = useState("投放中");
  const [resolution, setResolution] = useState("open");
  const [trend, setTrend] = useState("all");
  const [owner, setOwner] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("priority");
  const [selected, setSelected] = useState<Alert | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fallback = await fetch("/data/risk-alerts.json", { cache: "no-store" }).then((item) => item.json()) as Payload;
      const response = await fetch("/api/risk-alerts", { cache: "no-store" });
      const api = response.ok ? await response.json() as Payload : { alerts: [] };
      const collaboration = new Map((api.alerts || []).map((item) => [item.note_id, item]));
      const merged = fallback.alerts.map((item) => {
        const saved = collaboration.get(item.note_id);
        return saved ? { ...item, owner: saved.owner || "", resolution: saved.resolution || "pending", action_type: saved.action_type || "", notes: saved.notes || "", version: saved.version || 1, updated_at: saved.updated_at || "" } : item;
      });
      setData({ ...fallback, alerts: merged, activity: api.activity || [] });
      void fetch("/api/risk-alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fallback) });
    } catch {
      const fallback = await fetch("/data/risk-alerts.json", { cache: "no-store" }).then((item) => item.json()) as Payload;
      setData(fallback); setMessage("当前为本地数据预览，协作保存服务暂未连接");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("risk-alert-actor") || "";
    setActor(stored); setNameDraft(stored); void load();
    if (!window.XLSX) { const script = document.createElement("script"); script.src = "/xlsx.full.min.js"; script.async = true; document.head.appendChild(script); }
  }, [load]);

  const saveName = () => { const clean = nameDraft.trim(); if (!clean) return; localStorage.setItem("risk-alert-actor", clean); setActor(clean); setShowName(false); };
  const update = async (alert: Alert, changes: Partial<Alert>) => {
    if (!actor) { setShowName(true); return; }
    setSaving(alert.note_id);
    const optimistic = { ...alert, ...changes };
    setData((current) => ({ ...current, alerts: current.alerts.map((item) => item.note_id === alert.note_id ? optimistic : item) }));
    setSelected((current) => current?.note_id === alert.note_id ? optimistic : current);
    try {
      const response = await fetch(`/api/risk-alerts/${encodeURIComponent(alert.note_id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, version: alert.version, changes }) });
      const result = await response.json() as { alert?: Alert; error?: string };
      if (!response.ok || !result.alert) throw new Error(result.error || "保存失败");
      setData((current) => ({ ...current, alerts: current.alerts.map((item) => item.note_id === alert.note_id ? result.alert! : item) }));
      setSelected((current) => current?.note_id === alert.note_id ? result.alert! : current); setMessage(`已同步 · ${actor}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(""); }
  };

  const owners = useMemo(() => Array.from(new Set(data.alerts.map((item) => item.owner).filter(Boolean))).sort(), [data.alerts]);
  const filtered = useMemo(() => data.alerts.filter((item) => {
    if (status !== "all" && item.delivery_status !== status) return false;
    if (resolution === "open" && ["resolved", "ignored"].includes(item.resolution)) return false;
    if (resolution !== "all" && resolution !== "open" && item.resolution !== resolution) return false;
    if (trend !== "all" && item.risk_trend !== trend) return false;
    if (owner === "mine" && item.owner !== actor) return false;
    if (owner !== "all" && owner !== "mine" && item.owner !== owner) return false;
    const keyword = search.trim().toLowerCase();
    return !keyword || `${item.title} ${item.creator} ${item.note_id} ${item.category} ${item.direction} ${item.account}`.toLowerCase().includes(keyword);
  }).sort((a, b) => sort === "cost" ? b.action_cost_7d - a.action_cost_7d : sort === "change" ? (b.cost_change_7d || -99) - (a.cost_change_7d || -99) : sort === "spend" ? b.spend_7d - a.spend_7d : a.risk_priority.localeCompare(b.risk_priority) || b.spend_7d - a.spend_7d), [actor, data.alerts, owner, resolution, search, sort, status, trend]);

  const summary = useMemo(() => ({
    open: data.alerts.filter((item) => !["resolved", "ignored"].includes(item.resolution) && item.delivery_status !== "已拉停").length,
    worsening: data.alerts.filter((item) => ["近期恶化", "近3日突增", "近期零转化"].includes(item.risk_trend) && item.delivery_status !== "已拉停").length,
    improved: data.alerts.filter((item) => item.risk_trend === "近期改善" && item.delivery_status !== "已拉停").length,
    spend7d: data.alerts.filter((item) => item.delivery_status !== "已拉停").reduce((sum, item) => sum + item.spend_7d, 0),
  }), [data.alerts]);

  const exportExcel = () => {
    const xlsx = window.XLSX;
    if (!xlsx) { setMessage("Excel 组件正在加载，请稍后再试"); return; }
    const rows = (items: Alert[]) => items.map((item) => ({
      "预警优先级": item.risk_priority, "风险趋势": item.risk_trend, "投放状态": item.delivery_status,
      "笔记标题": item.title, "笔记链接": item.link, "达人": item.creator, "投放账户": item.account,
      "选题分类": item.category, "选题方向": item.direction, "发布日期": item.publish_date,
      "近3日消耗": item.spend_3d, "近3日组件点击": item.action_clicks_3d, "近3日组件成本": item.action_cost_3d,
      "近7日消耗": item.spend_7d, "近7日组件点击": item.action_clicks_7d, "近7日组件成本": item.action_cost_7d,
      "前7日消耗": item.spend_prev_7d, "前7日组件成本": item.action_cost_prev_7d, "成本环比": item.cost_change_7d,
      "动态中位数": item.category_median_cost, "动态阈值": item.threshold_cost, "基准范围": item.benchmark_scope,
      "基准样本数": item.benchmark_samples, "累计消耗": item.spend, "累计组件点击": item.action_clicks,
      "累计组件（行动按钮）点击成本": item.action_cost,
      "触发原因": item.risk_reason, "负责人": item.owner, "处理状态": resolutionText[item.resolution],
      "处理动作": item.action_type, "协作备注": item.notes, "首投日期": item.first_spend_date, "投放天数": item.delivery_days,
    }));
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(rows(filtered)), "当前筛选");
    xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(rows(data.alerts)), "全部预警");
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([["数据日期", data.data_date], ["动态口径", data.rule], ["说明", "中位数随每日数据、时间窗口、选题分类/方向及有效样本实时变化"]]), "口径说明");
    xlsx.writeFile(book, `高成本预警_${data.data_date || new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return <main className="risk-shell">
    <header className="risk-topbar"><div className="risk-brand"><span>警</span><div><h1>高成本预警协作看板</h1><p>独立站点 · 动态判断 · 多人协作</p></div></div><div className="risk-head-actions"><button className="guide-button" onClick={() => setShowGuide(true)}><b>?</b> 看板说明</button><button className="export" onClick={exportExcel}>导出 Excel</button><button onClick={() => setShowName(true)}><i>{actor ? actor.slice(0, 1) : "?"}</i>{actor || "选择操作人"}</button></div></header>
    <section className="risk-hero"><div><span className="risk-eyebrow">数据截至 {data.data_date || "—"} · 每次日更后自动重算</span><h2>当前有 <strong>{summary.open}</strong> 条预警需要判断</h2><p>{data.rule}</p></div><div className="risk-hero-stat"><b>{summary.worsening}</b><span>近期恶化或突增</span><small>{summary.improved} 条近期已改善</small></div></section>
    <section className="risk-kpis"><Metric label="待推进" value={summary.open} detail="投放中与疑似拉停" tone="red" /><Metric label="近期恶化" value={summary.worsening} detail="优先实时调控" tone="amber" /><Metric label="近期改善" value={summary.improved} detail="保留观察，避免误停" tone="green" /><Metric label="近7日预警消耗" value={money(summary.spend7d)} detail="不再使用累计消耗替代当前表现" tone="blue" /></section>
    <section className="risk-board"><div className="risk-board-head"><div><span>LIVE ALERT QUEUE</span><h3>动态预警处理队列</h3><p>显示 {filtered.length} / {data.alerts.length} 条</p></div><div className="risk-status-tabs">{["投放中", "疑似拉停", "已拉停", "all"].map((value) => <button className={status === value ? "active" : ""} onClick={() => setStatus(value)} key={value}>{value === "all" ? "全部" : value}</button>)}</div></div>
      <div className="risk-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、达人、账户、选题" /><select value={trend} onChange={(event) => setTrend(event.target.value)}><option value="all">全部趋势</option>{["近期恶化", "近3日突增", "持续高成本", "近期零转化", "近期改善"].map((value) => <option key={value}>{value}</option>)}</select><select value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="open">仅看未完成</option><option value="all">全部处理状态</option>{Object.entries(resolutionText).map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">全部负责人</option><option value="mine">只看我的</option>{owners.map((name) => <option key={name}>{name}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="priority">按优先级</option><option value="change">按成本环比</option><option value="cost">按近7日成本</option><option value="spend">按近7日消耗</option></select><button onClick={() => void load()}>刷新</button></div>
      <div className="alert-list">{loading ? <div className="risk-empty">正在加载预警…</div> : filtered.length ? filtered.map((alert) => <AlertRow key={alert.note_id} alert={alert} actor={actor} saving={saving === alert.note_id} onUpdate={update} onOpen={setSelected} />) : <div className="risk-empty"><b>当前筛选下没有预警</b><span>可切换趋势、状态或清空搜索条件。</span></div>}</div>
    </section>
    {selected && <AlertDrawer alert={selected} activity={(data.activity || []).filter((item) => item.note_id === selected.note_id)} saving={saving === selected.note_id} onClose={() => setSelected(null)} onUpdate={update} />}
    {showGuide && <GuidePanel dataDate={data.data_date || "—"} rule={data.rule || ""} onClose={() => setShowGuide(false)} />}
    {showName && <NameDialog value={nameDraft} onChange={setNameDraft} onSave={saveName} onClose={() => actor && setShowName(false)} />}{message && <div className="risk-toast">{message}</div>}
  </main>;
}

function GuidePanel({ dataDate, rule, onClose }: { dataDate: string; rule: string; onClose: () => void }) {
  return <div className="guide-overlay" onMouseDown={onClose}><section className="guide-panel" onMouseDown={(event) => event.stopPropagation()}>
    <header className="guide-head"><div><span>BOARD HANDBOOK</span><h2>高成本预警看板说明</h2><p>从数据进入到完成处理，一次看懂判断依据与协作方法</p></div><button onClick={onClose} aria-label="关闭说明">×</button></header>
    <div className="guide-scroll">
      <section className="guide-source"><div className="guide-section-title"><i>01</i><div><h3>数据从哪里来</h3><p>当前数据截至 {dataDate}，每次小红书日常看板成功更新后重新计算。</p></div></div><div className="data-flow"><div><b>聚光投放明细</b><span>按笔记、日期记录消耗、曝光、点击与组件点击</span></div><em>→</em><div><b>时间窗口聚合</b><span>计算近3日、近7日、前7日与累计表现</span></div><em>→</em><div><b>动态同组比较</b><span>同选题分类/方向、同窗口、投放中有效样本</span></div><em>→</em><div><b>预警协作队列</b><span>触发分级、认领处理、备注与复查</span></div></div><aside><strong>重要</strong><p>这不是小时级实时数据。“实时调整”指每天数据更新后，基准、中位数、阈值和预警结果会随最新投放列表自动重算。</p></aside></section>

      <section><div className="guide-section-title"><i>02</i><div><h3>动态基准如何计算</h3><p>官号不会与供应商直接共用同一个固定标准。</p></div></div><div className="benchmark-visual"><div className="benchmark-step"><span>第一层</span><b>同一时间窗口</b><small>近3日比较近3日，近7日比较近7日</small></div><div className="benchmark-step"><span>第二层</span><b>同一选题分类</b><small>官号、供应商、达人等分类分别计算</small></div><div className="benchmark-step"><span>第三层</span><b>优先同一选题方向</b><small>同方向有效样本≥4时使用更细分基准</small></div><div className="benchmark-step"><span>第四层</span><b>仅使用有效投放样本</b><small>投放中、窗口消耗≥100元且组件点击&gt;0</small></div></div><div className="formula-card"><div><span>动态中位数</span><b>同组有效笔记组件成本的中位值</b></div><strong>×</strong><div><span>样本修正系数</span><b>1.5 / 1.65 / 1.8</b><small>样本越少，触发要求越严格</small></div><strong>=</strong><div className="result"><span>预警阈值</span><b>每次日更动态变化</b></div></div></section>

      <section><div className="guide-section-title"><i>03</i><div><h3>什么情况下触发</h3><p>{rule}</p></div></div><div className="trigger-grid"><div className="p0"><span>P0</span><b>近期恶化</b><p>成本较前7日明显上升，或近3日突然超过动态阈值，需要优先调控。</p></div><div className="p0"><span>P0</span><b>近期零转化</b><p>近3日或近7日已有明显消耗，但组件点击为0，优先检查组件和承接。</p></div><div className="p1"><span>P1</span><b>持续高成本</b><p>近7日组件成本持续超过动态阈值，但短期恶化幅度不突出。</p></div><div className="p3"><span>P3</span><b>近期改善</b><p>前7日曾高成本，近期已回落。保留观察，避免仅凭累计数据误停。</p></div></div><div className="rule-lane"><div><b>近7日主窗口</b><span>消耗 ≥ ¥300</span></div><em>或</em><div><b>近3日快速窗口</b><span>消耗 ≥ ¥150</span></div><em>+</em><div><b>成本异常</b><span>超过动态阈值或组件点击为0</span></div></div></section>

      <section><div className="guide-section-title"><i>04</i><div><h3>筛选与排序怎么用</h3><p>先缩小业务范围，再决定代理当天优先处理顺序。</p></div></div><div className="filter-guide"><div><span>投放状态</span><b>投放中</b><p>当天优先处理；疑似拉停用于确认是否仍需调整；已拉停主要复盘。</p></div><div><span>风险趋势</span><b>先看近期恶化 / 零转化</b><p>识别当前正在变差的笔记；近期改善只需观察，不应与高危同等处理。</p></div><div><span>处理状态</span><b>仅看未完成</b><p>默认隐藏已有结论的任务，也可切换查看全部历史处理结果。</p></div><div><span>负责人</span><b>只看我的</b><p>每位同事快速聚焦自己认领的笔记，避免多人重复操作。</p></div><div><span>排序</span><b>优先级 / 环比 / 成本 / 消耗</b><p>按业务问题选择排序，不能只按累计消耗判断是否应该拉停。</p></div></div></section>

      <section><div className="guide-section-title"><i>05</i><div><h3>推荐操作流程</h3><p>每条预警应形成负责人、动作、结论与复查依据。</p></div></div><ol className="operation-flow"><li><i>1</i><div><b>筛选今日重点</b><span>选择“投放中 + 近期恶化/近期零转化”，按优先级或成本环比排序。</span></div></li><li><i>2</i><div><b>打开详情判断</b><span>比较近3日、近7日与前7日，核对动态中位数、阈值和有效样本数。</span></div></li><li><i>3</i><div><b>认领并执行</b><span>认领任务，选择暂停、降预算、调定向、优化素材或检查组件等动作。</span></div></li><li><i>4</i><div><b>记录处理依据</b><span>备注为什么调整、调整了什么、预计何时复查，供所有同事实时查看。</span></div></li><li><i>5</i><div><b>形成结论</b><span>标记已处理或无需处理；次日数据更新后确认成本是否改善。</span></div></li></ol></section>

      <section><div className="guide-section-title"><i>06</i><div><h3>Excel 导出包含什么</h3><p>右上角“导出 Excel”会下载可继续分析的完整工作簿。</p></div></div><div className="excel-guide"><div><b>当前筛选</b><span>只导出页面当前筛选后的笔记，适合直接分发给执行同事。</span></div><div><b>全部预警</b><span>包含全部状态、窗口指标、动态基准、触发原因及协作处理字段。</span></div><div><b>口径说明</b><span>记录数据日期、动态规则和基准说明，避免脱离看板后误读数据。</span></div></div></section>

      <section className="guide-caution"><div className="guide-section-title"><i>!</i><div><h3>使用时不要这样判断</h3></div></div><div><p><b>不要只看累计消耗：</b>累计高不代表近期仍差，必须结合近3/7日与前7日。</p><p><b>不要只看一个成本数：</b>样本量、选题类别、方向和投放阶段都会影响合理成本。</p><p><b>不要把预警当自动停投指令：</b>预警用于缩小排查范围，最终动作仍需结合素材、定向、承接和业务目标判断。</p></div></section>
    </div>
    <footer className="guide-footer"><span>当前数据日期：{dataDate}</span><button onClick={onClose}>我已了解，开始使用</button></footer>
  </section></div>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: string }) { return <div className={`risk-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }

function AlertRow({ alert, actor, saving, onUpdate, onOpen }: { alert: Alert; actor: string; saving: boolean; onUpdate: (alert: Alert, changes: Partial<Alert>) => void; onOpen: (alert: Alert) => void }) {
  return <article className={`alert-row ${classForStatus(alert.delivery_status)}`}><button className="alert-main" onClick={() => onOpen(alert)}><div className="alert-status"><span>{alert.risk_priority}</span><b>{alert.risk_trend}</b><small>{alert.delivery_status}</small></div><div className="alert-note"><div><h4>{alert.title}</h4><a href={alert.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>打开笔记 ↗</a></div><p>{alert.creator} · {alert.account} · {alert.category} / {alert.direction}</p><span>{alert.risk_reason}</span></div><div className="alert-numbers four"><div><span>近7日消耗</span><b>{money(alert.spend_7d)}</b><small>累计 {money(alert.spend)}</small></div><div><span>近7日组件成本</span><b>{alert.action_clicks_7d ? money(alert.action_cost_7d) : "无点击"}</b><small>前7日 {alert.action_clicks_prev_7d ? money(alert.action_cost_prev_7d) : "—"}</small></div><div><span>累计组件成本</span><b>{alert.action_clicks ? money(alert.action_cost) : "无点击"}</b><small>累计组件点击 {alert.action_clicks}</small></div><div><span>成本环比</span><b className={(alert.cost_change_7d || 0) > 0 ? "up" : "down"}>{percent(alert.cost_change_7d)}</b><small>动态阈值 {money(alert.threshold_cost)}</small></div></div></button><div className="alert-actions"><button className={alert.owner ? "claimed" : ""} onClick={() => onUpdate(alert, { owner: actor, resolution: alert.resolution === "pending" ? "processing" : alert.resolution })}>{alert.owner || "认领处理"}</button><select value={alert.resolution} disabled={saving} onChange={(event) => onUpdate(alert, { resolution: event.target.value as Resolution })}>{Object.entries(resolutionText).map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><select value={alert.action_type} disabled={saving} onChange={(event) => onUpdate(alert, { action_type: event.target.value })}>{actionChoices.map((value) => <option value={value} key={value}>{value || "选择处理动作"}</option>)}</select><button className="detail" onClick={() => onOpen(alert)}>查看趋势与备注</button></div></article>;
}

function AlertDrawer({ alert, activity, saving, onClose, onUpdate }: { alert: Alert; activity: Activity[]; saving: boolean; onClose: () => void; onUpdate: (alert: Alert, changes: Partial<Alert>) => void }) {
  const [notes, setNotes] = useState(alert.notes || "");
  return <div className="risk-drawer-bg" onMouseDown={onClose}><aside className="risk-drawer" onMouseDown={(event) => event.stopPropagation()}><header><span>{alert.risk_priority} · {alert.risk_trend}</span><button onClick={onClose}>×</button></header><h3>{alert.title}</h3><div className="drawer-total-cost"><span>累计组件（行动按钮）点击成本</span><b>{alert.action_clicks ? money(alert.action_cost) : "无点击"}</b><small>累计消耗 {money(alert.spend)} ÷ 累计组件点击 {alert.action_clicks}</small></div><p>{alert.creator} · {alert.account} · {alert.category} / {alert.direction}</p><a href={alert.link} target="_blank" rel="noreferrer">在小红书打开笔记 ↗</a><section><h4>时间窗口对比</h4><div className="drawer-grid wide"><div><span>近3日消耗 / 成本</span><b>{money(alert.spend_3d)}</b><small>{alert.action_clicks_3d ? money(alert.action_cost_3d) : "无组件点击"}</small></div><div><span>近7日消耗 / 成本</span><b>{money(alert.spend_7d)}</b><small>{alert.action_clicks_7d ? money(alert.action_cost_7d) : "无组件点击"}</small></div><div><span>前7日消耗 / 成本</span><b>{money(alert.spend_prev_7d)}</b><small>{alert.action_clicks_prev_7d ? money(alert.action_cost_prev_7d) : "无可比数据"}</small></div><div><span>7日成本环比</span><b>{percent(alert.cost_change_7d)}</b><small>判断恶化或改善</small></div></div></section><section><h4>动态基准</h4><div className="benchmark-box"><div><span>基准范围</span><b>{alert.benchmark_scope}</b></div><div><span>有效样本</span><b>{alert.benchmark_samples} 篇</b></div><div><span>窗口中位数</span><b>{money(alert.category_median_cost)}</b></div><div><span>预警阈值</span><b>{money(alert.threshold_cost)}</b><small>{alert.benchmark_multiplier} × 中位数</small></div></div></section><section><h4>触发原因</h4><p className="reason-box">{alert.risk_reason}</p></section><section><h4>累计背景</h4><div className="drawer-grid"><div><span>累计消耗</span><b>{money(alert.spend)}</b></div><div><span>累计组件点击</span><b>{alert.action_clicks}</b></div><div><span>首投 / 最后投放</span><b>{alert.first_spend_date || "—"}</b><small>{alert.last_spend_date || "—"}</small></div></div></section><section><h4>处理结论</h4><div className="drawer-controls"><select value={alert.resolution} onChange={(event) => onUpdate(alert, { resolution: event.target.value as Resolution })}>{Object.entries(resolutionText).map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><select value={alert.action_type} onChange={(event) => onUpdate(alert, { action_type: event.target.value })}>{actionChoices.map((value) => <option value={value} key={value}>{value || "选择处理动作"}</option>)}</select></div></section><section><div className="drawer-title"><h4>协作备注</h4><span>所有同事可见</span></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录判断依据、调整动作、复查日期…" /><button className="save-notes" disabled={saving || notes === alert.notes} onClick={() => onUpdate(alert, { notes })}>保存备注</button></section><section><h4>操作记录</h4><div className="risk-history">{activity.length ? activity.map((item) => <div key={item.id}><i /><p><b>{item.actor}</b><span>{new Date(item.created_at).toLocaleString("zh-CN", { hour12: false })}</span></p><small>{formatActivity(item.detail)}</small></div>) : <p className="no-history">尚无协作记录</p>}</div></section><footer>数据日期 {alert.data_date} · 版本 {alert.version}</footer></aside></div>;
}

function formatActivity(detail: string) { try { const value = JSON.parse(detail); return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join("；"); } catch { return detail; } }
function NameDialog({ value, onChange, onSave, onClose }: { value: string; onChange: (value: string) => void; onSave: () => void; onClose: () => void }) { return <div className="risk-dialog-bg"><div className="risk-dialog"><span>警</span><h3>选择操作身份</h3><p>认领、处理和备注会显示这个名字，并同步给其他同事。</p><input autoFocus value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSave()} placeholder="请输入姓名" /><div><button onClick={onClose}>取消</button><button onClick={onSave} disabled={!value.trim()}>进入工作台</button></div></div></div>; }
