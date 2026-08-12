"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Resolution = "pending" | "processing" | "resolved" | "ignored";
type Alert = {
  note_id: string; data_date: string; title: string; link: string; creator: string; publish_date: string;
  category: string; direction: string; delivery_status: string; first_spend_date: string; last_spend_date: string;
  delivery_days: number; no_spend_days: number; spend: number; action_clicks: number; action_cost: number;
  category_median_cost: number; risk_ratio: number | null; risk_reason: string; owner: string;
  resolution: Resolution; action_type: string; notes: string; version: number; updated_at: string;
};
type Activity = { id: number; note_id: string; actor: string; detail: string; created_at: string };
type Payload = { generated_at?: string; data_date?: string; source_name?: string; rule?: string; summary?: Record<string, number>; alerts: Alert[]; activity?: Activity[] };

const resolutionText: Record<Resolution, string> = { pending: "待处理", processing: "处理中", resolved: "已处理", ignored: "无需处理" };
const actionChoices = ["", "暂停投放", "降低预算", "调整定向", "优化素材", "检查组件", "继续观察", "无需调整"];
const money = (value: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value || 0);

export function RiskAlertClient() {
  const [data, setData] = useState<Payload>({ alerts: [] });
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [showName, setShowName] = useState(false);
  const [status, setStatus] = useState("active");
  const [resolution, setResolution] = useState("open");
  const [owner, setOwner] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("spend");
  const [selected, setSelected] = useState<Alert | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/risk-alerts", { cache: "no-store" });
      const api = response.ok ? await response.json() as Payload : { alerts: [] };
      if (api.alerts?.length) setData(api);
      else {
        const fallback = await fetch("/data/risk-alerts.json", { cache: "no-store" }).then((item) => item.json()) as Payload;
        const sync = await fetch("/api/risk-alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fallback) });
        setData(fallback);
        if (!sync.ok) setMessage("当前为只读数据预览，协作保存服务暂未连接。");
      }
    } catch {
      const fallback = await fetch("/data/risk-alerts.json", { cache: "no-store" }).then((item) => item.json()) as Payload;
      setData(fallback); setMessage("当前为只读数据预览，协作保存服务暂未连接。");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("risk-alert-actor") || "";
    setActor(stored); setNameDraft(stored); setShowName(!stored); void load();
  }, [load]);

  const saveName = () => {
    const clean = nameDraft.trim(); if (!clean) return;
    localStorage.setItem("risk-alert-actor", clean); setActor(clean); setShowName(false);
  };

  const update = async (alert: Alert, changes: Partial<Alert>) => {
    if (!actor) { setShowName(true); return; }
    setSaving(alert.note_id); setMessage("");
    const optimistic = { ...alert, ...changes, owner: changes.owner ?? alert.owner ?? actor };
    setData((current) => ({ ...current, alerts: current.alerts.map((item) => item.note_id === alert.note_id ? optimistic : item) }));
    setSelected((current) => current?.note_id === alert.note_id ? optimistic : current);
    try {
      const response = await fetch(`/api/risk-alerts/${encodeURIComponent(alert.note_id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor, version: alert.version, changes }),
      });
      const result = await response.json() as { alert?: Alert; error?: string };
      if (!response.ok || !result.alert) throw new Error(result.error || "保存失败");
      setData((current) => ({ ...current, alerts: current.alerts.map((item) => item.note_id === alert.note_id ? result.alert! : item) }));
      setSelected((current) => current?.note_id === alert.note_id ? result.alert! : current);
      setMessage(`已同步 · ${actor}`);
    } catch (error) {
      setData((current) => ({ ...current, alerts: current.alerts.map((item) => item.note_id === alert.note_id ? alert : item) }));
      setSelected((current) => current?.note_id === alert.note_id ? alert : current);
      setMessage(error instanceof Error ? error.message : "保存失败，请重试");
    } finally { setSaving(""); }
  };

  const owners = useMemo(() => Array.from(new Set(data.alerts.map((item) => item.owner).filter(Boolean))).sort(), [data.alerts]);
  const filtered = useMemo(() => data.alerts.filter((item) => {
    if (status !== "all" && item.delivery_status !== status) return false;
    if (resolution === "open" && ["resolved", "ignored"].includes(item.resolution)) return false;
    if (resolution !== "all" && resolution !== "open" && item.resolution !== resolution) return false;
    if (owner === "mine" && item.owner !== actor) return false;
    if (owner !== "all" && owner !== "mine" && item.owner !== owner) return false;
    const keyword = search.trim().toLowerCase();
    return !keyword || `${item.title} ${item.creator} ${item.note_id} ${item.category} ${item.direction}`.toLowerCase().includes(keyword);
  }).sort((a, b) => sort === "cost" ? b.action_cost - a.action_cost : sort === "ratio" ? (b.risk_ratio || 999) - (a.risk_ratio || 999) : b.spend - a.spend), [actor, data.alerts, owner, resolution, search, sort, status]);

  const summary = useMemo(() => ({
    total: data.alerts.length,
    open: data.alerts.filter((item) => !["resolved", "ignored"].includes(item.resolution)).length,
    processing: data.alerts.filter((item) => item.resolution === "processing").length,
    resolved: data.alerts.filter((item) => ["resolved", "ignored"].includes(item.resolution)).length,
    spend: data.alerts.filter((item) => ["投放中", "疑似拉停"].includes(item.delivery_status)).reduce((sum, item) => sum + item.spend, 0),
  }), [data.alerts]);

  return <main className="risk-shell">
    <header className="risk-topbar">
      <div className="risk-brand"><span>警</span><div><h1>高成本预警协作看板</h1><p>发现、认领、处理、复盘，全程多人同步</p></div></div>
      <div className="risk-head-actions"><a href="/">评论监测看板</a><button onClick={() => setShowName(true)}><i>{actor ? actor.slice(0, 1) : "?"}</i>{actor || "选择操作人"}</button></div>
    </header>

    <section className="risk-hero">
      <div><span className="risk-eyebrow">数据截至 {data.data_date || "—"}</span><h2><strong>{summary.open}</strong> 条预警待推进，涉及消耗 <em>{money(summary.spend)}</em></h2><p>{data.rule}</p></div>
      <div className="risk-hero-stat"><b>{summary.resolved}/{summary.total}</b><span>已形成处理结论</span><small>{summary.processing} 条正在处理中</small></div>
    </section>

    <section className="risk-kpis">
      <Metric label="待推进" value={summary.open} detail="投放中与疑似拉停优先" tone="red" />
      <Metric label="处理中" value={summary.processing} detail="已有同事认领跟进" tone="amber" />
      <Metric label="已形成结论" value={summary.resolved} detail="已处理或确认无需处理" tone="green" />
      <Metric label="预警总消耗" value={money(summary.spend)} detail="仅投放中与疑似拉停" tone="blue" />
    </section>

    <section className="risk-board">
      <div className="risk-board-head"><div><span>ALERT QUEUE</span><h3>预警笔记处理队列</h3><p>显示 {filtered.length} / {data.alerts.length} 条</p></div><div className="risk-status-tabs">{["active", "投放中", "疑似拉停", "已拉停", "all"].map((value) => <button className={status === value ? "active" : ""} onClick={() => setStatus(value === "active" ? "投放中" : value)} key={value}>{value === "active" ? "优先处理" : value === "all" ? "全部" : value}</button>)}</div></div>
      <div className="risk-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、达人、笔记ID、选题" /><select value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="open">仅看未完成</option><option value="all">全部处理状态</option><option value="pending">待处理</option><option value="processing">处理中</option><option value="resolved">已处理</option><option value="ignored">无需处理</option></select><select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">全部负责人</option><option value="mine">只看我的</option>{owners.map((name) => <option key={name}>{name}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="spend">按消耗排序</option><option value="cost">按点击成本排序</option><option value="ratio">按超标倍数排序</option></select><button onClick={() => void load()}>刷新数据</button></div>
      <div className="alert-list">{loading ? <div className="risk-empty">正在加载预警…</div> : filtered.length ? filtered.map((alert) => <AlertRow key={alert.note_id} alert={alert} actor={actor} saving={saving === alert.note_id} onUpdate={update} onOpen={setSelected} />) : <div className="risk-empty"><b>当前筛选下没有预警</b><span>可以切换状态或清空搜索条件。</span></div>}</div>
    </section>
    {selected && <AlertDrawer alert={selected} activity={(data.activity || []).filter((item) => item.note_id === selected.note_id)} saving={saving === selected.note_id} onClose={() => setSelected(null)} onUpdate={update} />}
    {showName && <NameDialog value={nameDraft} onChange={setNameDraft} onSave={saveName} onClose={() => actor && setShowName(false)} />}
    {message && <div className="risk-toast">{message}</div>}
  </main>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: string }) { return <div className={`risk-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }

function AlertRow({ alert, actor, saving, onUpdate, onOpen }: { alert: Alert; actor: string; saving: boolean; onUpdate: (alert: Alert, changes: Partial<Alert>) => void; onOpen: (alert: Alert) => void }) {
  return <article className={`alert-row ${alert.delivery_status === "投放中" ? "active" : alert.delivery_status === "疑似拉停" ? "suspected" : "stopped"}`}>
    <button className="alert-main" onClick={() => onOpen(alert)}>
      <div className="alert-status"><span>{alert.delivery_status}</span><b>{alert.risk_ratio ? `${alert.risk_ratio.toFixed(1)}×` : "空耗"}</b><small>{alert.category}</small></div>
      <div className="alert-note"><div><h4>{alert.title}</h4><a href={alert.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>打开笔记 ↗</a></div><p>{alert.creator} · {alert.direction} · 发布于 {alert.publish_date || "未匹配"}</p><span>{alert.risk_reason}</span></div>
      <div className="alert-numbers"><div><span>累计消耗</span><b>{money(alert.spend)}</b></div><div><span>行动点击</span><b>{alert.action_clicks}</b></div><div><span>点击成本 / 中位数</span><b>{alert.action_clicks ? money(alert.action_cost) : "无点击"}</b><small>{money(alert.category_median_cost)}</small></div></div>
    </button>
    <div className="alert-actions"><button className={alert.owner ? "claimed" : ""} onClick={() => onUpdate(alert, { owner: actor, resolution: alert.resolution === "pending" ? "processing" : alert.resolution })}>{alert.owner || "认领处理"}</button><select value={alert.resolution} disabled={saving} onChange={(event) => onUpdate(alert, { resolution: event.target.value as Resolution })}>{Object.entries(resolutionText).map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><select value={alert.action_type} disabled={saving} onChange={(event) => onUpdate(alert, { action_type: event.target.value })}>{actionChoices.map((value) => <option value={value} key={value}>{value || "选择处理动作"}</option>)}</select><button className="detail" onClick={() => onOpen(alert)}>详情与备注</button></div>
  </article>;
}

function AlertDrawer({ alert, activity, saving, onClose, onUpdate }: { alert: Alert; activity: Activity[]; saving: boolean; onClose: () => void; onUpdate: (alert: Alert, changes: Partial<Alert>) => void }) {
  const [notes, setNotes] = useState(alert.notes || "");
  return <div className="risk-drawer-bg" onMouseDown={onClose}><aside className="risk-drawer" onMouseDown={(event) => event.stopPropagation()}><header><span>{alert.delivery_status}</span><button onClick={onClose}>×</button></header><h3>{alert.title}</h3><p>{alert.creator} · {alert.category} / {alert.direction}</p><a href={alert.link} target="_blank" rel="noreferrer">在小红书打开笔记 ↗</a><div className="drawer-grid"><div><span>累计消耗</span><b>{money(alert.spend)}</b></div><div><span>行动按钮点击</span><b>{alert.action_clicks}</b></div><div><span>行动点击成本</span><b>{alert.action_clicks ? money(alert.action_cost) : "无点击"}</b></div><div><span>分类中位成本</span><b>{money(alert.category_median_cost)}</b></div><div><span>首投 / 最后投放</span><b>{alert.first_spend_date || "—"}</b><small>{alert.last_spend_date || "—"}</small></div><div><span>投放天数</span><b>{alert.delivery_days}</b><small>无消耗 {alert.no_spend_days} 天</small></div></div><section><h4>触发原因</h4><p className="reason-box">{alert.risk_reason}</p></section><section><h4>处理结论</h4><div className="drawer-controls"><select value={alert.resolution} onChange={(event) => onUpdate(alert, { resolution: event.target.value as Resolution })}>{Object.entries(resolutionText).map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select><select value={alert.action_type} onChange={(event) => onUpdate(alert, { action_type: event.target.value })}>{actionChoices.map((value) => <option value={value} key={value}>{value || "选择处理动作"}</option>)}</select></div></section><section><div className="drawer-title"><h4>协作备注</h4><span>所有同事可见</span></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录排查结论、调整内容、后续观察日期…" /><button className="save-notes" disabled={saving || notes === alert.notes} onClick={() => onUpdate(alert, { notes })}>保存备注</button></section><section><h4>操作记录</h4><div className="risk-history">{activity.length ? activity.map((item) => <div key={item.id}><i /><p><b>{item.actor}</b><span>{new Date(item.created_at).toLocaleString("zh-CN", { hour12: false })}</span></p><small>{formatActivity(item.detail)}</small></div>) : <p className="no-history">尚无协作记录</p>}</div></section><footer>数据日期 {alert.data_date} · 版本 {alert.version}</footer></aside></div>;
}

function formatActivity(detail: string) { try { const value = JSON.parse(detail); return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join("；"); } catch { return detail; } }
function NameDialog({ value, onChange, onSave, onClose }: { value: string; onChange: (value: string) => void; onSave: () => void; onClose: () => void }) { return <div className="risk-dialog-bg"><div className="risk-dialog"><span>警</span><h3>选择你的操作身份</h3><p>认领、处理和备注都会显示这个名字，并实时同步给其他同事。</p><input autoFocus value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSave()} placeholder="请输入姓名" /><div><button onClick={onClose}>取消</button><button onClick={onSave} disabled={!value.trim()}>进入工作台</button></div></div></div>; }
