"use client";

import { useEffect, useMemo, useState } from "react";

type Task = {
  task_id:string; note_id:string; nickname:string; link:string; category:string; publish_date:string;
  current_deadline:string; judgment_node:string; delivery_status:string; spend_3d:number; comments_total:number;
  comments_3d:number|null; comments_7d:number|null; extension_reason:string; new_deadline:string;
  status:"pending"|"in_progress"|"completed"; owner:string; notes:string; version:number; updated_at:string;
};

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

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/negative-monitor", { cache:"no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      setTasks(data.tasks || []); setGeneratedAt(data.generated_at || "");
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

  const updateTask = async (task:Task, changes:Record<string,string>) => {
    const name = actor.trim() || window.prompt("请输入你的姓名，用于记录任务操作")?.trim() || "";
    if (!name) return;
    setActor(name); localStorage.setItem("comment-maintenance-actor", name); setSaving(task.task_id);
    try {
      const response = await fetch(`/api/negative-monitor/${encodeURIComponent(task.task_id)}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ actor:name, version:task.version, changes }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "保存失败");
      setTasks((current) => current.map((item) => item.task_id === task.task_id ? data.task : item));
      setMessage("任务已更新");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(""); }
  };

  return <main className="negative-shell">
    <header className="negative-hero">
      <div><span className="eyebrow">NEGATIVE COMMENT EXTENSION</span><h1>负评监测延续</h1><p>集中跟进达到判断节点、仍需延长观察周期的投放笔记。历史任务持续保留，新任务由日常看板 PASS 后自动同步。</p></div>
      <div className="negative-sync"><span>最近同步</span><b>{generatedAt ? new Date(generatedAt).toLocaleString("zh-CN") : "暂无同步记录"}</b><button onClick={() => void load()}>刷新数据</button></div>
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
        <div className="negative-actions"><label>负责人<input value={task.owner || ""} placeholder="点击认领后自动填写" onChange={(e)=>setTasks(c=>c.map(t=>t.task_id===task.task_id?{...t,owner:e.target.value}:t))} /></label><label className="negative-notes">处理备注<textarea value={task.notes || ""} placeholder="记录负评变化、处理动作或下一次复核重点" onChange={(e)=>setTasks(c=>c.map(t=>t.task_id===task.task_id?{...t,notes:e.target.value}:t))} /></label><div className="negative-buttons"><button disabled={saving===task.task_id} onClick={()=>void updateTask(task,{ owner:task.owner || actor, status:"in_progress", notes:task.notes || "" })}>{task.status === "pending" ? "认领并跟进" : "保存进展"}</button><button className="complete" disabled={saving===task.task_id} onClick={()=>void updateTask(task,{ owner:task.owner || actor, status:"completed", notes:task.notes || "" })}>标记完成</button></div></div>
      </article>)}</div>}
    </section>{message && <button className="negative-toast" onClick={()=>setMessage("")}>{message}</button>}
  </main>;
}
