const STORAGE_KEY = "xhs-comment-checkins-v1";
const PAGE_SIZE = 40;

const state = {
  data: null,
  checkins: {},
  selected: new Set(),
  filters: { date: "", round: "", status: "", search: "" },
  page: 1,
};

const $ = (id) => document.getElementById(id);
const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const pct = (done, total) => total ? `${(done / total * 100).toFixed(1)}%` : "0.0%";
const taskKey = (task) => String(task.source_row);

async function init() {
  const response = await fetch("./data/dashboard.json");
  state.data = await response.json();
  try { state.checkins = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { state.checkins = {}; }
  state.filters.date = state.data.metrics.latest_task_date;
  bindNavigation();
  bindActions();
  hydrateFilters();
  renderAll();
  $("sourceStatus").textContent = `飞书只读快照 · ${state.data.metrics.latest_task_date}`;
}

function bindNavigation() {
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $("goTasksButton").addEventListener("click", () => showView("tasks"));
  $("viewAllPending").addEventListener("click", () => { state.filters.status = "未开始"; $("statusFilter").value = "未开始"; showView("tasks"); renderTasks(); });
}

function showView(view) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((panel) => panel.classList.remove("active"));
  $(`${view}View`).classList.add("active");
}

function bindActions() {
  [["dateFilter", "date"], ["roundFilter", "round"], ["statusFilter", "status"]].forEach(([id, key]) => {
    $(id).addEventListener("change", (event) => { state.filters[key] = event.target.value; state.page = 1; state.selected.clear(); renderTasks(); });
  });
  $("searchFilter").addEventListener("input", (event) => { state.filters.search = event.target.value.trim().toLowerCase(); state.page = 1; renderTasks(); });
  $("clearFilters").addEventListener("click", () => { state.filters = { date: state.data.metrics.latest_task_date, round: "", status: "", search: "" }; $("dateFilter").value = state.filters.date; $("roundFilter").value = ""; $("statusFilter").value = ""; $("searchFilter").value = ""; state.page = 1; state.selected.clear(); renderTasks(); });
  $("prevPage").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; renderTasks(); } });
  $("nextPage").addEventListener("click", () => { const pages = Math.max(1, Math.ceil(filteredTasks().length / PAGE_SIZE)); if (state.page < pages) { state.page += 1; renderTasks(); } });
  $("selectPage").addEventListener("change", (event) => { currentPageTasks().forEach((task) => event.target.checked ? state.selected.add(taskKey(task)) : state.selected.delete(taskKey(task))); renderTasks(); });
  $("applyBulk").addEventListener("click", applyBulk);
  $("exportButton").addEventListener("click", exportCheckins);
}

function hydrateFilters() {
  const dates = [...new Set(state.data.tasks.map((task) => task.task_date).filter(Boolean))].sort().reverse();
  $("dateFilter").innerHTML = `<option value="">全部日期</option>${dates.map((d) => `<option value="${d}">${d}</option>`).join("")}`;
  $("dateFilter").value = state.filters.date;
  const rounds = [...new Set(state.data.tasks.map((task) => task.round).filter(Boolean))].sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
  $("roundFilter").innerHTML = `<option value="">全部轮次</option>${rounds.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}`;
}

function current(task) {
  const saved = state.checkins[taskKey(task)] || {};
  return {
    status: saved.status || (task.feishu_completed ? "已完成" : "未开始"),
    assignee: saved.assignee || "",
    checkedAt: saved.checkedAt || "",
    note: saved.note || "",
  };
}

function metrics(tasks = state.data.tasks) {
  const statuses = tasks.map((task) => current(task).status);
  const done = statuses.filter((s) => s === "已完成").length;
  const active = statuses.filter((s) => s === "进行中" || s === "需复核").length;
  return { total: tasks.length, done, pending: tasks.length - done, active };
}

function renderAll() {
  renderOverview();
  renderTasks();
}

function renderOverview() {
  const all = metrics();
  const latestTasks = state.data.tasks.filter((task) => task.task_date === state.data.metrics.latest_task_date);
  const latest = metrics(latestTasks);
  const rate = all.total ? all.done / all.total * 100 : 0;
  $("totalTasks").textContent = all.total.toLocaleString();
  $("batchCount").textContent = `${state.data.metrics.note_batches.toLocaleString()} 个笔记批次`;
  $("totalDone").textContent = all.done.toLocaleString();
  $("totalPending").textContent = all.pending.toLocaleString();
  $("completionRate").textContent = `${rate.toFixed(1)}%`;
  $("completionCopy").textContent = `每100条约完成 ${Math.round(rate)} 条`;
  $("navPending").textContent = all.pending.toLocaleString();
  $("latestDateLabel").textContent = state.data.metrics.latest_task_date;
  $("donutRate").textContent = `${rate.toFixed(1)}%`;
  $("completionDonut").style.background = `conic-gradient(var(--green) 0 ${rate}%, #edf1f4 ${rate}% 100%)`;
  $("legendDone").textContent = all.done.toLocaleString();
  $("legendPending").textContent = all.pending.toLocaleString();
  $("legendActive").textContent = all.active.toLocaleString();
  $("latestTasks").textContent = latest.total;
  $("latestDone").textContent = latest.done;
  $("latestPending").textContent = latest.pending;
  $("latestBatches").textContent = state.data.metrics.latest_batches;
  $("latestRatePill").textContent = pct(latest.done, latest.total);
  $("latestProgressBar").style.width = pct(latest.done, latest.total);
  $("latestCaption").textContent = `最新日还有 ${latest.pending} 条待处理，完成 ${latest.done} 条。`;
  renderRoundBars(latestTasks);
  renderBacklog();
}

