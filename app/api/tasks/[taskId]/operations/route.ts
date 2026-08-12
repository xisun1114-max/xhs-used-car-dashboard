import { ensureSchema, getD1 } from "../../../../../db/runtime";

const operationTypes = ["placement", "dealer_guard", "pinned_comment", "official_reply"];

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const payload = await request.json() as { actor?: string; operation_type?: string; detail?: string };
    const actor = String(payload.actor || "").trim();
    const operationType = String(payload.operation_type || "").trim();
    const detail = String(payload.detail || "").trim().slice(0, 500);
    if (!actor) return Response.json({ error: "请先选择操作人" }, { status: 400 });
    if (!operationTypes.includes(operationType)) {
      return Response.json({ error: "无效的操作类型" }, { status: 400 });
    }
    const db = getD1();
    await ensureSchema(db);
    const task = await db.prepare("SELECT task_id, note_id, cycle_number FROM maintenance_tasks WHERE task_id=?")
      .bind(decodeURIComponent(taskId)).first<{ task_id: string; note_id: string; cycle_number: number }>();
    if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
    const existing = await db.prepare("SELECT * FROM operation_events WHERE task_id=? AND operation_type=? ORDER BY id DESC LIMIT 1")
      .bind(task.task_id, operationType).first();
    if (existing) return Response.json({ event: existing, already_recorded: true });
    const result = await db.prepare(`INSERT INTO operation_events(
      task_id, note_id, cycle_number, operation_type, actor, detail
    ) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM operation_events WHERE task_id=? AND operation_type=?
    )`).bind(task.task_id, task.note_id, task.cycle_number, operationType, actor, detail, task.task_id, operationType).run();
    if (!result.meta.changes) {
      const concurrentExisting = await db.prepare("SELECT * FROM operation_events WHERE task_id=? AND operation_type=? ORDER BY id DESC LIMIT 1")
        .bind(task.task_id, operationType).first();
      return Response.json({ event: concurrentExisting, already_recorded: true });
    }
    await db.prepare("INSERT INTO activity_log(task_id, actor, action, detail) VALUES(?, ?, 'record_operation', ?)")
      .bind(task.task_id, actor, JSON.stringify({ operation_type: operationType, detail })).run();
    const event = await db.prepare("SELECT * FROM operation_events WHERE id=?")
      .bind(result.meta.last_row_id).first();
    return Response.json({ event }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "操作记录保存失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const payload = await request.json() as { actor?: string; operation_type?: string };
    const actor = String(payload.actor || "").trim();
    const operationType = String(payload.operation_type || "").trim();
    if (!actor) return Response.json({ error: "请先选择操作人" }, { status: 400 });
    if (!operationTypes.includes(operationType)) return Response.json({ error: "无效的操作类型" }, { status: 400 });
    const db = getD1();
    await ensureSchema(db);
    const decodedTaskId = decodeURIComponent(taskId);
    const event = await db.prepare("SELECT * FROM operation_events WHERE task_id=? AND operation_type=? ORDER BY id DESC LIMIT 1")
      .bind(decodedTaskId, operationType).first<{ id: number; detail: string }>();
    if (!event) return Response.json({ error: "本轮尚未记录该操作" }, { status: 404 });
    await db.prepare("DELETE FROM operation_events WHERE id=?").bind(event.id).run();
    await db.prepare("INSERT INTO activity_log(task_id, actor, action, detail) VALUES(?, ?, 'revoke_operation', ?)")
      .bind(decodedTaskId, actor, JSON.stringify({ operation_type: operationType, event_id: event.id, detail: event.detail })).run();
    return Response.json({ deleted_id: event.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "撤回操作失败" }, { status: 500 });
  }
}
