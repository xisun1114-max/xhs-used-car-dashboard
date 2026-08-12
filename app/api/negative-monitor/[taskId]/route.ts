import { ensureSchema, getD1 } from "../../../../db/runtime";

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const payload = await request.json() as { actor?: string; version?: number; changes?: { status?: string; owner?: string; notes?: string } };
    const actor = String(payload.actor || "").trim();
    if (!actor) return Response.json({ error: "请先填写操作人" }, { status: 400 });
    const status = payload.changes?.status;
    if (status && !["pending", "in_progress", "completed"].includes(status)) return Response.json({ error: "无效状态" }, { status: 400 });
    const db = getD1();
    await ensureSchema(db);
    const id = decodeURIComponent(taskId);
    const current = await db.prepare("SELECT * FROM negative_monitor_tasks WHERE task_id=?").bind(id).first<Record<string, unknown>>();
    if (!current) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (payload.version != null && Number(current.version) !== Number(payload.version)) return Response.json({ error: "任务已被其他同事更新，请刷新后重试" }, { status: 409 });
    const nextStatus = status || String(current.status);
    const owner = String(payload.changes?.owner ?? current.owner ?? "").trim() || actor;
    const notes = String(payload.changes?.notes ?? current.notes ?? "").slice(0, 5000);
    await db.prepare(`UPDATE negative_monitor_tasks SET status=?, owner=?, notes=?, completed_at=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE task_id=?`)
      .bind(nextStatus, owner, notes, nextStatus === "completed" ? new Date().toISOString() : null, id).run();
    const updated = await db.prepare("SELECT * FROM negative_monitor_tasks WHERE task_id=?").bind(id).first();
    return Response.json({ task: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}