function renderRoundBars(tasks) {
  const groups = {};
  tasks.forEach((task) => { groups[task.round] ||= []; groups[task.round].push(task); });
  $("roundBars").innerHTML = Object.entries(groups).sort((a, b) => Number.parseInt(a[0]) - Number.parseInt(b[0])).map(([round, rows]) => {
    const m = metrics(rows); const doneWidth = m.total ? m.done / m.total * 100 : 0;
    return `<div class="bar-row"><label>${esc(round || "未标记")}</label><div class="bar-track"><div class="bar-done" style="width:${doneWidth}%"></div><div class="bar-pending" style="width:${100-doneWidth}%"></div></div><small>${m.done}/${m.total}</small></div>`;
  }).join("") || `<div class="empty-state"><span>暂无轮次数据</span></div>`;
}

function renderBacklog() {
  const groups = new Map();
  state.data.tasks.forEach((task) => {
    const key = `${task.task_date}|${task.round}|${task.nickname}|${task.link}`;
    const item = groups.get(key) || { nickname: task.nickname, round: task.round, note_id: task.note_id, pending: 0, total: 0 };
    item.total += 1; if (current(task).status !== "已完成") item.pending += 1; groups.set(key, item);
  });
  const top = [...groups.values()].filter((x) => x.pending > 0).sort((a, b) => b.pending - a.pending || b.total - a.total).slice(0, 6);
  $("backlogList").innerHTML = top.map((x, i) => `<div class="backlog-item"><span class="backlog-rank">${i + 1}</span><div class="backlog-name"><strong>${esc(x.nickname || "未标记达人")}</strong><span>${esc(x.round)} · ${esc(x.note_id)}</span></div><span class="backlog-value">${x.pending} 待办</span></div>`).join("");
}

function filteredTasks() {
  return state.data.tasks.filter((task) => {
    const c = current(task);
    if (state.filters.date && task.task_date !== state.filters.date) return false;
    if (state.filters.round && task.round !== state.filters.round) return false;
    if (state.filters.status && c.status !== state.filters.status) return false;
    if (state.filters.search) {
      const haystack = `${task.nickname} ${task.note_id} ${task.comment_script}`.toLowerCase();
      if (!haystack.includes(state.filters.search)) return false;
    }
    return true;
  });
}

