"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Task = {
  task_id: string;
  note_id: string;
  title: string;
  nickname: string;
  link: string;
  publish_date: string;
  task_date: string;
  priority: "P0" | "P1" | "P2";
  score: number;
  cadence_days: number;
  reasons: string[];
  spend_3d: number;
  spend_7d: number;
  spend_total: number;
  active_days_7d: number;
  action_clicks_3d: number;
  comments_total: number;
  comments_3d: number | null;
  comments_7d: number | null;
  cycle_number: number;
  status: "pending" | "assigned" | "in_progress" | "completed";
  owner: string;
  review_done: boolean;
  placement_done: boolean;
  dealer_guard_done: boolean;
  reply_done: boolean;
  recheck_done: boolean;
  placement_count: number;
  risk_tag: string;
  notes: string;
  version: number;
  updated_at?: string;
};

type DashboardData = {
  generated_at?: string;
  task_date?: string;
  data_freshness?: {
    spotlight_as_of?: string;
    pgy_as_of?: string;
    pgy_snapshot_as_of?: string;
  };
  scope?: { eligible_notes?: number; published_since?: string };
  tasks: Task[];
  owners?: string[];
};

const steps = [
  ["review_done", "人工审核"],
  ["placement_done", "二次铺设"],
  ["dealer_guard_done", "防车商"],
  ["reply_done", "评论回复"],
  ["recheck_done", "复查完成"],
] as const;

const priorityText = { P0: "核心·每日", P1: "重点·3日", P2: "巡检·7日" };
const statusText = { pending: "待领取", assigned: "已领取", in_progress: "处理中", completed: "本轮完成" };

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value || 0);
}

