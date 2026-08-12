"use client";

import { useEffect, useMemo, useState } from "react";

type Task = {
  task_id:string; note_id:string; nickname:string; link:string; category:string; publish_date:string;
  current_deadline:string; judgment_node:string; delivery_status:string; spend_3d:number; comments_total:number;
  comments_3d:number|null; comments_7d:number|null; extension_reason:string; new_deadline:string;
  status:"pending"|"in_progress"|"completed"; owner:string; notes:string; version:number; updated_at:string;
};
type History = { id:number; task_id:string; note_id:string; actor:string; action:string; from_deadline:string; to_deadline:string; detail:string; created_at:string };

const money = (value:number) => `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
const statusText = { pending:"待跟进", in_progress:"跟进中", completed:"已完成" };

export function NegativeMonitorClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [actor, setActor] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<History[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const [historyNote, setHistoryNote] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/negative-monitor", { cache:"no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      setTasks(data.tasks || []); setHistory(data.history || []); setGeneratedAt(data.generated_at || "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "加载失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { setActor(localStorage.getItem("comment-maintenance-actor") || ""); void load(); }, []);

  const visible = useMemo(() => tasks.filter((task) => {
    if (filter === "active" && task.status === "completed") return false;
    if (filter !== "active" && filter !== "all" && task.status !== filter) return false;
    const text = `${task.nickname} ${task.note_id} ${task.category} ${task.extension_reason}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }), [tasks, filter, search]);
  const active = tasks.filter((task) => task.status !== "completed").length;
  const overdue = tasks.filter((task) => task.status !== "completed" && task.new_deadline && task.new_deadline < new Date().toISOString().slice(0,10)).length;
  const completed = tasks.filter((task) => task.status === "completed").length;

  const updateTask = async (task:Task, changes:Record<string,string>, action = "") => {
    const name = actor.trim() || window.prompt("请输入你的姓名，用于记录任务操作")?.trim() || "";
    if (!name) return;
    setActor(name); localStorage.setItem("comment-maintenance-actor", name); setSaving(task.task_id);
    try {
      const response = await fetch(`/api/negative-monitor/${encodeURIComponent(task.task_id)}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ actor:name, version:task.version, action, changes }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "保存失败");
      setTasks((current) => current.map((item) => item.task_id === task.task_id ? data.task : item));
      if (data.history_created) await load();
      setMessage("任务已更新");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(""); }
  };

  return <main className="negative-shell">
    <header className="negative-hero">
      <div><span className="eyebrow">NEGATIVE COMMENT EXTENSION</span><h1>负评监测延续</h1><p>集中跟进达到判断节点、仍需延长观察周期的投放笔记。历史任务持续保留，新任务由日常看板 PASS 后自动同步。</p></div>
      <div className="negative-sync"><span>最近同步</span><b>{generatedAt ? new Date(generatedAt).toLocaleString("zh-CN") : "暂无同步记录"}</b><div><button onClick={() => setShowGuide(true)}>看板说明</button><button onClick={() => void load()}>刷新数据</button></div></div>
    </header>
    <section className="negative-kpis">
      <article><span>当前待跟进</span><strong>{active}</strong><small>需要继续观察或处理</small></article>
      <article className={overdue ? "warning" : ""}><span>已超过新期限</span><strong>{overdue}</strong><small>建议优先复核</small></article>
      <article><span>已完成</span><strong>{completed}</strong><small>历史处理留档</small></article>
      <article><span>在监测消耗</span><strong>{money(tasks.filter(t=>t.status!=="completed").reduce((sum,t)=>sum+Number(t.spend_3d||0),0))}</strong><small>当前任务近 3 日消耗</small></article>
    </section>
    <section className="negative-workspace">
      <div className="negative-toolbar"><div><h2>延续任务清单</h2><p>认领后可更新进度与处理备注</p></div><input aria-label="搜索任务" placeholder="搜索昵称、笔记 ID、原因" value={search} onChange={(e)=>setSearch(e.target.value)} /><select aria-label="筛选状态" value={filter} onChange={(e)=>setFilter(e.target.value)}><option value="active">进行中的任务</option><option value="pending">待跟进</option><option value="in_progress">跟进中</option><option value="completed">已完成</option><option value="all">全部历史</option></select></div>
      {loading ? <div className="negative-empty">正在加载任务…</div> : visible.length === 0 ? <div className="negative-empty"><b>当前没有符合条件的任务</b><span>没有新延续时不会清空历史，也不会重复发送群提醒。</span></div> : <div className="negative-list">{visible.map((task) => <article className="negative-card" key={task.task_id}>
        <div className="negative-card-head"><div><span className={`negative-status ${task.status}`}>{statusText[task.status]}</span><b>{task.nickname || "未知账号"}</b><small>{task.category || "未分类"} · 发布于 {task.publish_date || "-"}</small></div>{task.link && <a href={task.link} target="_blank" rel="noreferrer">打开笔记 ↗</a>}</div>
        <div className="negative-reason"><span>延续原因</span><strong>{task.extension_reason || "达到判断节点，需继续观察"}</strong><small>{task.judgment_node || ""}</small></div>
        <div className="negative-metrics"><div><span>原期限 → 新期限</span><b>{task.current_deadline || "-"} → {task.new_deadline || "-"}</b></div><div><span>近 3 日消耗</span><b>{money(task.spend_3d)}</b></div><div><span>评论总量</span><b>{task.comments_total}</b><small>3日 {task.comments_3d ?? "-"} / 7日 {task.comments_7d ?? "-"}</small></div><div><span>投放状态</span><b>{task.delivery_status || "-"}</b></div></div>
        <div className="negative-actions"><label>负责人<input value={task.owner || ""} placeholder="点击认领后自动填写" onChange={(e)=>setTasks(c=>c.map(t=>t.task_id===task.task_id?{...t,owner:e.target.value}:t))} /></label><label className="negative-notes">处理备注<textarea value={task.notes || ""} placeholder="记录负评变化、处理动作或下一次复核重点" onChange={(e)=>setTasks(c=>c.map(t=>t.task_id===task.task_id?{...t,notes:e.target.value}:t))} /></label><div className="negative-buttons"><button className="extend" disabled={saving===task.task_id} onClick={()=>void updateTask(task,{ owner:task.owner || actor },"extend_t7")}>延续 T+7 天</button><button disabled={saving===task.task_id} onClick={()=>void updateTask(task,{ owner:task.owner || actor, status:"in_progress", notes:task.notes || "" })}>{task.status === "pending" ? "认领并跟进" : "保存进展"}</button><button className="complete" disabled={saving===task.task_id} onClick={()=>void updateTask(task,{ owner:task.owner || actor, status:"completed", notes:task.notes || "" })}>标记完成</button><button className="history" onClick={()=>setHistoryNote(task.note_id)}>历史记录 ({history.filter(h=>h.note_id===task.note_id).length})</button></div></div>
      </article>)}</div>}
    </section>
    {showGuide && <div className="negative-modal-backdrop" onClick={()=>setShowGuide(false)}><section className="negative-guide" onClick={(e)=>e.stopPropagation()}><button className="guide-close" onClick={()=>setShowGuide(false)}>×</button><span className="eyebrow">DASHBOARD GUIDE</span><h2>负评监测延续看板说明</h2><p className="guide-lead">仅监测 2026-06-01 起发布的供应商或定制达人笔记。系统在每个到期节点使用聚光消耗和蒲公英评论增量判断是否再延续 7 天。</p><div className="guide-flow"><article><b>01</b><strong>基础范围</strong><span>供应商/定制达人、发布日 ≥ 2026-06-01，且有可用蒲公英历史快照</span></article><i>→</i><article><b>02</b><strong>到期判断</strong><span>首次节点为发布 T+14；之后只在当前期限到达数据水位线时判断</span></article><i>→</i><article><b>03</b><strong>延续条件</strong><span>到期近 3 日消费 ≥ 100 元，或近 3 日新增评论 ≥ 5 条</span></article><i>→</i><article><b>04</b><strong>延续 7 天</strong><span>满足任一条件则期限 +7 天，并仅提醒“二手车投放&评论”</span></article></div><div className="logic-cards negative-logic"><article><span>首次初始化</span><ul><li>笔记发布已满 14 天</li><li>最新近 3 个自然日聚光消费 ≥ 100 元</li><li>满足后从当天起建立 7 天监测期</li></ul></article><article><span>日常延续｜满足任一</span><ul><li>到期节点近 3 个自然日聚光消费 ≥ 100 元</li><li>到期节点蒲公英近 3 个自然日新增评论 ≥ 5 条</li><li>新期限 = 当前期限 + 7 天</li></ul></article><article><span>结束与不生成</span><ul><li>两项延续条件都不满足则结束监测</li><li>期限尚未到达数据水位线则暂不判断</li><li>已经处理过的期限节点不会重复生成</li><li>没有新延续时保留历史且不提醒</li></ul></article><article><span>排序与去重</span><ul><li>任务按类别、近 3 日消费降序、发布日期排序</li><li>唯一任务由笔记 ID + 原期限 + 新期限组成</li><li>同一任务再次同步只刷新数据，不覆盖人工状态</li><li>手动“延续 T+7”也会写入历史记录</li></ul></article></div><div className="guide-grid"><article><h3>如何处理</h3><ol><li>核对延续原因、评论增量和投放状态</li><li>填写负责人并记录处理备注</li><li>需要继续观察时点“延续 T+7 天”</li><li>闭环后标记完成，记录仍保留在历史中</li></ol></article><article><h3>通知边界</h3><ul><li>主流程非 PASS：不写入旧数据，不发群消息</li><li>负评延续：只发“二手车投放&评论”</li><li>评论维护：只发 F66-XHS</li><li>没有新任务：保留历史，不重复提醒</li></ul></article><article><h3>状态含义</h3><div className="guide-status"><span>待跟进</span><b>尚未认领</b><span>跟进中</span><b>已认领或已延续</b><span>已完成</span><b>本轮处理闭环</b></div></article></div></section></div>}
    {historyNote && <div className="negative-modal-backdrop" onClick={()=>setHistoryNote("")}><section className="negative-history" onClick={(e)=>e.stopPropagation()}><button className="guide-close" onClick={()=>setHistoryNote("")}>×</button><h2>历史处理记录</h2><p>笔记 ID：{historyNote}</p><div>{history.filter(h=>h.note_id===historyNote).length ? history.filter(h=>h.note_id===historyNote).map((item)=><article key={item.id}><i></i><div><b>{item.action === "extend_t7" ? "延续 T+7 天" : "标记完成"}</b><span>{item.from_deadline}{item.to_deadline && item.to_deadline!==item.from_deadline ? ` → ${item.to_deadline}` : ""}</span><small>{item.actor} · {new Date(item.created_at).toLocaleString("zh-CN")}</small><p>{item.detail}</p></div></article>) : <div className="negative-empty">暂无历史处理记录</div>}</div></section></div>}
    {message && <button className="negative-toast" onClick={()=>setMessage("")}>{message}</button>}
  </main>;
}