function currentPageTasks() {
  const rows = filteredTasks();
  const start = (state.page - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}

function renderTasks() {
  const rows = filteredTasks();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const pageRows = currentPageTasks();
  const m = metrics(rows);
  $("filteredCount").textContent = m.total.toLocaleString();
  $("filteredDone").textContent = m.done.toLocaleString();
  $("filteredPending").textContent = m.pending.toLocaleString();
  $("selectedCount").textContent = state.selected.size;
  $("pageInfo").textContent = `第 ${state.page} / ${pages} 页 · 共 ${rows.length.toLocaleString()} 条`;
  $("prevPage").disabled = state.page <= 1;
  $("nextPage").disabled = state.page >= pages;
  $("selectPage").checked = pageRows.length > 0 && pageRows.every((task) => state.selected.has(taskKey(task)));
  $("emptyState").classList.toggle("hidden", pageRows.length > 0);
  $("taskTableBody").innerHTML = pageRows.map((task) => {
    const c = current(task); const key = taskKey(task);
    return `<tr data-key="${key}"><td><input class="row-check" type="checkbox" ${state.selected.has(key) ? "checked" : ""}></td><td>${esc(task.task_date)}</td><td>${esc(task.round)}</td><td><strong>${esc(task.nickname)}</strong><br><small>${esc(task.note_id)}</small></td><td><select class="status-select"><option ${c.status === "未开始" ? "selected" : ""}>未开始</option><option ${c.status === "进行中" ? "selected" : ""}>进行中</option><option ${c.status === "已完成" ? "selected" : ""}>已完成</option><option ${c.status === "需复核" ? "selected" : ""}>需复核</option></select></td><td><input class="assignee-input" value="${esc(c.assignee)}" placeholder="执行人"></td><td><input class="time-input" type="datetime-local" value="${esc(c.checkedAt)}"></td><td><div class="comment-preview" title="${esc(task.comment_script)}">${esc(task.comment_script)}</div></td><td><a class="note-link" href="${esc(task.link)}" target="_blank" rel="noreferrer">打开笔记 ↗</a></td><td><button class="detail-button">详情</button></td></tr>`;
  }).join("");
  bindRowActions(pageRows);
}

function bindRowActions(pageRows) {
  document.querySelectorAll("#taskTableBody tr").forEach((row, index) => {
    const task = pageRows[index]; const key = taskKey(task);
    row.querySelector(".row-check").addEventListener("change", (event) => { event.target.checked ? state.selected.add(key) : state.selected.delete(key); $("selectedCount").textContent = state.selected.size; });
    row.querySelector(".status-select").addEventListener("change", (event) => updateCheckin(task, { status: event.target.value, checkedAt: event.target.value === "已完成" && !current(task).checkedAt ? localDateTime() : current(task).checkedAt }));
    row.querySelector(".assignee-input").addEventListener("change", (event) => updateCheckin(task, { assignee: event.target.value.trim() }));
    row.querySelector(".time-input").addEventListener("change", (event) => updateCheckin(task, { checkedAt: event.target.value }));
    row.querySelector(".detail-button").addEventListener("click", () => openDetails(task));
  });
}

function updateCheckin(task, patch, rerender = true) {
  const key = taskKey(task);
  state.checkins[key] = { ...current(task), ...patch, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.checkins));
  $("saveIndicator").textContent = `已保存 ${Object.keys(state.checkins).length} 条本地修改`;
  if (rerender) { renderOverview(); renderTasks(); }
}

function applyBulk() {
  if (!state.selected.size) return toast("请先选择任务");
  const status = $("bulkStatus").value; const assignee = $("bulkAssignee").value.trim();
  if (!status && !assignee) return toast("请选择状态或填写执行人");
  state.data.tasks.filter((task) => state.selected.has(taskKey(task))).forEach((task) => {
    const patch = {}; if (status) { patch.status = status; if (status === "已完成") patch.checkedAt = current(task).checkedAt || localDateTime(); } if (assignee) patch.assignee = assignee; updateCheckin(task, patch, false);
  });
  state.selected.clear(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state.checkins)); renderAll(); toast("批量打卡已保存");
}

function openDetails(task) {
  const c = current(task);
  $("dialogContent").innerHTML = `<p class="eyebrow">TASK DETAIL</p><h2>${esc(task.nickname)} · ${esc(task.round)}</h2><div class="dialog-grid"><div class="dialog-block"><span>任务日期</span><p>${esc(task.task_date)}</p></div><div class="dialog-block"><span>笔记ID</span><p>${esc(task.note_id)}</p></div><div class="dialog-block full"><span>评论文案</span><p>${esc(task.comment_script || "—")}</p></div><div class="dialog-block full"><span>楼中楼</span><p>${esc(task.thread_reply || "—")}</p></div><div class="dialog-block"><span>图片素材</span><p>${esc(task.image_material || "—")}</p></div><div class="dialog-block"><span>@提醒</span><p>${esc(task.mention_note || "—")}</p></div><div class="dialog-block full"><span>备注</span><p>${esc(task.remarks || "—")}</p></div><div class="dialog-block full"><span>本地处理备注</span><textarea id="dialogNote" rows="4" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:10px">${esc(c.note)}</textarea><button id="saveDialogNote" class="primary-button" style="margin-top:10px">保存备注</button></div></div>`;
  $("taskDialog").showModal();
  $("saveDialogNote").addEventListener("click", () => { updateCheckin(task, { note: $("dialogNote").value.trim() }); $("taskDialog").close(); toast("备注已保存"); });
}

function exportCheckins() {
  const headers = ["飞书源行", "任务日期", "铺设轮次", "达人昵称", "笔记ID", "状态", "执行人", "打卡时间", "处理备注", "笔记链接"];
  const rows = state.data.tasks.map((task) => { const c = current(task); return [task.source_row, task.task_date, task.round, task.nickname, task.note_id, c.status, c.assignee, c.checkedAt, c.note, task.link]; });
  const csv = "\ufeff" + [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `评论铺设打卡记录_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url); toast("打卡记录已导出");
}

function localDateTime() { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
let toastTimer; function toast(message) { $("toast").textContent = message; $("toast").classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800); }

init().catch((error) => { console.error(error); $("sourceStatus").textContent = "数据加载失败"; document.body.insertAdjacentHTML("beforeend", `<div class="toast show">看板数据加载失败，请重新打开。</div>`); });
