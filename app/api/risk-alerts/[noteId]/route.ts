import { ensureSchema, getD1 } from "../../../../db/runtime";

const allowed = new Set(["owner", "resolution", "action_type", "notes"]);

export async function PATCH(request: Request, context: { params: Promise<{ noteId: string }> }) {
  try {
    const { noteId } = await context.params;
    const id = decodeURIComponent(noteId);
    const payload = await request.json() as { actor?: string; version?: number; changes?: Record<string, unknown> };
    const actor = String(payload.actor || "").trim();
    if (!actor) return Response.json({ error: "请先选择操作人" }, { status: 400 });
    const entries = Object.entries(payload.changes || {}).filter(([key]) => allowed.has(key));
    if (!entries.length) return Response.json({ error: "没有可保存的修改" }, { status: 400 });
    const resolution = entries.find(([key]) => key === "resolution")?.[1];
    if (resolution != null && !["pending", "processing", "resolved", "ignored"].includes(String(resolution))) {
      return Response.json({ error: "无效的处理状态" }, { status: 400 });
    }
    const db = getD1();
    await ensureSchema(db);
    const current = await db.prepare("SELECT * FROM risk_alert_tasks WHERE note_id=?").bind(id).first<Record<string, unknown>>();
    if (!current) return Response.json({ error: "预警不存在" }, { status: 404 });
    if (payload.version != null && Number(current.version) !== Number(payload.version)) {
      return Response.json({ error: "该预警已被其他同事更新，请刷新后重试", alert: current }, { status: 409 });
    }
    const setters = entries.map(([key]) => `${key}=?`);
    const values = entries.map(([, value]) => String(value ?? "").slice(0, 20_000));
    if (!entries.some(([key]) => key === "owner") && !String(current.owner || "")) {
      setters.push("owner=?"); values.push(actor);
    }
    const nextResolution = String(resolution ?? current.resolution);
    setters.push("resolved_at=?", "version=version+1", "updated_at=CURRENT_TIMESTAMP");
    values.push(["resolved", "ignored"].includes(nextResolution) ? new Date().toISOString() : "");
    await db.prepare(`UPDATE risk_alert_tasks SET ${setters.join(", ")} WHERE note_id=?`).bind(...values, id).run();
    await db.prepare("INSERT INTO risk_alert_activity(note_id, actor, action, detail) VALUES(?, ?, ?, ?)")
      .bind(id, actor, "update", JSON.stringify(payload.changes || {})).run();
    const updated = await db.prepare("SELECT * FROM risk_alert_tasks WHERE note_id=?").bind(id).first();
    return Response.json({ alert: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}
