import { ensureSchema, getD1, serializeTask } from "../../../../db/runtime";

const allowedFields: Record<string, string> = {
  owner: "owner",
  review_done: "review_done",
  placement_done: "placement_done",
  dealer_guard_done: "dealer_guard_done",
  reply_done: "reply_done",
  recheck_done: "recheck_done",
  placement_count: "placement_count",
  risk_tag: "risk_tag",
  notes: "notes",
};

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const payload = await request.json() as {
      actor?: string;
      version?: number;
      changes?: Record<string, unknown>;
    };
    const actor = String(payload.actor || "").trim();
    if (!actor) return Response.json({ error: "请先选择操作人" }, { status: 400 });
    const entries = Object.entries(payload.changes || {}).filter(([key]) => key in allowedFields);
    if (!entries.length) return Response.json({ error: "没有可保存的修改" }, { status: 400 });

    const db = getD1();
    await ensureSchema(db);
    const current = await db.prepare("SELECT * FROM maintenance_tasks WHERE task_id=?")
      .bind(decodeURIComponent(taskId)).first<Record<string, unknown>>();
    if (!current) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (payload.version != null && Number(current.version) !== Number(payload.version)) {
      return Response.json({ error: "任务已被其他同事更新，请刷新后重试", task: serializeTask(current) }, { status: 409 });
    }

    const next = { ...current };
    for (const [key, value] of entries) next[allowedFields[key]] = value;
    if (!String(next.owner || "").trim()) next.owner = actor;
    const stepFields = ["review_done", "placement_done", "dealer_guard_done", "reply_done", "recheck_done"];
    const completed = stepFields.every((field) => Boolean(next[field]));
    const started = stepFields.some((field) => Boolean(next[field]));
    const status = completed ? "completed" : started ? "in_progress" : "assigned";

    const setters: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of entries) {
      setters.push(`${allowedFields[key]}=?`);
      values.push(typeof value === "boolean" ? Number(value) : value);
    }
    if (!entries.some(([key]) => key === "owner") && !String(current.owner || "").trim()) {
      setters.push("owner=?");
      values.push(actor);
    }
    setters.push("status=?", "completed_at=?", "completed_comments=?", "version=version+1", "updated_at=CURRENT_TIMESTAMP");
    values.push(
      status,
      completed ? new Date().toISOString() : null,
      completed ? Number(current.comments_total || 0) : null,
      decodeURIComponent(taskId),
    );
    await db.prepare(`UPDATE maintenance_tasks SET ${setters.join(", ")} WHERE task_id=?`).bind(...values).run();
    await db.prepare("INSERT INTO activity_log(task_id, actor, action, detail) VALUES(?, ?, ?, ?)")
      .bind(decodeURIComponent(taskId), actor, completed ? "complete_round" : "update_task", JSON.stringify(payload.changes)).run();
    const updated = await db.prepare("SELECT * FROM maintenance_tasks WHERE task_id=?")
      .bind(decodeURIComponent(taskId)).first<Record<string, unknown>>();
    return Response.json({ task: serializeTask(updated || {}) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "保存失败" },
      { status: 500 },
    );
  }
}