function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function progress(task: Task) {
  return steps.filter(([key]) => task[key]).length;
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardData>({ tasks: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [actor, setActor] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [showName, setShowName] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [priority, setPriority] = useState("all");
  const [status, setStatus] = useState("active");
  const [owner, setOwner] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("priority");
  const [saving, setSaving] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [fallbackResponse, apiResponse] = await Promise.all([
        fetch("/data/dashboard.json", { cache: "no-store" }),
        fetch("/api/dashboard", { cache: "no-store" }),
      ]);
      const fallback = (await fallbackResponse.json()) as DashboardData;
      let api = apiResponse.ok ? ((await apiResponse.json()) as DashboardData) : { tasks: [] };
      if (!api.tasks?.length) {
        const sync = await fetch("/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fallback),
        });
        if (sync.ok) {
          const refreshed = await fetch("/api/dashboard", { cache: "no-store" });
          if (refreshed.ok) api = (await refreshed.json()) as DashboardData;
        }
      }
      setData(api.tasks?.length ? api : fallback);
      if (!api.tasks?.length) setMessage("当前为只读数据预览，协作保存服务暂未连接。");
    } catch {
      try {
        const fallback = await fetch("/data/dashboard.json", { cache: "no-store" }).then((res) => res.json());
        setData(fallback);
        setMessage("当前为只读数据预览，协作保存服务暂未连接。");
      } catch {
        setMessage("数据加载失败，请稍后刷新。");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("comment-maintenance-actor") || "";
    setActor(stored);
    setNameDraft(stored);
    setShowName(!stored);
    void loadDashboard();
  }, [loadDashboard]);

  const saveActor = () => {
    const clean = nameDraft.trim();
    if (!clean) return;
    window.localStorage.setItem("comment-maintenance-actor", clean);
    setActor(clean);
    setShowName(false);
  };

  const updateTask = async (task: Task, changes: Partial<Task>) => {
    if (!actor) {
      setShowName(true);
      return;
    }
    setSaving(task.task_id);
    setMessage("");
    const optimistic = { ...task, ...changes, owner: changes.owner ?? (task.owner || actor) } as Task;
    setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.task_id === task.task_id ? optimistic : item) }));
    setSelected((current) => current?.task_id === task.task_id ? optimistic : current);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.task_id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor, version: task.version, changes }),
      });
      const payload = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error || "保存失败");
      setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.task_id === task.task_id ? payload.task! : item) }));
      setSelected((current) => current?.task_id === task.task_id ? payload.task! : current);
      setMessage(`已保存 · ${actor}`);
    } catch (error) {
      setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.task_id === task.task_id ? task : item) }));
      setSelected((current) => current?.task_id === task.task_id ? task : current);
      setMessage(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setSaving("");
    }
  };

  const owners = useMemo(() => Array.from(new Set([actor, ...(data.owners || []), ...data.tasks.map((task) => task.owner)].filter(Boolean))).sort(), [actor, data.owners, data.tasks]);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = data.tasks.filter((task) => {
      if (priority !== "all" && task.priority !== priority) return false;
      if (status === "active" && task.status === "completed") return false;
      if (status !== "all" && status !== "active" && task.status !== status) return false;
      if (owner === "mine" && task.owner !== actor) return false;
      if (owner !== "all" && owner !== "mine" && task.owner !== owner) return false;
      return !keyword || `${task.title} ${task.nickname} ${task.note_id}`.toLowerCase().includes(keyword);
    });
    return rows.sort((a, b) => {
      if (sort === "spend") return b.spend_3d - a.spend_3d;
      if (sort === "comments") return b.comments_total - a.comments_total;
      if (sort === "growth") return (b.comments_3d || 0) - (a.comments_3d || 0);
      if (sort === "progress") return progress(b) - progress(a);
      return ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority]) || b.score - a.score;
    });
  }, [actor, data.tasks, owner, priority, search, sort, status]);

  const totals = useMemo(() => {
    const complete = data.tasks.filter((task) => task.status === "completed").length;
    return {
      total: data.tasks.length,
      active: data.tasks.length - complete,
      complete,
      p0: data.tasks.filter((task) => task.priority === "P0" && task.status !== "completed").length,
      unowned: data.tasks.filter((task) => !task.owner && task.status !== "completed").length,
      spend: data.tasks.reduce((sum, task) => sum + task.spend_3d, 0),
      comments: data.tasks.reduce((sum, task) => sum + (task.comments_3d || 0), 0),
    };
  }, [data.tasks]);

  const completionRate = totals.total ? Math.round((totals.complete / totals.total) * 100) : 0;
  const freshness = data.data_freshness || {};

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">评</div>
          <div>
            <h1>供应商笔记评论维护工作台</h1>
            <p>高消耗、高评论优先 · 每轮处理全程留痕</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="freshness">
            <span>聚光 {freshness.spotlight_as_of || "—"}</span>
            <span>蒲公英 {freshness.pgy_as_of || "—"}</span>
          </div>
          <button className="actor-button" onClick={() => setShowName(true)}>
            <span className="avatar">{actor ? actor.slice(0, 1) : "?"}</span>
            {actor || "选择操作人"}
          </button>
        </div>
      </header>

      <section className="hero-panel">
        <div>
          <span className="eyebrow">{data.task_date || "今日"} · 评论区维护</span>
          <h2><strong>{totals.active}</strong> 篇待处理，<em>{totals.p0}</em> 篇核心笔记需优先检查</h2>
          <p>331篇供应商笔记持续扫描；P0每日出现，停投高评论笔记每7日回访。</p>
        </div>
        <div className="hero-progress">
          <div className="progress-ring" style={{ "--progress": `${completionRate * 3.6}deg` } as React.CSSProperties}>
            <strong>{completionRate}%</strong><span>今日完成</span>
          </div>
          <div className="progress-copy"><b>{totals.complete}/{totals.total}</b><span>本轮任务</span></div>
        </div>
      </section>

      <section className="kpi-grid">
        <Metric label="P0核心待办" value={totals.p0} detail="每日人工检查" tone="red" />
        <Metric label="未领取" value={totals.unowned} detail="等待分配处理人" tone="amber" />
        <Metric label="近3日任务池消耗" value={`¥${compact(totals.spend)}`} detail="优先保护投放资产" tone="blue" />
        <Metric label="近3日新增评论" value={totals.comments} detail="任务池评论增量" tone="green" />
      </section>

      <section className="insight-grid">
        <div className="panel priority-panel">
          <div className="panel-title"><div><span>任务结构</span><small>按巡检频次分层</small></div><b>{totals.total} 篇</b></div>
          {(["P0", "P1", "P2"] as const).map((level) => {
            const count = data.tasks.filter((task) => task.priority === level).length;
            return <div className="bar-row" key={level}><span className={`priority-dot ${level.toLowerCase()}`}>{level}</span><div className="bar-track"><i className={level.toLowerCase()} style={{ width: `${totals.total ? count / totals.total * 100 : 0}%` }} /></div><b>{count}</b><small>{priorityText[level]}</small></div>;
          })}
          <div className="rule-note">硬性纳入：近3日消费≥100元、消费前10、累计评论≥30、评论前10或近3日新增≥3。</div>
        </div>
        <div className="panel matrix-panel">
          <div className="panel-title"><div><span>价值 × 风险矩阵</span><small>越靠右上越优先</small></div><b>TOP 24</b></div>
          <RiskMatrix tasks={data.tasks.slice(0, 24)} />
        </div>
        <div className="panel focus-panel">
          <div className="panel-title"><div><span>今日处理顺序</span><small>先保核心投放资产</small></div></div>
          <ol>
            <li><i>1</i><div><b>高消耗且高评论</b><span>优先核查负面、车商与铺设覆盖</span></div></li>
            <li><i>2</i><div><b>评论突然增长</b><span>检查新增评论并及时回复</span></div></li>
            <li><i>3</i><div><b>高累计评论巡检</b><span>停投后仍每7日复查一次</span></div></li>
          </ol>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="workspace-head">
          <div><span className="section-kicker">TODAY'S QUEUE</span><h3>今日维护任务</h3><p>显示 {filtered.length} / {data.tasks.length} 篇</p></div>
          <div className="view-tabs">
            {["all", "P0", "P1", "P2"].map((item) => <button key={item} className={priority === item ? "active" : ""} onClick={() => setPriority(item)}>{item === "all" ? "全部" : item}</button>)}
          </div>
        </div>
        <div className="toolbar">
          <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、博主或笔记ID" /></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="处理状态">
            <option value="active">仅看未完成</option><option value="all">全部状态</option><option value="pending">待领取</option><option value="in_progress">处理中</option><option value="completed">本轮完成</option>
          </select>
          <select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="负责人">
            <option value="all">全部负责人</option><option value="mine">只看我的</option>{owners.map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="排序方式">
            <option value="priority">按优先级</option><option value="spend">按近3日消耗</option><option value="comments">按累计评论</option><option value="growth">按评论增长</option><option value="progress">按完成进度</option>
          </select>
        </div>

        {loading ? <LoadingRows /> : filtered.length ? (
          <div className="task-list">
            {filtered.map((task) => <TaskRow key={task.task_id} task={task} actor={actor} saving={saving === task.task_id} onUpdate={updateTask} onOpen={setSelected} />)}
          </div>
        ) : <div className="empty-state"><b>当前筛选下没有任务</b><span>调整优先级、状态或负责人筛选条件。</span></div>}
      </section>

      {message && <div className={`toast ${message.includes("失败") || message.includes("只读") ? "warning" : ""}`}>{message}</div>}
      {showName && <NameDialog value={nameDraft} onChange={setNameDraft} onSave={saveActor} onClose={() => actor && setShowName(false)} />}
      {selected && <TaskDrawer task={selected} actor={actor} saving={saving === selected.task_id} onClose={() => setSelected(null)} onUpdate={updateTask} />}
    </main>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: string }) {
  return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function RiskMatrix({ tasks }: { tasks: Task[] }) {
  const maxSpend = Math.max(...tasks.map((task) => task.spend_3d), 1);
  const maxComments = Math.max(...tasks.map((task) => task.comments_total), 1);
  return <div className="risk-matrix"><span className="axis y">评论多</span><span className="axis x">消耗高</span><div className="matrix-quadrant q1">优先</div><div className="matrix-quadrant q2">活跃</div>{tasks.map((task, index) => <button key={task.task_id} title={`${task.nickname}｜¥${money(task.spend_3d)}｜${task.comments_total}条评论`} className={`matrix-point ${task.priority.toLowerCase()}`} style={{ left: `${8 + Math.sqrt(task.spend_3d / maxSpend) * 82}%`, bottom: `${8 + Math.sqrt(task.comments_total / maxComments) * 78}%`, zIndex: tasks.length - index }} />)}</div>;
}

function TaskRow({ task, actor, saving, onUpdate, onOpen }: { task: Task; actor: string; saving: boolean; onUpdate: (task: Task, changes: Partial<Task>) => void; onOpen: (task: Task) => void }) {
  const done = progress(task);
  return <article className={`task-row ${task.priority.toLowerCase()} ${task.status === "completed" ? "completed" : ""}`}>
    <div className="task-main" onClick={() => onOpen(task)} role="button" tabIndex={0}>
      <div className="priority-cell"><span className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</span><small>{priorityText[task.priority]}</small><b>{task.score}<em>分</em></b></div>
      <div className="note-cell"><div className="note-top"><h4>{task.title === "nan" ? "供应商笔记" : task.title}</h4><a href={task.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>打开笔记 ↗</a></div><p>{task.nickname} · 发布于 {task.publish_date} · 第{task.cycle_number}轮</p><div className="reason-chips">{task.reasons.slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}</div></div>
      <div className="data-cell"><div><span>近3日消耗</span><b>¥{money(task.spend_3d)}</b></div><div><span>累计评论</span><b>{task.comments_total}</b></div><div><span>近3日新增</span><b className={(task.comments_3d || 0) >= 3 ? "hot" : ""}>+{task.comments_3d ?? "—"}</b></div></div>
    </div>
    <div className="task-actions">
      <div className="owner-state"><button className={task.owner ? "owner-pill chosen" : "owner-pill"} onClick={() => onUpdate(task, { owner: actor })}>{task.owner || "领取任务"}</button><span className={`status-badge ${task.status}`}>{statusText[task.status]}</span></div>
      <div className="step-strip">{steps.map(([key, label]) => <label key={key} className={task[key] ? "checked" : ""}><input type="checkbox" checked={task[key]} disabled={saving} onChange={() => onUpdate(task, { [key]: !task[key] } as Partial<Task>)} /><i>{task[key] ? "✓" : ""}</i><span>{label}</span></label>)}</div>
      <div className="row-progress"><div><i style={{ width: `${done / steps.length * 100}%` }} /></div><span>{saving ? "保存中…" : `${done}/${steps.length}`}</span></div>
    </div>
  </article>;
}

function TaskDrawer({ task, actor, saving, onClose, onUpdate }: { task: Task; actor: string; saving: boolean; onClose: () => void; onUpdate: (task: Task, changes: Partial<Task>) => void }) {
  const [noteDraft, setNoteDraft] = useState(task.notes || "");
  const [countDraft, setCountDraft] = useState(task.placement_count || 0);
  const [riskDraft, setRiskDraft] = useState(task.risk_tag || "");
  useEffect(() => { setNoteDraft(task.notes || ""); setCountDraft(task.placement_count || 0); setRiskDraft(task.risk_tag || ""); }, [task]);
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" onMouseDown={(event) => event.stopPropagation()}>
    <div className="drawer-head"><div><span className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</span><small>第{task.cycle_number}轮维护</small></div><button onClick={onClose} aria-label="关闭">×</button></div>
    <h3>{task.title === "nan" ? "供应商笔记" : task.title}</h3><p className="drawer-author">{task.nickname} · {task.publish_date}</p>
    <a className="open-note" href={task.link} target="_blank" rel="noreferrer">在小红书打开笔记 ↗</a>
    <div className="drawer-metrics"><div><span>近3日消耗</span><b>¥{money(task.spend_3d)}</b><small>近7日 ¥{money(task.spend_7d)}</small></div><div><span>累计评论</span><b>{task.comments_total}</b><small>近7日 +{task.comments_7d ?? "—"}</small></div><div><span>行动点击</span><b>{task.action_clicks_3d}</b><small>近3日</small></div></div>
    <section className="drawer-section"><h4>进入原因</h4><div className="reason-chips large">{task.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div></section>
    <section className="drawer-section"><div className="section-line"><h4>本轮处理清单</h4><span>{progress(task)}/{steps.length}</span></div><div className="drawer-steps">{steps.map(([key, label], index) => <button key={key} className={task[key] ? "done" : ""} disabled={saving} onClick={() => onUpdate(task, { [key]: !task[key] } as Partial<Task>)}><i>{task[key] ? "✓" : index + 1}</i><span>{label}</span><small>{task[key] ? `${task.owner || actor} 已完成` : "点击标记完成"}</small></button>)}</div></section>
    <section className="drawer-section form-section"><h4>处理记录</h4><label>本轮铺设数量<input type="number" min="0" value={countDraft} onChange={(event) => setCountDraft(Number(event.target.value))} onBlur={() => countDraft !== task.placement_count && onUpdate(task, { placement_count: countDraft })} /></label><label>风险标签<select value={riskDraft} onChange={(event) => { setRiskDraft(event.target.value); onUpdate(task, { risk_tag: event.target.value }); }}><option value="">无风险</option><option>疑似车商</option><option>负面评论</option><option>价格争议</option><option>品牌质疑</option><option>需升级处理</option></select></label><label className="full">处理备注<textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="记录评论情况、铺设内容或后续关注点" /><button onClick={() => onUpdate(task, { notes: noteDraft })} disabled={saving || noteDraft === task.notes}>保存备注</button></label></section>
    <footer className="drawer-footer"><span>当前操作人：<b>{actor || "未选择"}</b></span><span>{saving ? "正在同步…" : `版本 ${task.version}`}</span></footer>
  </aside></div>;
}

function NameDialog({ value, onChange, onSave, onClose }: { value: string; onChange: (value: string) => void; onSave: () => void; onClose: () => void }) {
  return <div className="dialog-backdrop"><div className="name-dialog"><span className="dialog-mark">评</span><h3>选择你的操作身份</h3><p>勾选、铺设和复查记录都会显示这个名字，并同步给其他同事。</p><label>姓名<input autoFocus value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSave()} placeholder="请输入姓名" /></label><div><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={onSave} disabled={!value.trim()}>进入工作台</button></div></div></div>;
}

function LoadingRows() {
  return <div className="loading-list">{[1, 2, 3].map((item) => <div className="loading-row" key={item}><i /><div><b /><span /></div><em /></div>)}</div>;
}
